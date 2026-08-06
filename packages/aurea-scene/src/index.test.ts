import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  type EntityId,
  type LocationId,
  type PersonaId,
  type WorldState,
} from "@hnk/domain";
import { composeNarrative } from "@hnk/narrative-engine";
import { projectAureaScene } from "./index.js";

const archivum = "aurea.archivum" as LocationId;
const forum = "aurea.forum" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const miriam = "npc.miriam" as EntityId;
const persona = "persona.player" as PersonaId;

const world: WorldState = {
  worldId: "world.aurea",
  timestamp: { day: 1, minuteOfDay: 8 * 60 },
  locations: {
    [archivum]: { id: archivum, illumination: "lit", entityIds: [] },
    [forum]: { id: forum, illumination: "lit", entityIds: [] },
    [typographia]: { id: typographia, illumination: "lit", entityIds: [] },
  },
  entities: {
    [miriam]: { id: miriam, kind: "character", state: {} },
  },
};

const miriamRoutine = {
  npcId: miriam,
  windows: [
    { fromMinute: 8 * 60, toMinute: 12 * 60, locationId: archivum },
    { fromMinute: 14 * 60, toMinute: 17 * 60, locationId: forum },
  ],
};

describe("Aurea scene projection", () => {
  it("places Miriam in Archivum in the morning and exposes her narrative layer", () => {
    const projection = projectAureaScene({
      world,
      now: { day: 1, minuteOfDay: 9 * 60 },
      location: {
        locationId: archivum,
        sceneId: "scene.archivum",
        baseTextKey: "scene.archivum.base",
      },
      routines: [miriamRoutine],
      localNpcNarrative: { [miriam]: "scene.archivum.miriam.present" },
    });

    expect(projection.world.entities[miriam]?.locationId).toBe(archivum);
    const narrative = composeNarrative({
      scene: projection.scene,
      perceived: [],
      knowledge: createEmptyKnowledgeState(),
    });
    expect(narrative.textKeys).toContain("scene.archivum.miriam.present");
  });

  it("removes Miriam from Archivum in the afternoon instead of teleporting her into the scene", () => {
    const projection = projectAureaScene({
      world,
      now: { day: 1, minuteOfDay: 15 * 60 },
      location: {
        locationId: archivum,
        sceneId: "scene.archivum",
        baseTextKey: "scene.archivum.base",
      },
      routines: [miriamRoutine],
      localNpcNarrative: { [miriam]: "scene.archivum.miriam.present" },
    });

    expect(projection.world.entities[miriam]?.locationId).toBe(forum);
    const narrative = composeNarrative({
      scene: projection.scene,
      perceived: [],
      knowledge: createEmptyKnowledgeState(),
    });
    expect(narrative.textKeys).not.toContain("scene.archivum.miriam.present");
  });

  it("changes available actions when Typographia is closed", () => {
    const projection = projectAureaScene({
      world,
      now: { day: 1, minuteOfDay: 20 * 60 },
      location: {
        locationId: typographia,
        sceneId: "scene.typographia",
        baseTextKey: "scene.typographia.base",
        closedTextKey: "scene.typographia.closed",
        hours: { locationId: typographia, opensAt: 8 * 60, closesAt: 18 * 60 },
      },
      routines: [],
    });

    expect(projection.locationOpen).toBe(false);
    expect(projection.availableActionKeys).toEqual(["action.observe", "action.wait"]);
    expect(composeNarrative({
      scene: projection.scene,
      perceived: [],
      knowledge: createEmptyKnowledgeState(),
    }).textKeys).toContain("scene.typographia.closed");
  });
});

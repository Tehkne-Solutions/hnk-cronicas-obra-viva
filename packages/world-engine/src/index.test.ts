import { describe, expect, it } from "vitest";
import type { EntityId, LocationId, PersonaId, WorldState } from "@hnk/domain";
import { createEmptyKnowledgeState } from "@hnk/domain";
import { resolvePerception } from "@hnk/perception-engine";
import { applyWorldLightEvents, deriveLightEvents } from "./index.js";

const workshopId = "officina-ardel" as LocationId;
const lampId = "lamp-01" as EntityId;
const manuscriptId = "manuscript-01" as EntityId;

function world(): WorldState {
  return {
    worldId: "ignis-fixture",
    timestamp: { day: 1, minuteOfDay: 60 },
    locations: {
      [workshopId as string]: { id: workshopId, illumination: "dark", entityIds: [lampId, manuscriptId] },
    },
    entities: {
      [lampId as string]: { id: lampId, kind: "object", locationId: workshopId, state: {} },
      [manuscriptId as string]: { id: manuscriptId, kind: "document", locationId: workshopId, state: {} },
    },
  };
}

const burningState = {
  lampId,
  reservoirMaterialId: "oleum" as const,
  wickMaterialId: "linum" as const,
  wickSaturation: "saturated" as const,
  ignitionState: "burning" as const,
};

describe("IGNIS illumination", () => {
  it("turns sustained lamp combustion into world illumination and expands perception", () => {
    const before = world();
    const persona = {
      id: "persona-01" as PersonaId,
      currentLocation: workshopId,
      inventory: [],
      capabilities: { observatio: 1, litterae: 0, discernimentum: 0 },
    };
    const candidates = [{ subjectId: manuscriptId, conceptId: "manuscript.visible", requirements: [{ minimumIllumination: "lit" as const }] }];

    expect(resolvePerception({ observer: persona, world: before, knowledge: createEmptyKnowledgeState(), candidates })).toHaveLength(0);

    const lightEvents = deriveLightEvents({
      combustion: { events: [{ type: "CombustionStarted", lampId }], nextState: burningState },
      sourceId: lampId,
      locationId: workshopId,
    });
    const after = applyWorldLightEvents(before, lightEvents);

    expect(after.locations[workshopId as string]?.illumination).toBe("lit");
    expect(after.entities[lampId as string]?.state.lightOutput).toBe("bright");
    expect(resolvePerception({ observer: persona, world: after, knowledge: createEmptyKnowledgeState(), candidates })).toHaveLength(1);
  });

  it("does not emit light when combustion is not sustained", () => {
    const events = deriveLightEvents({
      combustion: {
        events: [{ type: "CombustionNotSustained", lampId, reason: "fuel_not_combustible" }],
        nextState: { ...burningState, ignitionState: "unlit" },
      },
      sourceId: lampId,
      locationId: workshopId,
    });
    expect(events).toEqual([]);
  });
});

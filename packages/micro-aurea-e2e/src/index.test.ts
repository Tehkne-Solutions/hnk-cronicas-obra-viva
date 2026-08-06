import { describe, expect, it } from "vitest";
import type { EntityId, LocationId, PersonaId } from "@hnk/domain";
import { createWorldTimestamp } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { travelChronicle } from "@hnk/aurea-navigation";
import { resolveNpcLocation, isLocationOpen, type NpcRoutine, type LocationHours } from "@hnk/aurea-routines";
import { resolveAureaSchedule, materializeAureaScheduleEntry, type AureaScheduleEntry } from "@hnk/aurea-time";

const personaId = "persona.player" as PersonaId;
const miriamId = "npc.miriam" as EntityId;
const officina = "aurea.officina" as LocationId;
const archivum = "aurea.archivum" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const forum = "aurea.forum" as LocationId;

const miriamRoutine: NpcRoutine = {
  npcId: miriamId,
  windows: [
    { fromMinute: 8 * 60, toMinute: 12 * 60, locationId: archivum },
    { fromMinute: 13 * 60, toMinute: 17 * 60, locationId: forum },
  ],
};

const typographiaHours: LocationHours = {
  locationId: typographia,
  opensAt: 9 * 60,
  closesAt: 15 * 60,
};

function createChronicle(): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.micro-aurea" as never,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: createWorldTimestamp(1, 10 * 60 + 30),
      locations: {
        [officina]: { id: officina, illumination: "lit", entityIds: [] },
        [archivum]: { id: archivum, illumination: "lit", entityIds: [] },
        [typographia]: { id: typographia, illumination: "lit", entityIds: [] },
        [forum]: { id: forum, illumination: "lit", entityIds: [] },
      },
      entities: {},
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: officina,
        inventory: [],
        capabilities: { observatio: 0, litterae: 0, discernimentum: 0 },
      },
    },
    knowledgeByPersona: {},
    eventLedger: [],
    scheduledConsequences: [],
    contentVersion: "micro-aurea-e2e-1",
  };
}

describe("MICRO-AUREA E2E", () => {
  it("plays a time-sensitive route through Archivum, Typographia and Forum", () => {
    let chronicle = createChronicle();

    chronicle = travelChronicle(chronicle, personaId, {
      from: officina,
      to: archivum,
      travelMinutes: 15,
    }).chronicle;
    expect(chronicle.world.timestamp.minuteOfDay).toBe(10 * 60 + 45);
    expect(resolveNpcLocation(miriamRoutine, chronicle.world.timestamp)).toBe(archivum);

    chronicle = travelChronicle(chronicle, personaId, {
      from: archivum,
      to: typographia,
      travelMinutes: 20,
    }).chronicle;
    expect(isLocationOpen(typographiaHours, chronicle.world.timestamp)).toBe(true);

    // Investigating inside the Typographia costs enough time to miss its closing window.
    chronicle = {
      ...chronicle,
      world: { ...chronicle.world, timestamp: createWorldTimestamp(1, 15 * 60 + 5) },
    };
    expect(isLocationOpen(typographiaHours, chronicle.world.timestamp)).toBe(false);
    expect(resolveNpcLocation(miriamRoutine, chronicle.world.timestamp)).toBe(forum);

    const forumSchedule: AureaScheduleEntry[] = [{
      id: "forum.bell.1500",
      occursAt: createWorldTimestamp(1, 15 * 60),
      eventType: "ForumBellRang",
      payload: { bell: "afternoon" },
    }];
    const schedule = resolveAureaSchedule(forumSchedule, chronicle.world.timestamp);
    expect(schedule.due).toHaveLength(1);
    const bellEvent = materializeAureaScheduleEntry(schedule.due[0]!, "event.forum.bell.1" as never);
    chronicle = { ...chronicle, eventLedger: [...chronicle.eventLedger, bellEvent] };

    chronicle = travelChronicle(chronicle, personaId, {
      from: typographia,
      to: forum,
      travelMinutes: 10,
    }).chronicle;
    expect(chronicle.personas[personaId as string]?.currentLocation).toBe(forum);
    expect(resolveNpcLocation(miriamRoutine, chronicle.world.timestamp)).toBe(forum);
    expect(chronicle.eventLedger.some((event) => event.type === "ForumBellRang")).toBe(true);

    chronicle = travelChronicle(chronicle, personaId, {
      from: forum,
      to: officina,
      travelMinutes: 20,
    }).chronicle;
    expect(chronicle.personas[personaId as string]?.currentLocation).toBe(officina);
    expect(chronicle.world.timestamp.minuteOfDay).toBe(15 * 60 + 35);
  });
});

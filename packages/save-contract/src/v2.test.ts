import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  createWorldTimestamp,
  type ChronicleId,
  type EventId,
  type LocationId,
  type PersonaId,
} from "@hnk/domain";
import { resolveDueConsequences, scheduleConsequence } from "@hnk/consequentia-engine";
import type { ChronicleSaveV1 } from "./index.js";
import {
  CHRONICLE_SCHEMA_VERSION_V2,
  assertChronicleSaveV2,
  migrateChronicleV1ToV2,
  type ChronicleSaveV2,
} from "./v2.js";

const chronicleId = "chronicle.consequentia" as ChronicleId;
const personaId = "persona.test" as PersonaId;
const workshopId = "aurea.officina" as LocationId;

function legacyV1(): ChronicleSaveV1 {
  return {
    schemaVersion: 1,
    chronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.test",
      timestamp: createWorldTimestamp(1, 8 * 60),
      locations: {
        [workshopId]: { id: workshopId, illumination: "lit", entityIds: [] },
      },
      entities: {},
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: workshopId,
        inventory: [],
        capabilities: { observatio: 1, litterae: 1, discernimentum: 1 },
      },
    },
    knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() },
    eventLedger: [],
    contentVersion: "consequentia-dev-1",
  };
}

describe("Chronicle save v2", () => {
  it("migrates v1 with an empty consequence queue", () => {
    const migrated = migrateChronicleV1ToV2(legacyV1());
    expect(migrated.schemaVersion).toBe(CHRONICLE_SCHEMA_VERSION_V2);
    expect(migrated.scheduledConsequences).toEqual([]);
    expect(() => assertChronicleSaveV2(migrated)).not.toThrow();
  });

  it("preserves a delayed consequence through serialization and reload", () => {
    const consequence = scheduleConsequence({
      id: "consequence.rumour-spread",
      causeEventId: "event.publish-manuscript" as EventId,
      dueAt: createWorldTimestamp(3, 9 * 60),
      eventType: "RumourSpread",
      payload: { manuscriptId: "document.ardel" },
      correlationId: "publication.ardel",
    });

    const beforeSave: ChronicleSaveV2 = Object.freeze({
      ...migrateChronicleV1ToV2(legacyV1()),
      scheduledConsequences: Object.freeze([consequence]),
    });

    const reloaded = structuredClone(beforeSave);
    assertChronicleSaveV2(reloaded);

    expect(reloaded.scheduledConsequences).toEqual([consequence]);
    expect(resolveDueConsequences(reloaded.scheduledConsequences, createWorldTimestamp(2, 18 * 60)).due).toHaveLength(0);
    expect(resolveDueConsequences(reloaded.scheduledConsequences, createWorldTimestamp(3, 9 * 60)).due).toHaveLength(1);
  });
});

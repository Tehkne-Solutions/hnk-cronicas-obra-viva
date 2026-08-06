import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  createWorldTimestamp,
  type ChronicleId,
  type EventId,
  type LocationId,
  type PersonaId,
} from "@hnk/domain";
import { scheduleConsequence } from "@hnk/consequentia-engine";
import { advanceChronicleConsequences } from "./consequentia.js";
import { CHRONICLE_SCHEMA_VERSION_V2, type ChronicleSaveV2 } from "./v2.js";

const chronicleId = "chronicle.causal-chain" as ChronicleId;
const personaId = "persona.causal-chain" as PersonaId;
const locationId = "aurea.officina" as LocationId;

function fixture(): ChronicleSaveV2 {
  const causeEventId = "event.publish-manuscript" as EventId;
  return {
    schemaVersion: CHRONICLE_SCHEMA_VERSION_V2,
    chronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.causal-chain",
      timestamp: createWorldTimestamp(1, 8 * 60),
      locations: { [locationId]: { id: locationId, illumination: "lit", entityIds: [] } },
      entities: {},
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: locationId,
        inventory: [],
        capabilities: { observatio: 1, litterae: 1, discernimentum: 1 },
      },
    },
    knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() },
    eventLedger: [{
      id: causeEventId,
      type: "PublishManuscript",
      occurredAt: createWorldTimestamp(1, 8 * 60),
      payload: { manuscriptId: "document.ardel" },
    }],
    scheduledConsequences: [scheduleConsequence({
      id: "consequence.rumour-spread",
      causeEventId,
      dueAt: createWorldTimestamp(3, 9 * 60),
      eventType: "RumourSpread",
      payload: { manuscriptId: "document.ardel" },
      correlationId: "publication.ardel",
    })],
    contentVersion: "consequentia-v2-test",
  };
}

describe("Chronicle consequence persistence", () => {
  it("survives save/reload between cause and delayed effect", () => {
    const saved = structuredClone(fixture());
    const day2 = advanceChronicleConsequences(
      saved,
      createWorldTimestamp(2, 12 * 60),
      (id) => `event.${id}` as EventId,
    );

    expect(day2.chronicle.eventLedger).toHaveLength(1);
    expect(day2.chronicle.scheduledConsequences).toHaveLength(1);

    const reloaded = structuredClone(day2.chronicle);
    const day3 = advanceChronicleConsequences(
      reloaded,
      createWorldTimestamp(3, 9 * 60),
      (id) => `event.${id}` as EventId,
    );

    expect(day3.chronicle.scheduledConsequences).toHaveLength(0);
    expect(day3.chronicle.eventLedger).toHaveLength(2);
    const effect = day3.chronicle.eventLedger[1]!;
    expect(effect.type).toBe("RumourSpread");
    expect(effect.causationId).toBe("event.publish-manuscript");
    expect(effect.correlationId).toBe("publication.ardel");
    expect(day3.chronicle.world.timestamp).toEqual(createWorldTimestamp(3, 9 * 60));
  });
});

import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type EventId, type LocationId, type PersonaId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { travelChronicle } from "./index.js";

const personaId = "persona.player" as PersonaId;
const officina = "aurea.officina" as LocationId;
const archivum = "aurea.archivum" as LocationId;

function fixture(): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.micro-aurea" as ChronicleId,
    activePersonaId: personaId,
    world: { worldId: "world.aurea", timestamp: { day: 1, minuteOfDay: 710 }, locations: {}, entities: {} },
    personas: { [personaId]: { id: personaId, currentLocation: officina, inventory: [], capabilities: { observatio: 0, litterae: 0, discernimentum: 0 } } },
    knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() },
    eventLedger: [],
    scheduledConsequences: [{ id: "rumour", causeEventId: "event.publish" as EventId, dueAt: { day: 1, minuteOfDay: 720 }, eventType: "RumourSpread", payload: {} }],
    contentVersion: "aurea-dev-1",
  };
}

describe("micro-Aurea navigation", () => {
  it("advances time, moves the Persona and materializes consequences during travel", () => {
    const result = travelChronicle(fixture(), personaId, { from: officina, to: archivum, travelMinutes: 15 });
    expect(result.chronicle.world.timestamp).toEqual({ day: 1, minuteOfDay: 725 });
    expect(result.chronicle.personas[personaId]?.currentLocation).toBe(archivum);
    expect(result.materializedEventTypes).toEqual(["RumourSpread"]);
    expect(result.chronicle.scheduledConsequences).toHaveLength(0);
    expect(result.chronicle.eventLedger[0]?.causationId).toBe("event.publish");
  });
});

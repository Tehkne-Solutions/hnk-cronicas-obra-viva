import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type LocationId, type PersonaId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyProloguePath } from "./prologue.js";

const personaId = "persona.prologue" as PersonaId;
const officina = "aurea.officina" as LocationId;

function fixture(): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.prologue" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 7 * 60 + 45 },
      locations: { [officina]: { id: officina, illumination: "dim", entityIds: [] } },
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
    knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() },
    eventLedger: [],
    scheduledConsequences: [],
    contentVersion: "prologue-test-1",
  };
}

describe("new game prologue", () => {
  it("records the first chosen approach in the canonical Chronicle", () => {
    const next = applyProloguePath(fixture(), "discernimentum");
    expect(next.personas[personaId as string]?.capabilities.discernimentum).toBe(1);
    expect(next.eventLedger.at(-1)?.type).toBe("ProloguePathChosen");
    expect(next.eventLedger.at(-1)?.payload).toEqual({ path: "discernimentum" });
  });
});

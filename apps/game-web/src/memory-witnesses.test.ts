import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type EntityId, type LocationId, type PersonaId, type Question, type QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyMemoryWitnessAction, projectMemoryWitnesses } from "./memory-witnesses.js";

const personaId = "persona.player" as PersonaId;
const forum = "aurea.forum" as LocationId;
const questionId = "question.folio.three-witnesses" as QuestionId;

function fixture(minuteOfDay = 14 * 60): ChronicleSaveV2 {
  const question: Question = { id: questionId, textKey: "quaestio.folio.what_are_the_three_witnesses", status: "investigating", relatedClaims: [], relatedEvidence: [], derivedQuestions: [], openedAt: { day: 1, minuteOfDay: 600 } };
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.memory-witnesses" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay },
      locations: { [forum]: { id: forum, illumination: "lit", entityIds: [] } },
      entities: {
        "npc.tomas": { id: "npc.tomas" as EntityId, kind: "character", locationId: forum, state: {} },
        "npc.beatrice": { id: "npc.beatrice" as EntityId, kind: "character", locationId: forum, state: {} },
      },
    },
    personas: { [personaId]: { id: personaId, currentLocation: forum, inventory: [], capabilities: { observatio: 1, litterae: 1, discernimentum: 1 } } },
    knowledgeByPersona: { [personaId]: { ...createEmptyKnowledgeState(), questions: { [questionId]: question } } },
    eventLedger: [],
    scheduledConsequences: [],
    contentVersion: "memory-witnesses-test",
  };
}

describe("memory witness divergence", () => {
  it("requires both memories before source comparison", () => {
    let chronicle = fixture();
    expect(projectMemoryWitnesses(chronicle).availableActions).toContain("hear_tomas");
    chronicle = applyMemoryWitnessAction(chronicle, "hear_tomas");
    expect(projectMemoryWitnesses(chronicle).availableActions).not.toContain("compare_memories");
    chronicle = applyMemoryWitnessAction(chronicle, "hear_beatrice");
    expect(projectMemoryWitnesses(chronicle).availableActions).toContain("compare_memories");
  });

  it("marks Beatrice memory as contaminated by the same forum rumour", () => {
    let chronicle = fixture();
    chronicle = applyMemoryWitnessAction(chronicle, "hear_tomas");
    chronicle = applyMemoryWitnessAction(chronicle, "hear_beatrice");
    chronicle = applyMemoryWitnessAction(chronicle, "compare_memories");

    const knowledge = chronicle.knowledgeByPersona[personaId]!;
    expect(knowledge.claims["claim.memory.beatrice-rumour-contaminated"]?.value).toBe(true);
    expect(knowledge.evidence["evidence.memory.source-comparison"]?.payload.independenceAssessment).toBe("beatrice_not_independent");
    expect(knowledge.evidence["evidence.memory.source-comparison"]?.contradicts).toContain("claim.memory.beatrice.box-3");
    expect(projectMemoryWitnesses(chronicle).compared).toBe(true);
  });

  it("is unavailable outside the Forum social window", () => {
    expect(projectMemoryWitnesses(fixture(12 * 60)).active).toBe(false);
    expect(projectMemoryWitnesses(fixture(17 * 60)).active).toBe(false);
  });
});

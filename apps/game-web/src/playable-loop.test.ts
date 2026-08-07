import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type EventId, type LocationId, type PersonaId, type Question, type QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyPlayableLoopAction, projectPlayableLoop } from "./playable-loop.js";

const personaId = "persona.player" as PersonaId;
const forum = "aurea.forum" as LocationId;
const questionId = "question.folio.three-witnesses" as QuestionId;

function event(type: string, index: number) {
  return { id: `event.playable-loop.${index}` as EventId, type, occurredAt: { day: 1, minuteOfDay: 14 * 60 }, payload: {} };
}

function fixture(): ChronicleSaveV2 {
  const question: Question = {
    id: questionId,
    textKey: "quaestio.folio.what_are_the_three_witnesses",
    status: "investigating",
    relatedClaims: [],
    relatedEvidence: [],
    derivedQuestions: [],
    openedAt: { day: 1, minuteOfDay: 14 * 60 },
  };
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.playable-loop" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 14 * 60 },
      locations: { [forum]: { id: forum, illumination: "lit", entityIds: [] } },
      entities: {},
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: forum,
        inventory: [],
        capabilities: { observatio: 2, litterae: 2, discernimentum: 2 },
      },
    },
    knowledgeByPersona: {
      [personaId]: { ...createEmptyKnowledgeState(), questions: { [questionId]: question } },
    },
    eventLedger: [
      event("TransferBox7Opened", 1),
      event("RecoveredFolioRead", 2),
      event("MissingFolioLedgerChecked", 3),
      event("MiriamIgnisTestimonyReceived", 4),
      event("ThreeWitnessMatterObserved", 5),
      event("ThreeWitnessWordCompared", 6),
    ],
    scheduledConsequences: [],
    contentVersion: "playable-loop-test",
  };
}

describe("playable loop orchestration", () => {
  it("routes memory investigation before allowing the memory family to count", () => {
    let chronicle = fixture();
    let view = projectPlayableLoop(chronicle);

    expect(view.actions.map((action) => action.id)).toContain("memory:hear_tomas");
    expect(view.actions.map((action) => action.id)).toContain("memory:hear_beatrice");
    expect(view.actions.map((action) => action.id)).not.toContain("three:hear_memory");

    chronicle = applyPlayableLoopAction(chronicle, "memory:hear_tomas");
    chronicle = applyPlayableLoopAction(chronicle, "memory:hear_beatrice");
    view = projectPlayableLoop(chronicle);
    expect(view.actions.map((action) => action.id)).toContain("memory:compare_memories");
    expect(view.actions.map((action) => action.id)).not.toContain("three:hear_memory");

    chronicle = applyPlayableLoopAction(chronicle, "memory:compare_memories");
    view = projectPlayableLoop(chronicle);
    expect(view.memoryAssessments.beatrice?.independence).toBe("dependent");
    expect(view.actions.map((action) => action.id)).toContain("three:hear_memory");

    chronicle = applyPlayableLoopAction(chronicle, "three:hear_memory");
    view = projectPlayableLoop(chronicle);
    expect(view.threeWitnesses.complete).toBe(true);
    expect(chronicle.knowledgeByPersona[personaId]?.questions[questionId]?.status).toBe("answered");
    expect(chronicle.eventLedger.some((item) => item.type === "ThreeWitnessesUnderstood")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  type ChronicleId,
  type EventId,
  type EvidenceId,
  type PersonaId,
  type Question,
  type QuestionId,
} from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { projectChronicleLiber } from "./liber.js";

const personaId = "persona.player" as PersonaId;
const questionId = "question.ignis.first-flame" as QuestionId;
const evidenceId = "evidence.ignis.first-line" as EvidenceId;

function fixture(includeRead: boolean): ChronicleSaveV2 {
  const empty = createEmptyKnowledgeState();
  const question: Question = {
    id: questionId,
    textKey: "quaestio.ignis.what_sustains_the_flame",
    status: "open",
    relatedClaims: [],
    relatedEvidence: [evidenceId],
    derivedQuestions: [],
    openedAt: { day: 1, minuteOfDay: 465 },
  };
  const event = (id: string, type: string) => ({
    id: id as EventId,
    type,
    occurredAt: { day: 1, minuteOfDay: 465 },
    payload: {},
  });
  const sequence = [
    event("event.ignis.1", "IgnisOilAdded"),
    event("event.ignis.2", "IgnisWickPlaced"),
    event("event.ignis.3", "IgnisWickSaturated"),
    event("event.ignis.4", "CombustionStarted"),
    ...(includeRead ? [event("event.ignis.5", "IgnisManuscriptRead")] : []),
  ];
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.liber" as ChronicleId,
    activePersonaId: personaId,
    world: { worldId: "world.aurea", timestamp: { day: 1, minuteOfDay: 465 }, locations: {}, entities: {} },
    personas: {},
    knowledgeByPersona: {
      [personaId]: {
        ...empty,
        questions: { [questionId]: question },
      },
    },
    eventLedger: sequence,
    scheduledConsequences: [],
    contentVersion: "liber-test",
  };
}

describe("Chronicle LIBER projection", () => {
  it("does not record an experiment before the player reads the revealed manuscript", () => {
    const liber = projectChronicleLiber(fixture(false));
    expect(liber.experiments).toHaveLength(0);
    expect(liber.diarium).toHaveLength(0);
  });

  it("records canonical Experimentum and Diarium from the completed human loop", () => {
    const liber = projectChronicleLiber(fixture(true));
    expect(liber.experiments).toHaveLength(1);
    expect(liber.experiments[0]?.id).toBe("experiment.ignis.first-flame");
    expect(liber.experiments[0]?.evidenceRefs).toContain(evidenceId);
    expect(liber.diarium).toHaveLength(1);
    expect(liber.diarium[0]?.id).toBe("diarium.ignis.first-flame");
    expect(liber.questionIds).toContain(questionId);
  });
});

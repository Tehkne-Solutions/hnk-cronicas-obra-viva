import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  type ClaimId,
  type EvidenceId,
  type EntityId,
  type KnowledgeNodeId,
  type QuestionId,
} from "@hnk/domain";
import { recordObservation, updateQuestionStatus } from "./index.js";

const at = { day: 1, minuteOfDay: 90 } as const;

describe("IGNIS knowledge", () => {
  it("records only the perceived concept as observation evidence", () => {
    const state = recordObservation(createEmptyKnowledgeState(), {
      perceived: {
        subjectId: "manuscript-01" as EntityId,
        conceptId: "manuscript.visible",
        stage: "noticed",
      },
      at,
      nodeId: "knowledge.manuscript.visible" as KnowledgeNodeId,
      evidenceId: "evidence.manuscript.visible" as EvidenceId,
      claimId: "claim.manuscript.visible" as ClaimId,
    });

    expect(state.nodes["knowledge.manuscript.visible"]?.kind).toBe("document");
    expect(state.claims["claim.manuscript.visible"]?.value).toBe("manuscript.visible");
    expect(state.evidence["evidence.manuscript.visible"]?.payload).toEqual({
      subjectId: "manuscript-01",
      conceptId: "manuscript.visible",
      stage: "noticed",
    });
    expect(JSON.stringify(state)).not.toContain("author");
    expect(JSON.stringify(state)).not.toContain("secret");
  });

  it("advances a concrete QUAESTIO with supporting evidence", () => {
    const questionId = "question.lamp.light" as QuestionId;
    const evidenceId = "evidence.lamp.light" as EvidenceId;
    const initial = {
      ...createEmptyKnowledgeState(),
      questions: {
        [questionId as string]: {
          id: questionId,
          textKey: "question.lamp.light",
          status: "investigating" as const,
          relatedClaims: [],
          relatedEvidence: [],
          derivedQuestions: [],
          openedAt: at,
        },
      },
    };

    const updated = updateQuestionStatus(initial, questionId, "answered", evidenceId);
    expect(updated.questions[questionId as string]?.status).toBe("answered");
    expect(updated.questions[questionId as string]?.relatedEvidence).toContain(evidenceId);
  });
});

import type {
  Claim,
  ClaimId,
  Evidence,
  EvidenceId,
  KnowledgeNode,
  KnowledgeNodeId,
  KnowledgeState,
  Question,
  QuestionId,
  WorldTimestamp,
} from "@hnk/domain";
import type { PerceivedFact } from "@hnk/perception-engine";

export interface ObservationKnowledgeInput {
  readonly perceived: PerceivedFact;
  readonly at: WorldTimestamp;
  readonly nodeId: KnowledgeNodeId;
  readonly evidenceId: EvidenceId;
  readonly claimId: ClaimId;
  readonly sourceRefs?: readonly string[];
}

export function recordObservation(
  state: KnowledgeState,
  input: ObservationKnowledgeInput,
): KnowledgeState {
  const node: KnowledgeNode = Object.freeze({
    id: input.nodeId,
    kind: input.perceived.conceptId.startsWith("manuscript") ? "document" : "phenomenon",
    discoveredAt: input.at,
    sourceRefs: input.sourceRefs ?? [],
  });

  const claim: Claim = Object.freeze({
    id: input.claimId,
    subjectId: input.nodeId,
    predicate: "perceived_as",
    value: input.perceived.conceptId,
    status: "observed",
    createdAt: input.at,
    sourceRefs: [input.evidenceId as string],
  });

  const evidence: Evidence = Object.freeze({
    id: input.evidenceId,
    kind: "observation",
    producedAt: input.at,
    supports: [input.claimId],
    contradicts: [],
    payload: Object.freeze({
      subjectId: input.perceived.subjectId,
      conceptId: input.perceived.conceptId,
      stage: input.perceived.stage,
    }),
  });

  return Object.freeze({
    ...state,
    nodes: Object.freeze({ ...state.nodes, [input.nodeId as string]: node }),
    claims: Object.freeze({ ...state.claims, [input.claimId as string]: claim }),
    evidence: Object.freeze({ ...state.evidence, [input.evidenceId as string]: evidence }),
  });
}

export function updateQuestionStatus(
  state: KnowledgeState,
  questionId: QuestionId,
  status: Question["status"],
  evidenceId?: EvidenceId,
): KnowledgeState {
  const question = state.questions[questionId as string];
  if (!question) return state;

  const relatedEvidence = evidenceId
    ? Array.from(new Set([...question.relatedEvidence, evidenceId]))
    : question.relatedEvidence;

  return Object.freeze({
    ...state,
    questions: Object.freeze({
      ...state.questions,
      [questionId as string]: Object.freeze({ ...question, status, relatedEvidence }),
    }),
  });
}

export {
  assessClaim,
  compareClaimValues,
  evidenceKindsForClaim,
  type ClaimAssessment,
} from "./corroboration.js";

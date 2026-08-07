import type { Claim, ClaimId, Evidence, EvidenceId, EventId, QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";

export type ThreeWitnessAction = "inspect_matter" | "compare_word" | "hear_memory";

const questionId = "question.folio.three-witnesses" as QuestionId;

function hasEvent(chronicle: ChronicleSaveV2, type: string): boolean {
  return chronicle.eventLedger.some((event) => event.type === type);
}

function append(chronicle: ChronicleSaveV2, type: string, payload: Record<string, unknown>): ChronicleSaveV2 {
  return Object.freeze({
    ...chronicle,
    eventLedger: Object.freeze([...chronicle.eventLedger, Object.freeze({
      id: `event.three-witnesses.${chronicle.eventLedger.length + 1}` as EventId,
      type,
      occurredAt: chronicle.world.timestamp,
      payload: Object.freeze(payload),
    })]),
  });
}

export interface ThreeWitnessesView {
  readonly active: boolean;
  readonly complete: boolean;
  readonly families: Readonly<{ matter: boolean; word: boolean; memory: boolean }>;
  readonly availableActions: readonly ThreeWitnessAction[];
  readonly text: string;
}

export function projectThreeWitnesses(chronicle: ChronicleSaveV2): ThreeWitnessesView {
  const question = chronicle.knowledgeByPersona[chronicle.activePersonaId as string]?.questions[questionId as string];
  if (!question) return { active: false, complete: false, families: { matter: false, word: false, memory: false }, availableActions: [], text: "" };

  const matter = hasEvent(chronicle, "ThreeWitnessMatterObserved");
  const word = hasEvent(chronicle, "ThreeWitnessWordCompared");
  const memory = hasEvent(chronicle, "ThreeWitnessMemoryHeard");
  const complete = matter && word && memory;
  const availableActions: ThreeWitnessAction[] = [];
  if (!matter) availableActions.push("inspect_matter");
  if (!word) availableActions.push("compare_word");
  if (!memory) availableActions.push("hear_memory");

  const count = [matter, word, memory].filter(Boolean).length;
  const text = complete
    ? "As três testemunhas não são três pessoas, mas três modos de conhecer: a matéria preserva marcas; a palavra preserva afirmações; a memória preserva experiência. Nenhuma delas, isoladamente, basta."
    : count === 0
      ? "O fólio fala em três testemunhas. A frase permanece obscura até que você procure o que o mundo material, os registros e as pessoas conservam de um mesmo acontecimento."
      : `Você reuniu ${count} de 3 famílias de evidência. A resposta ainda não pode ser reduzida a uma única fonte.`;

  return { active: question.status !== "answered", complete, families: { matter, word, memory }, availableActions: Object.freeze(availableActions), text };
}

function addFamilyEvidence(
  chronicle: ChronicleSaveV2,
  claim: Claim,
  evidence: Evidence,
  eventType: string,
): ChronicleSaveV2 {
  const personaKey = chronicle.activePersonaId as string;
  const knowledge = chronicle.knowledgeByPersona[personaKey];
  const question = knowledge?.questions[questionId as string];
  if (!knowledge || !question || knowledge.claims[claim.id as string]) return chronicle;

  const nextQuestion = Object.freeze({
    ...question,
    status: "investigating" as const,
    relatedClaims: Object.freeze([...new Set([...question.relatedClaims, claim.id])]),
    relatedEvidence: Object.freeze([...new Set([...question.relatedEvidence, evidence.id])]),
  });
  const nextKnowledge = Object.freeze({
    ...knowledge,
    claims: Object.freeze({ ...knowledge.claims, [claim.id as string]: claim }),
    evidence: Object.freeze({ ...knowledge.evidence, [evidence.id as string]: evidence }),
    questions: Object.freeze({ ...knowledge.questions, [questionId as string]: nextQuestion }),
  });
  let next = append(Object.freeze({
    ...chronicle,
    knowledgeByPersona: Object.freeze({ ...chronicle.knowledgeByPersona, [personaKey]: nextKnowledge }),
  }), eventType, { claimId: claim.id, evidenceId: evidence.id, questionId });

  const after = projectThreeWitnesses(next);
  if (after.complete && !hasEvent(next, "ThreeWitnessesUnderstood")) {
    const finalClaimId = "claim.folio.three-witnesses-principle" as ClaimId;
    const finalEvidenceId = "evidence.folio.three-witnesses-convergence" as EvidenceId;
    const finalClaim: Claim = Object.freeze({
      id: finalClaimId,
      subjectId: questionId as never,
      predicate: "three_witnesses_principle",
      value: Object.freeze(["matter", "word", "memory"]),
      status: "supported",
      createdAt: next.world.timestamp,
      sourceRefs: Object.freeze([finalEvidenceId as string]),
    });
    const familyEvidence = [
      "evidence.folio.witness-matter",
      "evidence.folio.witness-word",
      "evidence.folio.witness-memory",
    ] as EvidenceId[];
    const finalEvidence: Evidence = Object.freeze({
      id: finalEvidenceId,
      kind: "event",
      producedAt: next.world.timestamp,
      supports: Object.freeze([finalClaimId]),
      contradicts: Object.freeze([]),
      payload: Object.freeze({ familyEvidence, convergenceRequired: true }),
    });
    const latestKnowledge = next.knowledgeByPersona[personaKey]!;
    const answered = Object.freeze({
      ...latestKnowledge.questions[questionId as string]!,
      status: "answered" as const,
      relatedClaims: Object.freeze([...new Set([...latestKnowledge.questions[questionId as string]!.relatedClaims, finalClaimId])]),
      relatedEvidence: Object.freeze([...new Set([...latestKnowledge.questions[questionId as string]!.relatedEvidence, finalEvidenceId])]),
    });
    const resolvedKnowledge = Object.freeze({
      ...latestKnowledge,
      claims: Object.freeze({ ...latestKnowledge.claims, [finalClaimId as string]: finalClaim }),
      evidence: Object.freeze({ ...latestKnowledge.evidence, [finalEvidenceId as string]: finalEvidence }),
      questions: Object.freeze({ ...latestKnowledge.questions, [questionId as string]: answered }),
    });
    next = append(Object.freeze({
      ...next,
      knowledgeByPersona: Object.freeze({ ...next.knowledgeByPersona, [personaKey]: resolvedKnowledge }),
    }), "ThreeWitnessesUnderstood", { questionId, families: ["matter", "word", "memory"] });
  }
  return next;
}

export function applyThreeWitnessAction(chronicle: ChronicleSaveV2, action: ThreeWitnessAction): ChronicleSaveV2 {
  const view = projectThreeWitnesses(chronicle);
  if (!view.availableActions.includes(action)) return chronicle;

  if (action === "inspect_matter") {
    const claimId = "claim.folio.witness-matter" as ClaimId;
    const evidenceId = "evidence.folio.witness-matter" as EvidenceId;
    const claim: Claim = Object.freeze({ id: claimId, subjectId: questionId as never, predicate: "witness_family", value: "matter", status: "observed", createdAt: chronicle.world.timestamp, sourceRefs: [evidenceId as string] });
    const evidence: Evidence = Object.freeze({ id: evidenceId, kind: "artifact", producedAt: chronicle.world.timestamp, supports: [claimId], contradicts: [], payload: Object.freeze({ examples: ["burn pattern", "watermark", "fibre", "seal residue"] }) });
    return addFamilyEvidence(chronicle, claim, evidence, "ThreeWitnessMatterObserved");
  }

  if (action === "compare_word") {
    const claimId = "claim.folio.witness-word" as ClaimId;
    const evidenceId = "evidence.folio.witness-word" as EvidenceId;
    const claim: Claim = Object.freeze({ id: claimId, subjectId: questionId as never, predicate: "witness_family", value: "word", status: "supported", createdAt: chronicle.world.timestamp, sourceRefs: [evidenceId as string] });
    const evidence: Evidence = Object.freeze({ id: evidenceId, kind: "document", producedAt: chronicle.world.timestamp, supports: [claimId], contradicts: [], payload: Object.freeze({ examples: ["folio text", "transfer ledger", "marginalia"] }) });
    return addFamilyEvidence(chronicle, claim, evidence, "ThreeWitnessWordCompared");
  }

  const claimId = "claim.folio.witness-memory" as ClaimId;
  const evidenceId = "evidence.folio.witness-memory" as EvidenceId;
  const claim: Claim = Object.freeze({ id: claimId, subjectId: questionId as never, predicate: "witness_family", value: "memory", status: "reported", createdAt: chronicle.world.timestamp, sourceRefs: [evidenceId as string] });
  const evidence: Evidence = Object.freeze({ id: evidenceId, kind: "testimony", producedAt: chronicle.world.timestamp, supports: [claimId], contradicts: [], payload: Object.freeze({ examples: ["Miriam testimony", "Forum rumour"], caveat: "memory can be incomplete or distorted" }) });
  return addFamilyEvidence(chronicle, claim, evidence, "ThreeWitnessMemoryHeard");
}

export const THREE_WITNESS_ACTION_LABEL: Readonly<Record<ThreeWitnessAction, string>> = Object.freeze({
  inspect_matter: "Investigar a testemunha da Matéria",
  compare_word: "Comparar a testemunha da Palavra",
  hear_memory: "Investigar a testemunha da Memória",
});

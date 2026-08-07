import type { Claim, ClaimId, EntityId, Evidence, EvidenceId, EventId, LocationId, QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";

export type MemoryWitnessAction = "hear_tomas" | "hear_beatrice" | "compare_memories";

const forum = "aurea.forum" as LocationId;
const questionId = "question.folio.three-witnesses" as QuestionId;
const tomasId = "npc.tomas" as EntityId;
const beatriceId = "npc.beatrice" as EntityId;

function hasEvent(chronicle: ChronicleSaveV2, type: string): boolean {
  return chronicle.eventLedger.some((event) => event.type === type);
}

function append(chronicle: ChronicleSaveV2, type: string, payload: Record<string, unknown>): ChronicleSaveV2 {
  return Object.freeze({
    ...chronicle,
    eventLedger: Object.freeze([...chronicle.eventLedger, Object.freeze({
      id: `event.memory-witness.${chronicle.eventLedger.length + 1}` as EventId,
      type,
      occurredAt: chronicle.world.timestamp,
      payload: Object.freeze(payload),
    })]),
  });
}

export interface MemoryWitnessView {
  readonly active: boolean;
  readonly tomasHeard: boolean;
  readonly beatriceHeard: boolean;
  readonly compared: boolean;
  readonly availableActions: readonly MemoryWitnessAction[];
  readonly text: string;
}

export function projectMemoryWitnesses(chronicle: ChronicleSaveV2): MemoryWitnessView {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  const question = chronicle.knowledgeByPersona[chronicle.activePersonaId as string]?.questions[questionId as string];
  const minute = chronicle.world.timestamp.minuteOfDay;
  const active = Boolean(question && question.status !== "answered" && persona?.currentLocation === forum && minute >= 13 * 60 && minute < 17 * 60);
  const tomasHeard = hasEvent(chronicle, "TomasMemoryHeard");
  const beatriceHeard = hasEvent(chronicle, "BeatriceMemoryHeard");
  const compared = hasEvent(chronicle, "MemoryWitnessesCompared");
  const availableActions: MemoryWitnessAction[] = [];
  if (active && !tomasHeard) availableActions.push("hear_tomas");
  if (active && !beatriceHeard) availableActions.push("hear_beatrice");
  if (active && tomasHeard && beatriceHeard && !compared) availableActions.push("compare_memories");

  const text = compared
    ? "As lembranças não são independentes: Beatrice admite ter ouvido a versão da caixa 3 antes de reconstruir sua própria memória. Tomas descreve o selo e a direção do carregamento sem citar a caixa. Duas vozes não equivalem automaticamente a duas fontes."
    : tomasHeard && beatriceHeard
      ? "As duas lembranças divergem. Antes de tratá-las como corroboration, você precisa perguntar de onde cada uma recebeu sua versão."
      : tomasHeard
        ? "Tomas recorda um pacote com selo escuro saindo do Archivum, mas não afirma ter visto o número da caixa."
        : beatriceHeard
          ? "Beatrice insiste na caixa 3, mas sua formulação repete quase palavra por palavra o rumor que já circulava no Forum."
          : "No Forum, Tomas e Beatrice preservam lembranças diferentes do mesmo movimento de documentos.";

  return { active, tomasHeard, beatriceHeard, compared, availableActions: Object.freeze(availableActions), text };
}

function recordMemory(
  chronicle: ChronicleSaveV2,
  witnessId: EntityId,
  claimId: ClaimId,
  evidenceId: EvidenceId,
  value: unknown,
  eventType: string,
  payload: Record<string, unknown>,
): ChronicleSaveV2 {
  const personaKey = chronicle.activePersonaId as string;
  const knowledge = chronicle.knowledgeByPersona[personaKey];
  const question = knowledge?.questions[questionId as string];
  if (!knowledge || !question || knowledge.claims[claimId as string]) return chronicle;

  const claim: Claim = Object.freeze({
    id: claimId,
    subjectId: questionId as never,
    predicate: "memory_witness_report",
    value,
    status: "reported",
    createdAt: chronicle.world.timestamp,
    assertedBy: Object.freeze({ id: witnessId, kind: "character" }),
    sourceRefs: Object.freeze([evidenceId as string]),
  });
  const evidence: Evidence = Object.freeze({
    id: evidenceId,
    kind: "testimony",
    producedAt: chronicle.world.timestamp,
    sourceRef: Object.freeze({ id: witnessId, kind: "character" }),
    supports: Object.freeze([claimId]),
    contradicts: Object.freeze([]),
    payload: Object.freeze(payload),
  });
  const nextQuestion = Object.freeze({
    ...question,
    status: "investigating" as const,
    relatedClaims: Object.freeze([...new Set([...question.relatedClaims, claimId])]),
    relatedEvidence: Object.freeze([...new Set([...question.relatedEvidence, evidenceId])]),
  });
  const nextKnowledge = Object.freeze({
    ...knowledge,
    claims: Object.freeze({ ...knowledge.claims, [claimId as string]: claim }),
    evidence: Object.freeze({ ...knowledge.evidence, [evidenceId as string]: evidence }),
    questions: Object.freeze({ ...knowledge.questions, [questionId as string]: nextQuestion }),
  });
  return append(Object.freeze({
    ...chronicle,
    knowledgeByPersona: Object.freeze({ ...chronicle.knowledgeByPersona, [personaKey]: nextKnowledge }),
  }), eventType, { witnessId, claimId, evidenceId });
}

export function applyMemoryWitnessAction(chronicle: ChronicleSaveV2, action: MemoryWitnessAction): ChronicleSaveV2 {
  const view = projectMemoryWitnesses(chronicle);
  if (!view.availableActions.includes(action)) return chronicle;

  if (action === "hear_tomas") {
    return recordMemory(
      chronicle,
      tomasId,
      "claim.memory.tomas.sealed-package" as ClaimId,
      "evidence.memory.tomas.sealed-package" as EvidenceId,
      Object.freeze({ package: "sealed", direction: "out_of_archivum", boxNumberSeen: false }),
      "TomasMemoryHeard",
      { directMemory: true, heardFromOthers: false, uncertainty: "box number not seen" },
    );
  }
  if (action === "hear_beatrice") {
    return recordMemory(
      chronicle,
      beatriceId,
      "claim.memory.beatrice.box-3" as ClaimId,
      "evidence.memory.beatrice.box-3" as EvidenceId,
      "archivum.transfer-box.3",
      "BeatriceMemoryHeard",
      { directMemory: "partial", heardForumRumourBeforeRecall: true, contaminationRisk: "high" },
    );
  }

  const personaKey = chronicle.activePersonaId as string;
  const knowledge = chronicle.knowledgeByPersona[personaKey];
  if (!knowledge) return chronicle;
  const beatriceClaimId = "claim.memory.beatrice.box-3" as ClaimId;
  const rumourClaimId = "claim.folio.rumour-box-3" as ClaimId;
  const contaminationClaimId = "claim.memory.beatrice-rumour-contaminated" as ClaimId;
  const contaminationEvidenceId = "evidence.memory.source-comparison" as EvidenceId;
  const contaminationClaim: Claim = Object.freeze({
    id: contaminationClaimId,
    subjectId: beatriceId,
    predicate: "memory_contaminated_by_prior_report",
    value: true,
    status: "supported",
    createdAt: chronicle.world.timestamp,
    sourceRefs: Object.freeze([contaminationEvidenceId as string]),
  });
  const contradictionTargets = [beatriceClaimId, rumourClaimId].filter((id) => Boolean(knowledge.claims[id as string]));
  const evidence: Evidence = Object.freeze({
    id: contaminationEvidenceId,
    kind: "event",
    producedAt: chronicle.world.timestamp,
    supports: Object.freeze([contaminationClaimId]),
    contradicts: Object.freeze(contradictionTargets),
    payload: Object.freeze({
      comparedWitnesses: [tomasId, beatriceId],
      sharedInformationPath: "forum-rumour-box-3",
      independenceAssessment: "beatrice_not_independent",
      lesson: "multiple speakers can share one source",
    }),
  });
  const nextKnowledge = Object.freeze({
    ...knowledge,
    claims: Object.freeze({ ...knowledge.claims, [contaminationClaimId as string]: contaminationClaim }),
    evidence: Object.freeze({ ...knowledge.evidence, [contaminationEvidenceId as string]: evidence }),
  });
  return append(Object.freeze({
    ...chronicle,
    knowledgeByPersona: Object.freeze({ ...chronicle.knowledgeByPersona, [personaKey]: nextKnowledge }),
  }), "MemoryWitnessesCompared", {
    witnesses: [tomasId, beatriceId],
    contaminatedWitnessId: beatriceId,
    sharedSource: "forum-rumour-box-3",
  });
}

export const MEMORY_WITNESS_ACTION_LABEL: Readonly<Record<MemoryWitnessAction, string>> = Object.freeze({
  hear_tomas: "Ouvir a lembrança de Tomas",
  hear_beatrice: "Ouvir a lembrança de Beatrice",
  compare_memories: "Comparar a origem das duas lembranças",
});

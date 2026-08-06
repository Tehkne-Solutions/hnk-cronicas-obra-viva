import type { Claim, ClaimId, Evidence, EvidenceId, EventId, LocationId, QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";

export type MissingFolioAction = "inspect_transfer_ledger" | "follow_forum_rumour";

const archivum = "aurea.archivum" as LocationId;
const forum = "aurea.forum" as LocationId;
const questionId = "question.ignis.missing-folio" as QuestionId;

function hasEvent(chronicle: ChronicleSaveV2, type: string): boolean {
  return chronicle.eventLedger.some((event) => event.type === type);
}

function append(chronicle: ChronicleSaveV2, type: string, payload: Record<string, unknown>): ChronicleSaveV2 {
  const event = Object.freeze({
    id: `event.missing-folio.${chronicle.eventLedger.length + 1}` as EventId,
    type,
    occurredAt: chronicle.world.timestamp,
    payload: Object.freeze(payload),
  });
  return Object.freeze({ ...chronicle, eventLedger: Object.freeze([...chronicle.eventLedger, event]) });
}

export interface MissingFolioView {
  readonly active: boolean;
  readonly complete: boolean;
  readonly availableActions: readonly MissingFolioAction[];
  readonly text: string;
}

export function projectMissingFolioInvestigation(chronicle: ChronicleSaveV2): MissingFolioView {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  const question = chronicle.knowledgeByPersona[chronicle.activePersonaId as string]?.questions[questionId as string];
  if (!persona || !question || question.status === "open") return { active: false, complete: false, availableActions: [], text: "" };

  const ledgerDone = hasEvent(chronicle, "MissingFolioLedgerChecked");
  const rumourDone = hasEvent(chronicle, "MissingFolioRumourHeard");
  const complete = ledgerDone && rumourDone;
  const availableActions: MissingFolioAction[] = [];
  if (persona.currentLocation === archivum && !ledgerDone) availableActions.push("inspect_transfer_ledger");
  if (persona.currentLocation === forum && !rumourDone) availableActions.push("follow_forum_rumour");

  const text = complete
    ? "As pistas entram em conflito: o livro de transferências aponta para a caixa 7, enquanto o rumor do Forum fala na caixa 3. A contradição agora é conhecimento explícito, não um erro silencioso do sistema."
    : persona.currentLocation === archivum
      ? "O registro de transferências pode indicar para qual caixa o fólio foi encaminhado."
      : persona.currentLocation === forum
        ? "No Forum circula uma versão oral sobre uma caixa retirada às pressas do Archivum."
        : "A questão do fólio ausente permanece aberta. Há uma trilha documental no Archivum e uma trilha oral no Forum.";

  return { active: true, complete, availableActions, text };
}

function addEvidence(
  chronicle: ChronicleSaveV2,
  claim: Claim,
  evidence: Evidence,
  eventType: string,
): ChronicleSaveV2 {
  const personaKey = chronicle.activePersonaId as string;
  const knowledge = chronicle.knowledgeByPersona[personaKey];
  const question = knowledge?.questions[questionId as string];
  if (!knowledge || !question) return chronicle;

  const nextQuestion = Object.freeze({
    ...question,
    status: "investigating" as const,
    relatedClaims: Object.freeze([...question.relatedClaims, claim.id]),
    relatedEvidence: Object.freeze([...question.relatedEvidence, evidence.id]),
  });
  const nextKnowledge = Object.freeze({
    ...knowledge,
    claims: Object.freeze({ ...knowledge.claims, [claim.id as string]: claim }),
    evidence: Object.freeze({ ...knowledge.evidence, [evidence.id as string]: evidence }),
    questions: Object.freeze({ ...knowledge.questions, [questionId as string]: nextQuestion }),
  });
  let next = Object.freeze({
    ...chronicle,
    knowledgeByPersona: Object.freeze({ ...chronicle.knowledgeByPersona, [personaKey]: nextKnowledge }),
  });
  next = append(next, eventType, { claimId: claim.id, evidenceId: evidence.id, questionId });
  if (hasEvent(next, "MissingFolioLedgerChecked") && hasEvent(next, "MissingFolioRumourHeard") && !hasEvent(next, "MissingFolioEvidenceCompared")) {
    next = append(next, "MissingFolioEvidenceCompared", { questionId, status: "contested" });
  }
  return next;
}

export function applyMissingFolioAction(chronicle: ChronicleSaveV2, action: MissingFolioAction): ChronicleSaveV2 {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  const question = chronicle.knowledgeByPersona[chronicle.activePersonaId as string]?.questions[questionId as string];
  if (!persona || !question) return chronicle;

  if (action === "inspect_transfer_ledger") {
    if (persona.currentLocation !== archivum || hasEvent(chronicle, "MissingFolioLedgerChecked")) return chronicle;
    const claimId = "claim.folio.transfer-box-7" as ClaimId;
    const evidenceId = "evidence.folio.archivum-ledger" as EvidenceId;
    const claim: Claim = Object.freeze({
      id: claimId,
      subjectId: questionId as never,
      predicate: "folio_last_recorded_container",
      value: "archivum.transfer-box.7",
      status: "supported",
      createdAt: chronicle.world.timestamp,
      sourceRefs: Object.freeze([evidenceId as string]),
    });
    const evidence: Evidence = Object.freeze({
      id: evidenceId,
      kind: "document",
      producedAt: chronicle.world.timestamp,
      supports: Object.freeze([claimId]),
      contradicts: Object.freeze([]),
      payload: Object.freeze({ source: "archivum.transfer-ledger", box: 7 }),
    });
    return addEvidence(chronicle, claim, evidence, "MissingFolioLedgerChecked");
  }

  if (persona.currentLocation !== forum || hasEvent(chronicle, "MissingFolioRumourHeard")) return chronicle;
  const claimId = "claim.folio.rumour-box-3" as ClaimId;
  const evidenceId = "evidence.folio.forum-rumour" as EvidenceId;
  const claim: Claim = Object.freeze({
    id: claimId,
    subjectId: questionId as never,
    predicate: "folio_last_seen_container",
    value: "archivum.transfer-box.3",
    status: "reported",
    createdAt: chronicle.world.timestamp,
    sourceRefs: Object.freeze([evidenceId as string]),
  });
  const evidence: Evidence = Object.freeze({
    id: evidenceId,
    kind: "testimony",
    producedAt: chronicle.world.timestamp,
    supports: Object.freeze([claimId]),
    contradicts: Object.freeze([]),
    payload: Object.freeze({ source: "forum.courier-rumour", box: 3, certainty: "hearsay" }),
  });
  return addEvidence(chronicle, claim, evidence, "MissingFolioRumourHeard");
}

export const MISSING_FOLIO_ACTION_LABEL: Readonly<Record<MissingFolioAction, string>> = Object.freeze({
  inspect_transfer_ledger: "Examinar o livro de transferências",
  follow_forum_rumour: "Ouvir o rumor dos carregadores no Forum",
});

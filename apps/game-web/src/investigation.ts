import type {
  Claim,
  ClaimId,
  Evidence,
  EvidenceId,
  EventId,
  KnowledgeNodeId,
  LocationId,
  Question,
  QuestionId,
} from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";

export type IgnisInvestigationAction = "archivum_catalogue" | "typographia_lamp_record";

const archivum = "aurea.archivum" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const questionId = "question.ignis.first-flame" as QuestionId;
const firstLineNodeId = "knowledge.ignis.first-line" as KnowledgeNodeId;

export interface IgnisInvestigationView {
  readonly active: boolean;
  readonly complete: boolean;
  readonly availableActions: readonly IgnisInvestigationAction[];
  readonly text: string;
}

function append(chronicle: ChronicleSaveV2, type: string, payload: Record<string, unknown>): ChronicleSaveV2 {
  const event = Object.freeze({
    id: `event.investigation.${chronicle.eventLedger.length + 1}` as EventId,
    type,
    occurredAt: chronicle.world.timestamp,
    payload: Object.freeze(payload),
  });
  return Object.freeze({ ...chronicle, eventLedger: Object.freeze([...chronicle.eventLedger, event]) });
}

function hasEvent(chronicle: ChronicleSaveV2, type: string): boolean {
  return chronicle.eventLedger.some((event) => event.type === type);
}

function typographiaIsOpen(chronicle: ChronicleSaveV2): boolean {
  const minute = chronicle.world.timestamp.minuteOfDay;
  return minute >= 9 * 60 && minute < 15 * 60;
}

export function projectIgnisInvestigation(chronicle: ChronicleSaveV2): IgnisInvestigationView {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  const knowledge = chronicle.knowledgeByPersona[chronicle.activePersonaId as string];
  const question = knowledge?.questions[questionId as string];
  if (!persona || !question) return { active: false, complete: false, availableActions: [], text: "" };

  const archivumDone = hasEvent(chronicle, "IgnisArchivumEvidenceFound");
  const typographiaDone = hasEvent(chronicle, "IgnisTypographiaEvidenceFound");
  const complete = archivumDone && typographiaDone;
  const availableActions: IgnisInvestigationAction[] = [];

  if (persona.currentLocation === archivum && !archivumDone) availableActions.push("archivum_catalogue");
  if (persona.currentLocation === typographia && typographiaIsOpen(chronicle) && !typographiaDone) {
    availableActions.push("typographia_lamp_record");
  }

  const text = complete
    ? "As duas fontes convergem: a chama sustentada não depende apenas da centelha. Ela exige combustível adequado e alimentação contínua pelo pavio. A primeira QUAESTIO está respondida."
    : persona.currentLocation === archivum
      ? archivumDone
        ? "O catálogo já forneceu uma peça da resposta. Ainda falta confrontar esse registro com uma fonte técnica da Typographia."
        : "Entre os catálogos de ofícios há referências a combustíveis de lamparina. Uma consulta pode testar se o óleo usado na Officina era escolha casual ou prática conhecida."
      : persona.currentLocation === typographia
        ? !typographiaIsOpen(chronicle)
          ? "A Typographia está fechada. O registro técnico dos lampiões da prensa só poderá ser consultado entre 09:00 e 15:00. Você pode esperar, seguir ao Archivum ou voltar depois."
          : typographiaDone
            ? "O registro técnico da Typographia já está incorporado à investigação. O Archivum ainda pode oferecer contexto documental independente."
            : "Os registros de manutenção dos lampiões da prensa descrevem pavios, reservatórios e falhas de chama. Eles podem revelar o mecanismo que manteve sua lamparina acesa."
        : "A QUAESTIO sobre a primeira chama permanece aberta. O Archivum e a Typographia oferecem caminhos independentes para confrontá-la.";

  return { active: true, complete, availableActions, text };
}

function updateQuestion(
  chronicle: ChronicleSaveV2,
  claim: Claim,
  evidence: Evidence,
  eventType: string,
): ChronicleSaveV2 {
  const personaKey = chronicle.activePersonaId as string;
  const knowledge = chronicle.knowledgeByPersona[personaKey];
  const question = knowledge?.questions[questionId as string];
  if (!knowledge || !question) return chronicle;

  const claimIds = Object.freeze([...question.relatedClaims, claim.id]);
  const evidenceIds = Object.freeze([...question.relatedEvidence, evidence.id]);
  const otherAlreadyFound = eventType === "IgnisArchivumEvidenceFound"
    ? hasEvent(chronicle, "IgnisTypographiaEvidenceFound")
    : hasEvent(chronicle, "IgnisArchivumEvidenceFound");
  const nextQuestion: Question = Object.freeze({
    ...question,
    status: otherAlreadyFound ? "answered" : "partially_answered",
    relatedClaims: claimIds,
    relatedEvidence: evidenceIds,
  });
  const nextKnowledge = Object.freeze({
    ...knowledge,
    claims: Object.freeze({ ...knowledge.claims, [claim.id as string]: claim }),
    evidence: Object.freeze({ ...knowledge.evidence, [evidence.id as string]: evidence }),
    questions: Object.freeze({ ...knowledge.questions, [questionId as string]: nextQuestion }),
  });
  const nextChronicle = Object.freeze({
    ...chronicle,
    knowledgeByPersona: Object.freeze({ ...chronicle.knowledgeByPersona, [personaKey]: nextKnowledge }),
  });
  return append(nextChronicle, eventType, { claimId: claim.id, evidenceId: evidence.id, questionId });
}

export function applyIgnisInvestigationAction(
  chronicle: ChronicleSaveV2,
  action: IgnisInvestigationAction,
): ChronicleSaveV2 {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  const knowledge = chronicle.knowledgeByPersona[chronicle.activePersonaId as string];
  const question = knowledge?.questions[questionId as string];
  if (!persona || !question) return chronicle;

  if (action === "archivum_catalogue") {
    if (persona.currentLocation !== archivum || hasEvent(chronicle, "IgnisArchivumEvidenceFound")) return chronicle;
    const claimId = "claim.ignis.oleum-tradition" as ClaimId;
    const evidenceId = "evidence.ignis.archivum-catalogue" as EvidenceId;
    const claim: Claim = Object.freeze({
      id: claimId,
      subjectId: firstLineNodeId,
      predicate: "oleum_used_as_lamp_fuel",
      value: true,
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
      payload: Object.freeze({ source: "archivum.trade_catalogue", finding: "oleum_as_lamp_fuel" }),
    });
    return updateQuestion(chronicle, claim, evidence, "IgnisArchivumEvidenceFound");
  }

  if (
    persona.currentLocation !== typographia ||
    !typographiaIsOpen(chronicle) ||
    hasEvent(chronicle, "IgnisTypographiaEvidenceFound")
  ) return chronicle;

  const claimId = "claim.ignis.wick-feed" as ClaimId;
  const evidenceId = "evidence.ignis.typographia-lamp-record" as EvidenceId;
  const claim: Claim = Object.freeze({
    id: claimId,
    subjectId: firstLineNodeId,
    predicate: "saturated_wick_feeds_fuel_continuously",
    value: true,
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
    payload: Object.freeze({ source: "typographia.lamp_maintenance_record", finding: "wick_continuous_fuel_feed" }),
  });
  return updateQuestion(chronicle, claim, evidence, "IgnisTypographiaEvidenceFound");
}

export const IGNIS_INVESTIGATION_LABEL: Readonly<Record<IgnisInvestigationAction, string>> = Object.freeze({
  archivum_catalogue: "Consultar o catálogo de combustíveis",
  typographia_lamp_record: "Examinar o registro dos lampiões da prensa",
});

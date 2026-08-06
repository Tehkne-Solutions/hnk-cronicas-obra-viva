import type {
  ClaimId,
  EntityId,
  EvidenceId,
  EventId,
  Question,
  QuestionId,
} from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyDisclosureRules, type RelationState } from "@hnk/relationes-engine";
import {
  recordTestimony,
  speakTestimony,
  type TestimonyActorState,
} from "@hnk/testimonia-engine";

const firstQuestionId = "question.ignis.first-flame" as QuestionId;
const derivedQuestionId = "question.ignis.missing-folio" as QuestionId;
const miriamId = "npc.miriam" as EntityId;

function hasEvent(chronicle: ChronicleSaveV2, type: string): boolean {
  return chronicle.eventLedger.some((event) => event.type === type);
}

function append(chronicle: ChronicleSaveV2, type: string, payload: Record<string, unknown>): ChronicleSaveV2 {
  const event = Object.freeze({
    id: `event.consequence.${chronicle.eventLedger.length + 1}` as EventId,
    type,
    occurredAt: chronicle.world.timestamp,
    payload: Object.freeze(payload),
  });
  return Object.freeze({ ...chronicle, eventLedger: Object.freeze([...chronicle.eventLedger, event]) });
}

export function integrateAnsweredIgnisQuaestio(chronicle: ChronicleSaveV2): ChronicleSaveV2 {
  if (hasEvent(chronicle, "IgnisQuaestioIntegrated")) return chronicle;
  const personaKey = chronicle.activePersonaId as string;
  const persona = chronicle.personas[personaKey];
  const knowledge = chronicle.knowledgeByPersona[personaKey];
  const firstQuestion = knowledge?.questions[firstQuestionId as string];
  if (!persona || !knowledge || firstQuestion?.status !== "answered") return chronicle;

  const nextPersona = Object.freeze({
    ...persona,
    capabilities: Object.freeze({
      ...persona.capabilities,
      litterae: persona.capabilities.litterae + 1,
      discernimentum: persona.capabilities.discernimentum + 1,
    }),
  });
  const derived: Question = Object.freeze({
    id: derivedQuestionId,
    textKey: "quaestio.ignis.where_is_missing_folio",
    status: "open",
    relatedClaims: Object.freeze([]),
    relatedEvidence: Object.freeze([]),
    derivedQuestions: Object.freeze([]),
    openedAt: chronicle.world.timestamp,
  });
  const nextFirst: Question = Object.freeze({
    ...firstQuestion,
    derivedQuestions: Object.freeze([...new Set([...firstQuestion.derivedQuestions, derivedQuestionId])]),
  });
  const nextKnowledge = Object.freeze({
    ...knowledge,
    questions: Object.freeze({
      ...knowledge.questions,
      [firstQuestionId as string]: nextFirst,
      [derivedQuestionId as string]: derived,
    }),
  });
  return append(Object.freeze({
    ...chronicle,
    personas: Object.freeze({ ...chronicle.personas, [personaKey]: nextPersona }),
    knowledgeByPersona: Object.freeze({ ...chronicle.knowledgeByPersona, [personaKey]: nextKnowledge }),
  }), "IgnisQuaestioIntegrated", {
    questionId: firstQuestionId,
    capabilityDelta: { litterae: 1, discernimentum: 1 },
    derivedQuestionId,
  });
}

function relationFromChronicle(chronicle: ChronicleSaveV2): RelationState {
  const demonstratedInquiry = hasEvent(chronicle, "IgnisQuaestioIntegrated");
  return Object.freeze({
    subjectId: miriamId,
    objectId: chronicle.activePersonaId as unknown as EntityId,
    trust: demonstratedInquiry ? 0.15 : 0,
    respect: demonstratedInquiry ? 0.4 : 0,
    affection: 0,
    fear: 0,
    suspicion: 0.05,
    obligation: 0,
  });
}

const miriam: TestimonyActorState = Object.freeze({
  actorId: miriamId,
  knows: Object.freeze([
    Object.freeze({ key: "ignis_manuscript_missing_folio", value: true }),
    Object.freeze({ key: "ignis_missing_folio_last_seen", value: "archivum.transfer-box.7" }),
  ]),
  believes: Object.freeze([
    Object.freeze({ key: "ignis_manuscript_missing_folio", value: true }),
  ]),
  willingToSay: Object.freeze([
    Object.freeze({ key: "ignis_manuscript_missing_folio", value: true }),
    Object.freeze({ key: "ignis_missing_folio_last_seen", value: "archivum.transfer-box.7" }),
  ]),
});

export interface MiriamIgnisView {
  readonly available: boolean;
  readonly text: string;
}

export function projectMiriamIgnisConversation(chronicle: ChronicleSaveV2): MiriamIgnisView {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  const minute = chronicle.world.timestamp.minuteOfDay;
  const miriamPresent = persona?.currentLocation === "aurea.archivum" && minute >= 8 * 60 && minute < 12 * 60;
  const integrated = hasEvent(chronicle, "IgnisQuaestioIntegrated");
  const alreadySpoken = hasEvent(chronicle, "MiriamIgnisTestimonyReceived");
  return {
    available: Boolean(miriamPresent && integrated && !alreadySpoken),
    text: alreadySpoken
      ? "Miriam já lhe disse o que estava disposta a afirmar sobre o manuscrito. O restante exige novas evidências, não insistência."
      : integrated
        ? "Miriam percebe que você não veio pedir uma resposta pronta: você traz duas fontes e uma conclusão própria. Isso muda a forma como ela recebe sua pergunta."
        : "Miriam escuta, mas ainda não há investigação suficiente para que sua pergunta tenha peso diante dela.",
  };
}

export function askMiriamAboutIgnis(chronicle: ChronicleSaveV2): ChronicleSaveV2 {
  if (!projectMiriamIgnisConversation(chronicle).available) return chronicle;
  const gated = applyDisclosureRules(miriam, relationFromChronicle(chronicle), [
    Object.freeze({ propositionKey: "ignis_manuscript_missing_folio", minimumRespect: 0.25 }),
    Object.freeze({ propositionKey: "ignis_missing_folio_last_seen", minimumRespect: 0.65, minimumTrust: 0.35 }),
  ]);
  const spoken = speakTestimony(gated, "ignis_manuscript_missing_folio");
  if (!spoken) return chronicle;

  const personaKey = chronicle.activePersonaId as string;
  let knowledge = chronicle.knowledgeByPersona[personaKey];
  if (!knowledge) return chronicle;
  const claimId = "claim.miriam.ignis-missing-folio" as ClaimId;
  const evidenceId = "evidence.miriam.ignis-missing-folio" as EvidenceId;
  knowledge = recordTestimony(knowledge, spoken, chronicle.world.timestamp, claimId, evidenceId);
  const derived = knowledge.questions[derivedQuestionId as string];
  if (derived) {
    knowledge = Object.freeze({
      ...knowledge,
      questions: Object.freeze({
        ...knowledge.questions,
        [derivedQuestionId as string]: Object.freeze({
          ...derived,
          status: "investigating",
          relatedClaims: Object.freeze([...derived.relatedClaims, claimId]),
          relatedEvidence: Object.freeze([...derived.relatedEvidence, evidenceId]),
        }),
      }),
    });
  }
  return append(Object.freeze({
    ...chronicle,
    knowledgeByPersona: Object.freeze({ ...chronicle.knowledgeByPersona, [personaKey]: knowledge }),
  }), "MiriamIgnisTestimonyReceived", {
    speakerId: miriamId,
    propositionKey: spoken.proposition.key,
    questionId: derivedQuestionId,
  });
}

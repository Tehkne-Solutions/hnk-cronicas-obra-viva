import type { ClaimId, EntityId, EvidenceId, EventId, KnowledgeNodeId, Question, QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import {
  observeScriptum,
  recordProvenanceClaim,
  recordScriptumObservation,
  visibleProvenanceClaims,
  type ScriptumDocument,
  type ScriptumObservation,
} from "@hnk/scriptum-engine";

const folioId = "document.ignis.missing-folio" as EntityId;
const contentQuestionId = "question.folio.three-witnesses" as QuestionId;

export const RECOVERED_FOLIO: ScriptumDocument = Object.freeze({
  entityId: folioId,
  materialKey: "paper.handmade.rag-fibre",
  layers: Object.freeze([
    Object.freeze({ id: "surface", kind: "surface", textKey: "folio.surface.watermarked", requires: { illumination: "dim" } }),
    Object.freeze({ id: "main-text", kind: "text", textKey: "folio.text.three_witnesses", requires: { illumination: "lit", litterae: 1 } }),
    Object.freeze({ id: "burn-damage", kind: "damage", textKey: "folio.damage.scorched_lower_edge", requires: { illumination: "lit", discernimentum: 1 } }),
    Object.freeze({ id: "margin-hand", kind: "marginalia", textKey: "folio.margin.do_not_trust_one_witness", requires: { illumination: "lit", litterae: 1, discernimentum: 1 } }),
    Object.freeze({ id: "scribe-mark", kind: "provenance", textKey: "folio.provenance.scribe_mark", requires: { illumination: "lit", discernimentum: 2 } }),
  ]),
  provenance: Object.freeze([
    Object.freeze({ id: "prov.folio.transfer-ledger", sourceRef: "evidence.folio.transfer-ledger", claimKey: "provenance.folio.transfer-cycle", confidence: "medium" }),
    Object.freeze({ id: "prov.folio.scribe-mark", sourceRef: "evidence.folio.scribe-mark-reference", claimKey: "provenance.folio.ardel-circle", confidence: "low" }),
  ]),
});

function hasEvent(chronicle: ChronicleSaveV2, type: string): boolean {
  return chronicle.eventLedger.some((event) => event.type === type);
}

function append(chronicle: ChronicleSaveV2, type: string, payload: Record<string, unknown>): ChronicleSaveV2 {
  return Object.freeze({
    ...chronicle,
    eventLedger: Object.freeze([...chronicle.eventLedger, Object.freeze({
      id: `event.recovered-folio.${chronicle.eventLedger.length + 1}` as EventId,
      type,
      occurredAt: chronicle.world.timestamp,
      payload: Object.freeze(payload),
    })]),
  });
}

export interface RecoveredFolioView {
  readonly active: boolean;
  readonly observations: readonly ScriptumObservation[];
  readonly unreadLayerCount: number;
  readonly textKeys: readonly string[];
}

export function projectRecoveredFolio(chronicle: ChronicleSaveV2): RecoveredFolioView {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  const recovered = hasEvent(chronicle, "TransferBox7Opened");
  if (!persona || !recovered) return { active: false, observations: [], unreadLayerCount: RECOVERED_FOLIO.layers.length, textKeys: [] };
  const illumination = chronicle.world.locations[persona.currentLocation as string]?.illumination ?? "dark";
  const observations = observeScriptum(RECOVERED_FOLIO, {
    illumination,
    litterae: persona.capabilities.litterae,
    discernimentum: persona.capabilities.discernimentum,
  });
  return {
    active: true,
    observations,
    unreadLayerCount: RECOVERED_FOLIO.layers.length - observations.length,
    textKeys: observations.flatMap((observation) => observation.textKey ? [observation.textKey] : []),
  };
}

export function readRecoveredFolio(chronicle: ChronicleSaveV2): ChronicleSaveV2 {
  const view = projectRecoveredFolio(chronicle);
  if (!view.active || view.observations.length === 0) return chronicle;
  const personaKey = chronicle.activePersonaId as string;
  let knowledge = chronicle.knowledgeByPersona[personaKey];
  if (!knowledge) return chronicle;

  for (const observation of view.observations) {
    const suffix = observation.layerId.replace(/[^a-z0-9-]/gi, "-");
    const claimId = `claim.folio.${suffix}` as ClaimId;
    if (knowledge.claims[claimId as string]) continue;
    knowledge = recordScriptumObservation(knowledge, observation, chronicle.world.timestamp, {
      nodeId: `knowledge.folio.${suffix}` as KnowledgeNodeId,
      claimId,
      evidenceId: `evidence.folio.${suffix}` as EvidenceId,
    });
  }

  const knownSources = Object.keys(knowledge.evidence);
  for (const provenance of visibleProvenanceClaims(RECOVERED_FOLIO, knownSources)) {
    const claimId = `claim.${provenance.id}` as ClaimId;
    if (knowledge.claims[claimId as string]) continue;
    knowledge = recordProvenanceClaim(
      knowledge,
      folioId,
      provenance,
      chronicle.world.timestamp,
      claimId,
      `evidence.${provenance.id}` as EvidenceId,
    );
  }

  const mainTextSeen = Boolean(knowledge.claims["claim.folio.main-text"]);
  if (mainTextSeen && !knowledge.questions[contentQuestionId as string]) {
    const relatedClaims = ["claim.folio.main-text", "claim.folio.margin-hand"].filter((id) => Boolean(knowledge.claims[id]));
    const relatedEvidence = relatedClaims.map((id) => id.replace("claim.", "evidence.")) as unknown as readonly EvidenceId[];
    const question: Question = Object.freeze({
      id: contentQuestionId,
      textKey: "quaestio.folio.what_are_the_three_witnesses",
      status: "open",
      relatedClaims: Object.freeze(relatedClaims as ClaimId[]),
      relatedEvidence: Object.freeze(relatedEvidence),
      derivedQuestions: Object.freeze([]),
      openedAt: chronicle.world.timestamp,
    });
    knowledge = Object.freeze({ ...knowledge, questions: Object.freeze({ ...knowledge.questions, [contentQuestionId as string]: question }) });
  }

  const next = Object.freeze({
    ...chronicle,
    knowledgeByPersona: Object.freeze({ ...chronicle.knowledgeByPersona, [personaKey]: knowledge }),
  });
  if (hasEvent(next, "RecoveredFolioRead")) return next;
  return append(next, "RecoveredFolioRead", {
    documentId: folioId,
    visibleLayers: view.observations.map((observation) => observation.layerId),
    openedQuestionId: mainTextSeen ? contentQuestionId : null,
  });
}

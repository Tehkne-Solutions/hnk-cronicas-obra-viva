import type {
  Claim,
  ClaimId,
  EntityId,
  Evidence,
  EvidenceId,
  KnowledgeNode,
  KnowledgeNodeId,
  KnowledgeState,
  WorldTimestamp,
} from "@hnk/domain";
import type { ProvenanceClaim, ScriptumObservation } from "./index.js";

export interface ScriptumKnowledgeIds {
  readonly nodeId: KnowledgeNodeId;
  readonly claimId: ClaimId;
  readonly evidenceId: EvidenceId;
}

export function recordScriptumObservation(
  state: KnowledgeState,
  observation: ScriptumObservation,
  at: WorldTimestamp,
  ids: ScriptumKnowledgeIds,
): KnowledgeState {
  const node: KnowledgeNode = Object.freeze({
    id: ids.nodeId,
    kind: "document",
    discoveredAt: at,
    sourceRefs: [observation.documentId as string],
  });
  const claim: Claim = Object.freeze({
    id: ids.claimId,
    subjectId: ids.nodeId,
    predicate: `scriptum_${observation.kind}_observed`,
    value: observation.textKey ?? observation.conceptId,
    status: "observed",
    createdAt: at,
    sourceRefs: [ids.evidenceId as string],
  });
  const evidence: Evidence = Object.freeze({
    id: ids.evidenceId,
    kind: "document",
    producedAt: at,
    sourceRef: { id: observation.documentId, kind: "document" },
    supports: [ids.claimId],
    contradicts: [],
    payload: Object.freeze({
      layerId: observation.layerId,
      kind: observation.kind,
      conceptId: observation.conceptId,
      ...(observation.textKey ? { textKey: observation.textKey } : {}),
    }),
  });
  return Object.freeze({
    ...state,
    nodes: Object.freeze({ ...state.nodes, [ids.nodeId as string]: node }),
    claims: Object.freeze({ ...state.claims, [ids.claimId as string]: claim }),
    evidence: Object.freeze({ ...state.evidence, [ids.evidenceId as string]: evidence }),
  });
}

export function recordProvenanceClaim(
  state: KnowledgeState,
  documentId: EntityId,
  provenance: ProvenanceClaim,
  at: WorldTimestamp,
  claimId: ClaimId,
  evidenceId: EvidenceId,
): KnowledgeState {
  const claim: Claim = Object.freeze({
    id: claimId,
    subjectId: documentId,
    predicate: "provenance_claim",
    value: provenance.claimKey,
    status: "reported",
    createdAt: at,
    sourceRefs: provenance.sourceRef ? [provenance.sourceRef] : [],
  });
  const evidence: Evidence = Object.freeze({
    id: evidenceId,
    kind: "document",
    producedAt: at,
    sourceRef: { id: documentId, kind: "document" },
    supports: [claimId],
    contradicts: [],
    payload: Object.freeze({
      provenanceId: provenance.id,
      claimKey: provenance.claimKey,
      sourceRef: provenance.sourceRef ?? null,
    }),
  });
  return Object.freeze({
    ...state,
    claims: Object.freeze({ ...state.claims, [claimId as string]: claim }),
    evidence: Object.freeze({ ...state.evidence, [evidenceId as string]: evidence }),
  });
}

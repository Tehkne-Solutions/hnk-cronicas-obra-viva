import type { Claim, Evidence, KnowledgeState } from "@hnk/domain";

export interface ClaimAssessment {
  readonly claimId: string;
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictingEvidenceIds: readonly string[];
  readonly status: "unsupported" | "supported" | "contested" | "contradicted";
}

export function assessClaim(state: KnowledgeState, claimId: string): ClaimAssessment {
  const supporting: string[] = [];
  const contradicting: string[] = [];

  for (const [evidenceId, evidence] of Object.entries(state.evidence)) {
    if (evidence.supports.some((id) => (id as string) === claimId)) supporting.push(evidenceId);
    if (evidence.contradicts.some((id) => (id as string) === claimId)) contradicting.push(evidenceId);
  }

  const status = supporting.length > 0 && contradicting.length > 0
    ? "contested"
    : contradicting.length > 0
      ? "contradicted"
      : supporting.length > 0
        ? "supported"
        : "unsupported";

  return Object.freeze({
    claimId,
    supportingEvidenceIds: Object.freeze(supporting),
    contradictingEvidenceIds: Object.freeze(contradicting),
    status,
  });
}

export function compareClaimValues(a?: Claim, b?: Claim): "same" | "different" | "unknown" {
  if (!a || !b) return "unknown";
  return Object.is(a.value, b.value) ? "same" : "different";
}

export function evidenceKindsForClaim(state: KnowledgeState, claimId: string): readonly Evidence["kind"][] {
  const kinds = new Set<Evidence["kind"]>();
  for (const evidence of Object.values(state.evidence)) {
    if (
      evidence.supports.some((id) => (id as string) === claimId) ||
      evidence.contradicts.some((id) => (id as string) === claimId)
    ) {
      kinds.add(evidence.kind);
    }
  }
  return Object.freeze([...kinds]);
}

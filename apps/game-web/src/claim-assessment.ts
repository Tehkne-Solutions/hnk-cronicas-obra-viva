import type { KnowledgeState } from "@hnk/domain";
import { assessClaim, evidenceKindsForClaim, type ClaimAssessment } from "@hnk/knowledge-engine";

export type ClaimAssessmentLabel = "Sem suporte" | "Apoiada" | "Contestada" | "Contradita";

export interface ClaimAssessmentView {
  readonly claimId: string;
  readonly label: ClaimAssessmentLabel;
  readonly supportingCount: number;
  readonly contradictingCount: number;
  readonly evidenceKinds: readonly string[];
  readonly independence: "independent" | "dependent" | "unknown";
  readonly note?: string;
}

const labels: Readonly<Record<ClaimAssessment["status"], ClaimAssessmentLabel>> = Object.freeze({
  unsupported: "Sem suporte",
  supported: "Apoiada",
  contested: "Contestada",
  contradicted: "Contradita",
});

function dependencyForClaim(state: KnowledgeState, claimId: string): Pick<ClaimAssessmentView, "independence" | "note"> {
  if (claimId === "claim.memory.beatrice.box-3") {
    const comparison = state.evidence["evidence.memory.source-comparison"];
    if (comparison?.payload.independenceAssessment === "beatrice_not_independent") {
      return {
        independence: "dependent",
        note: "A lembrança de Beatrice deriva do mesmo rumor público da caixa 3; não conta como fonte independente.",
      };
    }
    return {
      independence: "unknown",
      note: "A origem da lembrança ainda não foi comparada com outras fontes.",
    };
  }

  if (claimId === "claim.folio.rumour-box-3") {
    const comparison = state.evidence["evidence.memory.source-comparison"];
    if (comparison?.payload.sharedInformationPath === "forum-rumour-box-3") {
      return {
        independence: "dependent",
        note: "O relato de Beatrice repete este mesmo caminho informacional; duas vozes continuam sendo uma origem.",
      };
    }
    return { independence: "unknown" };
  }

  if (claimId === "claim.memory.tomas.sealed-package") {
    return {
      independence: "independent",
      note: "Tomas relata memória direta parcial e não atribui número à caixa.",
    };
  }

  return { independence: "unknown" };
}

export function projectClaimAssessment(state: KnowledgeState, claimId: string): ClaimAssessmentView {
  const assessment = assessClaim(state, claimId);
  const dependency = dependencyForClaim(state, claimId);
  return Object.freeze({
    claimId,
    label: labels[assessment.status],
    supportingCount: assessment.supportingEvidenceIds.length,
    contradictingCount: assessment.contradictingEvidenceIds.length,
    evidenceKinds: Object.freeze(evidenceKindsForClaim(state, claimId).map(String)),
    ...dependency,
  });
}

export interface MemoryAssessmentView {
  readonly tomas?: ClaimAssessmentView;
  readonly beatrice?: ClaimAssessmentView;
  readonly forumRumour?: ClaimAssessmentView;
  readonly contamination?: ClaimAssessmentView;
  readonly summary: string;
}

export function projectMemoryAssessments(state: KnowledgeState): MemoryAssessmentView {
  const tomas = state.claims["claim.memory.tomas.sealed-package"]
    ? projectClaimAssessment(state, "claim.memory.tomas.sealed-package")
    : undefined;
  const beatrice = state.claims["claim.memory.beatrice.box-3"]
    ? projectClaimAssessment(state, "claim.memory.beatrice.box-3")
    : undefined;
  const forumRumour = state.claims["claim.folio.rumour-box-3"]
    ? projectClaimAssessment(state, "claim.folio.rumour-box-3")
    : undefined;
  const contamination = state.claims["claim.memory.beatrice-rumour-contaminated"]
    ? projectClaimAssessment(state, "claim.memory.beatrice-rumour-contaminated")
    : undefined;

  const dependencyKnown = beatrice?.independence === "dependent";
  const summary = dependencyKnown
    ? "A aparente repetição da caixa 3 não aumenta a corroboration: Beatrice e o rumor compartilham a mesma origem informacional."
    : beatrice && forumRumour
      ? "Há duas vozes apontando para a caixa 3, mas a independência entre elas ainda não foi demonstrada."
      : tomas || beatrice
        ? "Há memória disponível, mas ainda falta comparar a origem das versões antes de tratá-las como corroboration."
        : "Nenhuma memória foi avaliada ainda.";

  return Object.freeze({
    ...(tomas ? { tomas } : {}),
    ...(beatrice ? { beatrice } : {}),
    ...(forumRumour ? { forumRumour } : {}),
    ...(contamination ? { contamination } : {}),
    summary,
  });
}

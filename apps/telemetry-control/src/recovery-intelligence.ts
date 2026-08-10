import type { IncidentLifecycle } from "./incident-lifecycle.js";

export type RecoveryDecision = "continue" | "investigate" | "block_promotion" | "rollback_recommended";

export interface RecoveryRecommendation {
  readonly decision: RecoveryDecision;
  readonly score: number;
  readonly reason: string;
  readonly fingerprint: string;
  readonly domain: string;
  readonly lifecycleState: IncidentLifecycle["lifecycleState"];
  readonly candidateSha?: string;
}

function riskScore(incident: IncidentLifecycle): number {
  let score = incident.severity === "fatal" ? 70 : 35;
  if (incident.domain === "release_infrastructure") score += 20;
  if (incident.domain === "persistence") score += 15;
  if (incident.state === "recurrent") score += 15;
  if (incident.state === "known_regression") score += 10;
  score += Math.min(incident.reopenCount * 10, 20);
  score += Math.min(Math.max(incident.occurrences - 1, 0) * 3, 15);
  if (incident.lifecycleState === "resolved") score -= 80;
  if (incident.lifecycleState === "mitigated") score -= 25;
  return Math.max(0, Math.min(100, score));
}

export function recommendRecovery(incident: IncidentLifecycle): RecoveryRecommendation {
  const score = riskScore(incident);
  let decision: RecoveryDecision;
  if (incident.lifecycleState === "resolved") decision = "continue";
  else if (score >= 80 || (incident.severity === "fatal" && incident.state !== "new")) decision = "rollback_recommended";
  else if (score >= 55 || incident.lifecycleState === "open") decision = "block_promotion";
  else decision = "investigate";

  const reason = decision === "rollback_recommended"
    ? `Risco ${score}/100: regressão ${incident.state}, domínio ${incident.domain}, ${incident.occurrences} ocorrência(s) e ${incident.reopenCount} reabertura(s). Reverter para último SHA saudável antes de nova promoção.`
    : decision === "block_promotion"
      ? `Risco ${score}/100: incidente ativo ainda não controlado. Bloquear novas promoções e investigar ${incident.domain}.`
      : decision === "investigate"
        ? `Risco ${score}/100: mitigação parcial ou sinal moderado. Manter observação e concluir investigação antes de liberar novo release.`
        : `Risco ${score}/100: incidente resolvido; fluxo pode continuar, mantendo sentinela pós-release.`;

  return Object.freeze({ decision, score, reason, fingerprint: incident.fingerprint, domain: incident.domain, lifecycleState: incident.lifecycleState, ...(incident.candidateSha ? { candidateSha: incident.candidateSha } : {}) });
}

export function recoveryDecisionRank(decision: RecoveryDecision): number {
  return ({ continue: 0, investigate: 1, block_promotion: 2, rollback_recommended: 3 })[decision];
}

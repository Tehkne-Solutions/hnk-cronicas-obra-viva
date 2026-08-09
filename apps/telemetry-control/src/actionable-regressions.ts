import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { classifyRegressionDomain, type RegressionDomain } from "./promotion-ledger.js";

export interface ActionableRegression {
  readonly domain: RegressionDomain;
  readonly severity: "error" | "fatal";
  readonly summary: string;
  readonly recommendedAction: string;
  readonly promotionId: string | null;
  readonly candidateSha: string | null;
  readonly failures: readonly string[];
}

const ACTIONS: Record<RegressionDomain, string> = {
  runtime: "Inspecionar exceções e sessões afetadas; bloquear nova promoção até eliminar o erro reproduzível.",
  persistence: "Validar IndexedDB/save contract e migrações; preservar saves e executar testes de recuperação antes de promover novamente.",
  performance: "Comparar long tasks, latência e budget com o baseline; reverter a regressão ou ajustar o hot path antes de nova promoção.",
  progression: "Executar simulação/autonomous playthrough no milestone afetado e corrigir bloqueio de progressão antes de liberar.",
  release_infrastructure: "Verificar Render target, deploy hook e release.json; exigir correspondência exata do SHA antes de nova promoção.",
  unknown: "Preservar evidências, correlacionar sessão/SHA e classificar a regressão antes de qualquer nova promoção.",
};

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function deriveActionableRegression(event: StoredTelemetryEvent): ActionableRegression | null {
  if (event.name !== "promotion_rollback_required" && event.name !== "post_release_sentinel_fail") return null;
  const failures = strings(event.data.failures);
  const domains = [...new Set(failures.map(classifyRegressionDomain))];
  const domain = domains.find((item) => item !== "unknown") ?? domains[0] ?? "unknown";
  const promotionId = typeof event.data.promotionId === "string" ? event.data.promotionId : null;
  const candidateSha = typeof event.data.candidateSha === "string" ? event.data.candidateSha : event.buildSha ?? null;
  const severity = event.name === "promotion_rollback_required" ? "fatal" : "error";
  const summary = event.name === "promotion_rollback_required"
    ? `Promoção exige rollback (${domain}).`
    : `Regressão pós-release detectada (${domain}).`;
  return Object.freeze({ domain, severity, summary, recommendedAction: ACTIONS[domain], promotionId, candidateSha, failures: Object.freeze([...failures]) });
}

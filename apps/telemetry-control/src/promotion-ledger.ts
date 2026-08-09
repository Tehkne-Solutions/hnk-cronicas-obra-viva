import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";

export type PromotionHealth = "healthy" | "degraded" | "rollback_required" | "unknown";
export type RegressionDomain = "runtime" | "persistence" | "performance" | "progression" | "release_infrastructure" | "unknown";

export interface PromotionLedgerItem {
  readonly promotionId: string;
  readonly candidateId: string | null;
  readonly candidateSha: string | null;
  readonly authorizationId: string | null;
  readonly promotedAt: string;
  readonly health: PromotionHealth;
  readonly sentinelStatus: "pass" | "fail" | "missing";
  readonly verifiedManifestSha: string | null;
  readonly regressionDomains: readonly RegressionDomain[];
  readonly failures: readonly string[];
}

function stringData(event: StoredTelemetryEvent, key: string): string | null {
  const value = event.data[key];
  return typeof value === "string" ? value : null;
}
function stringArrayData(event: StoredTelemetryEvent, key: string): readonly string[] {
  const value = event.data[key];
  return Array.isArray(value) ? Object.freeze(value.filter((item): item is string => typeof item === "string")) : Object.freeze([]);
}

export function classifyRegressionDomain(value: string): RegressionDomain {
  const text = value.toLowerCase();
  if (text.includes("indexeddb") || text.includes("storage") || text.includes("persist")) return "persistence";
  if (text.includes("long_task") || text.includes("performance") || text.includes("latency") || text.includes("fps")) return "performance";
  if (text.includes("progress") || text.includes("folio") || text.includes("chronicle") || text.includes("quaestio")) return "progression";
  if (text.includes("manifest") || text.includes("deploy") || text.includes("render") || text.includes("release")) return "release_infrastructure";
  if (text.includes("runtime") || text.includes("fatal") || text.includes("error") || text.includes("exception")) return "runtime";
  return "unknown";
}

export function derivePromotionLedger(events: readonly StoredTelemetryEvent[]): readonly PromotionLedgerItem[] {
  const promotions = events
    .filter((event) => event.name === "promotion_completed" || event.name === "promotion_rollback_required")
    .map((event) => ({ event, promotionId: stringData(event, "promotionId") }))
    .filter((item): item is { event: StoredTelemetryEvent; promotionId: string } => Boolean(item.promotionId));

  const sentinels = events.filter((event) => event.name === "post_release_sentinel_pass" || event.name === "post_release_sentinel_fail");

  return Object.freeze(promotions.map(({ event, promotionId }) => {
    const candidateSha = stringData(event, "candidateSha") ?? event.buildSha ?? null;
    const sentinel = sentinels.find((item) => stringData(item, "promotionId") === promotionId || (candidateSha && (stringData(item, "candidateSha") ?? item.buildSha) === candidateSha)) ?? null;
    const promotionFailures = stringArrayData(event, "failures");
    const sentinelFailures = sentinel ? stringArrayData(sentinel, "failures") : [];
    const combinedFailures = Object.freeze([...promotionFailures, ...sentinelFailures]);
    const domains = Object.freeze(Array.from(new Set(combinedFailures.map(classifyRegressionDomain))));
    const sentinelStatus = sentinel?.name === "post_release_sentinel_pass" ? "pass" : sentinel?.name === "post_release_sentinel_fail" ? "fail" : "missing";
    const health: PromotionHealth = event.name === "promotion_rollback_required" ? "rollback_required" : sentinelStatus === "fail" ? "degraded" : event.name === "promotion_completed" ? "healthy" : "unknown";
    return Object.freeze({
      promotionId,
      candidateId: stringData(event, "candidateId"),
      candidateSha,
      authorizationId: stringData(event, "authorizationId"),
      promotedAt: event.receivedAt,
      health,
      sentinelStatus,
      verifiedManifestSha: stringData(event, "verifiedManifestSha"),
      regressionDomains: domains,
      failures: combinedFailures,
    });
  }).sort((a, b) => b.promotedAt.localeCompare(a.promotedAt)));
}

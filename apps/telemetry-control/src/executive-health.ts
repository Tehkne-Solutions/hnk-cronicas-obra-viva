import type { ControlCenterSnapshot, StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { deriveIncidentLifecycles } from "./incident-lifecycle.js";
import { derivePromotionLedger } from "./promotion-ledger.js";
import { buildRecoveryGateSnapshot } from "./recovery-gate.js";
import { isSyntheticRecoveryEvent } from "./recovery-synthetic.js";

export type ExecutiveStatus = "ready" | "watch" | "blocked" | "recovery_required" | "unknown";
export type QualityStatus = "pass" | "warn" | "fail" | "unknown";

export interface ExecutiveHealthSnapshot {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly status: ExecutiveStatus;
  readonly ready: boolean;
  readonly score: number;
  readonly quality: {
    readonly status: QualityStatus;
    readonly candidateSha: string | null;
    readonly regressionBudget: string | null;
    readonly observedAt: string | null;
  };
  readonly recovery: {
    readonly decision: string;
    readonly blocked: boolean;
    readonly activeIncidents: number;
  };
  readonly incidents: {
    readonly active: number;
    readonly resolved: number;
  };
  readonly release: {
    readonly health: string;
    readonly candidateSha: string | null;
    readonly sentinelStatus: string;
    readonly promotedAt: string | null;
  };
  readonly telemetry: {
    readonly events: number;
    readonly lastSeenAt: string | null;
  };
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly signature: "Tehkné Solutions";
}

function stringData(event: StoredTelemetryEvent, key: string): string | null {
  const value = event.data[key];
  return typeof value === "string" ? value : null;
}

function latestQuality(events: readonly StoredTelemetryEvent[]) {
  const event = events
    .filter((item) => item.name === "quality_release_gate_pass" || item.name === "quality_release_gate_warn" || item.name === "quality_release_gate_fail")
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  if (!event) return { status: "unknown" as const, candidateSha: null, regressionBudget: null, observedAt: null };
  const status: QualityStatus = event.name.endsWith("_pass") ? "pass" : event.name.endsWith("_warn") ? "warn" : "fail";
  return {
    status,
    candidateSha: stringData(event, "candidateSha") ?? event.buildSha ?? null,
    regressionBudget: stringData(event, "regressionBudgetStatus"),
    observedAt: event.receivedAt,
  };
}

export function buildExecutiveHealthSnapshot(snapshot: ControlCenterSnapshot): ExecutiveHealthSnapshot {
  const productionEvents = snapshot.recentEvents.filter((event) => !isSyntheticRecoveryEvent(event));
  const recovery = buildRecoveryGateSnapshot(snapshot);
  const lifecycles = deriveIncidentLifecycles(productionEvents, snapshot.generatedAt);
  const active = lifecycles.filter((item) => item.lifecycleState !== "resolved");
  const promotions = derivePromotionLedger(productionEvents);
  const latestPromotion = promotions[0] ?? null;
  const quality = latestQuality(productionEvents);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (recovery.decision === "rollback_recommended") blockers.push("recovery_requires_rollback");
  else if (recovery.blocked) blockers.push("recovery_blocks_promotion");
  if (quality.status === "fail") blockers.push("quality_release_gate_failed");
  if (quality.status === "unknown") warnings.push("quality_evidence_missing");
  if (quality.status === "warn") warnings.push("quality_regression_budget_warning");
  if (active.length > 0) warnings.push(`active_incidents:${active.length}`);
  if (!latestPromotion) warnings.push("promotion_evidence_missing");
  else {
    if (latestPromotion.health === "rollback_required") blockers.push("latest_promotion_requires_rollback");
    else if (latestPromotion.health !== "healthy") warnings.push(`latest_promotion_${latestPromotion.health}`);
    if (latestPromotion.sentinelStatus !== "pass") warnings.push(`post_release_sentinel_${latestPromotion.sentinelStatus}`);
    if (!latestPromotion.verifiedManifestSha || latestPromotion.verifiedManifestSha !== latestPromotion.candidateSha) blockers.push("release_manifest_not_verified");
  }

  let status: ExecutiveStatus;
  if (recovery.decision === "rollback_recommended" || blockers.includes("latest_promotion_requires_rollback")) status = "recovery_required";
  else if (blockers.length > 0) status = "blocked";
  else if (warnings.length > 0) status = "watch";
  else if (productionEvents.length === 0) status = "unknown";
  else status = "ready";

  const score = Math.max(0, Math.min(100,
    100
    - blockers.length * 35
    - warnings.length * 10
    - (active.length > 0 ? Math.min(20, active.length * 4) : 0),
  ));
  const lastSeenAt = productionEvents.reduce<string | null>((latest, event) => !latest || event.receivedAt > latest ? event.receivedAt : latest, null);

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    status,
    ready: status === "ready",
    score,
    quality: Object.freeze(quality),
    recovery: Object.freeze({ decision: recovery.decision, blocked: recovery.blocked, activeIncidents: recovery.activeIncidents }),
    incidents: Object.freeze({ active: active.length, resolved: lifecycles.length - active.length }),
    release: Object.freeze({
      health: latestPromotion?.health ?? "unknown",
      candidateSha: latestPromotion?.candidateSha ?? null,
      sentinelStatus: latestPromotion?.sentinelStatus ?? "missing",
      promotedAt: latestPromotion?.promotedAt ?? null,
    }),
    telemetry: Object.freeze({ events: productionEvents.length, lastSeenAt }),
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    signature: "Tehkné Solutions",
  });
}

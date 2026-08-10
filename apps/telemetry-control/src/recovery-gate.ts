import type { ControlCenterSnapshot } from "@hnk/telemetry-control-core";
import { deriveIncidentLifecycles } from "./incident-lifecycle.js";
import { recommendRecovery, recoveryDecisionRank, type RecoveryRecommendation } from "./recovery-intelligence.js";
import { isSyntheticRecoveryEvent } from "./recovery-synthetic.js";

export interface RecoveryGateSnapshot {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly decision: RecoveryRecommendation["decision"];
  readonly blocked: boolean;
  readonly activeIncidents: number;
  readonly ignoredSyntheticEvents: number;
  readonly recommendations: readonly RecoveryRecommendation[];
  readonly signature: "Tehkné Solutions";
}

export function buildRecoveryGateSnapshot(snapshot: ControlCenterSnapshot): RecoveryGateSnapshot {
  const productionEvents = snapshot.recentEvents.filter((event) => !isSyntheticRecoveryEvent(event));
  const ignoredSyntheticEvents = snapshot.recentEvents.length - productionEvents.length;
  const incidents = deriveIncidentLifecycles(productionEvents, snapshot.generatedAt);
  const active = incidents.filter((incident) => incident.lifecycleState !== "resolved");
  const recommendations = active
    .map(recommendRecovery)
    .sort((a, b) => recoveryDecisionRank(b.decision) - recoveryDecisionRank(a.decision) || b.score - a.score);
  const decision = recommendations[0]?.decision ?? "continue";
  const blocked = recoveryDecisionRank(decision) >= recoveryDecisionRank("block_promotion");
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    decision,
    blocked,
    activeIncidents: active.length,
    ignoredSyntheticEvents,
    recommendations: Object.freeze(recommendations),
    signature: "Tehkné Solutions",
  });
}

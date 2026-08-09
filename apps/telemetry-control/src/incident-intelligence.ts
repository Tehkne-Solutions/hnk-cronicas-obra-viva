import { createHash } from "node:crypto";
import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { deriveActionableRegression, type ActionableRegression } from "./actionable-regressions.js";

export type IncidentState = "new" | "recurrent" | "known_regression";

export interface IncidentIntelligence extends ActionableRegression {
  readonly fingerprint: string;
  readonly state: IncidentState;
  readonly occurrences: number;
  readonly affectedBuildShas: readonly string[];
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

function normalizeFailure(value: string): string {
  return value.trim().toLowerCase().replace(/[0-9a-f]{40}/g, "<sha>").replace(/\d+/g, "<n>");
}

export function incidentFingerprint(regression: ActionableRegression): string {
  const signature = [regression.domain, ...regression.failures.map(normalizeFailure).sort()].join("|");
  return createHash("sha256").update(signature).digest("hex").slice(0, 20);
}

export function deriveIncidentIntelligence(event: StoredTelemetryEvent, history: readonly StoredTelemetryEvent[]): IncidentIntelligence | null {
  const regression = deriveActionableRegression(event);
  if (!regression) return null;
  const fingerprint = incidentFingerprint(regression);
  const currentSha = regression.candidateSha ?? event.buildSha ?? "unknown";
  const uniqueEvents = new Map<string, StoredTelemetryEvent>();
  for (const item of [...history, event]) uniqueEvents.set(item.id, item);
  const matches = [...uniqueEvents.values()]
    .map((item) => ({ event: item, regression: deriveActionableRegression(item) }))
    .filter((item): item is { event: StoredTelemetryEvent; regression: ActionableRegression } => Boolean(item.regression))
    .filter((item) => incidentFingerprint(item.regression) === fingerprint)
    .sort((a, b) => a.event.receivedAt.localeCompare(b.event.receivedAt));
  const affectedBuildShas = [...new Set(matches.map(({ event: item, regression: candidate }) => candidate.candidateSha ?? item.buildSha ?? "unknown"))];
  const prior = matches.filter(({ event: item }) => item.id !== event.id);
  const priorOnSameSha = prior.some(({ event: item, regression: candidate }) => (candidate.candidateSha ?? item.buildSha ?? "unknown") === currentSha);
  const state: IncidentState = prior.length === 0 ? "new" : priorOnSameSha ? "recurrent" : "known_regression";
  return Object.freeze({
    ...regression,
    fingerprint,
    state,
    occurrences: matches.length,
    affectedBuildShas: Object.freeze(affectedBuildShas),
    firstSeenAt: matches[0]?.event.receivedAt ?? event.receivedAt,
    lastSeenAt: matches.at(-1)?.event.receivedAt ?? event.receivedAt,
  });
}

import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { deriveIncidentIntelligence, type IncidentIntelligence } from "./incident-intelligence.js";

export type IncidentLifecycleState = "open" | "investigating" | "mitigated" | "resolved";

export interface IncidentLifecycleTransition {
  readonly state: IncidentLifecycleState;
  readonly at: string;
  readonly eventId: string;
  readonly buildSha?: string;
}

export interface IncidentLifecycle extends IncidentIntelligence {
  readonly lifecycleState: IncidentLifecycleState;
  readonly openedAt: string;
  readonly investigationStartedAt?: string;
  readonly mitigatedAt?: string;
  readonly resolvedAt?: string;
  readonly resolvedBuildSha?: string;
  readonly openDurationMs: number;
  readonly mttaMs?: number;
  readonly mttrMs?: number;
  readonly reopenCount: number;
  readonly transitions: readonly IncidentLifecycleTransition[];
}

const TRANSITIONS: Record<string, IncidentLifecycleState | undefined> = {
  incident_investigating: "investigating",
  incident_mitigated: "mitigated",
  incident_resolved: "resolved",
};

function eventFingerprint(event: StoredTelemetryEvent): string | undefined {
  const value = event.data?.fingerprint;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventTime(event: StoredTelemetryEvent): string {
  return event.receivedAt || event.occurredAt;
}

function millisBetween(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start));
}

function transition(state: IncidentLifecycleState, event: StoredTelemetryEvent, at = eventTime(event)): IncidentLifecycleTransition {
  return Object.freeze({ state, at, eventId: event.id, ...(event.buildSha ? { buildSha: event.buildSha } : {}) });
}

export function deriveIncidentLifecycles(events: readonly StoredTelemetryEvent[], nowIso: string): readonly IncidentLifecycle[] {
  const regressions = events.filter((event) => event.name === "promotion_rollback_required" || event.name === "post_release_sentinel_fail");
  const byFingerprint = new Map<string, { intelligence: IncidentIntelligence; regressionEvents: StoredTelemetryEvent[] }>();

  for (const event of regressions) {
    const intelligence = deriveIncidentIntelligence(event, regressions.filter((item) => item.id !== event.id));
    if (!intelligence) continue;
    const current = byFingerprint.get(intelligence.fingerprint);
    if (!current) byFingerprint.set(intelligence.fingerprint, { intelligence, regressionEvents: [event] });
    else {
      current.regressionEvents.push(event);
      if (intelligence.lastSeenAt > current.intelligence.lastSeenAt) current.intelligence = intelligence;
    }
  }

  const result: IncidentLifecycle[] = [];
  for (const [fingerprint, group] of byFingerprint.entries()) {
    const related = events
      .filter((event) => eventFingerprint(event) === fingerprint && TRANSITIONS[event.name])
      .sort((a, b) => eventTime(a).localeCompare(eventTime(b)));
    const regressionsForFingerprint = [...group.regressionEvents].sort((a, b) => eventTime(a).localeCompare(eventTime(b)));
    const firstRegression = regressionsForFingerprint[0];
    if (!firstRegression) continue;
    const openedAt = eventTime(firstRegression);
    let state: IncidentLifecycleState = "open";
    let investigationStartedAt: string | undefined;
    let mitigatedAt: string | undefined;
    let resolvedAt: string | undefined;
    let resolvedBuildSha: string | undefined;
    let reopenCount = 0;
    const transitions: IncidentLifecycleTransition[] = [transition("open", firstRegression, openedAt)];

    const timeline = [
      ...related.map((event) => ({ kind: "transition" as const, event, at: eventTime(event) })),
      ...regressionsForFingerprint.slice(1).map((event) => ({ kind: "regression" as const, event, at: eventTime(event) })),
    ].sort((a, b) => a.at.localeCompare(b.at));

    for (const entry of timeline) {
      if (entry.kind === "regression") {
        if (state === "resolved") {
          state = "open";
          reopenCount += 1;
          investigationStartedAt = undefined;
          mitigatedAt = undefined;
          resolvedAt = undefined;
          resolvedBuildSha = undefined;
          transitions.push(transition("open", entry.event, entry.at));
        }
        continue;
      }
      const next = TRANSITIONS[entry.event.name];
      if (!next) continue;
      if (next === "investigating" && !investigationStartedAt) investigationStartedAt = entry.at;
      if (next === "mitigated") mitigatedAt = entry.at;
      if (next === "resolved") {
        resolvedAt = entry.at;
        const value = entry.event.data?.resolvedBuildSha;
        resolvedBuildSha = typeof value === "string" ? value : entry.event.buildSha;
      }
      state = next;
      transitions.push(transition(next, entry.event, entry.at));
    }

    const terminalAt = resolvedAt ?? nowIso;
    result.push(Object.freeze({
      ...group.intelligence,
      lifecycleState: state,
      openedAt,
      ...(investigationStartedAt ? { investigationStartedAt } : {}),
      ...(mitigatedAt ? { mitigatedAt } : {}),
      ...(resolvedAt ? { resolvedAt } : {}),
      ...(resolvedBuildSha ? { resolvedBuildSha } : {}),
      openDurationMs: millisBetween(openedAt, terminalAt),
      ...(investigationStartedAt ? { mttaMs: millisBetween(openedAt, investigationStartedAt) } : {}),
      ...(resolvedAt ? { mttrMs: millisBetween(openedAt, resolvedAt) } : {}),
      reopenCount,
      transitions: Object.freeze(transitions),
    }));
  }

  return Object.freeze(result.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)));
}

import type { TelemetryEnvelope, TelemetryLevel } from "./index.js";

export interface TelemetryFinding {
  readonly code: "error_storm" | "persistence_degradation" | "progress_stall" | "ledger_regression" | "main_thread_pressure";
  readonly level: Exclude<TelemetryLevel, "debug" | "info">;
  readonly summary: string;
  readonly evidenceCount: number;
  readonly sessionId?: string;
  readonly chronicleId?: string;
}

function numberData(event: TelemetryEnvelope, key: string): number | undefined {
  const value = event.data[key];
  return typeof value === "number" ? value : undefined;
}

export function analyzeTelemetry(events: readonly TelemetryEnvelope[]): readonly TelemetryFinding[] {
  const findings: TelemetryFinding[] = [];
  const errors = events.filter((event) => event.kind === "error");
  const bySource = new Map<string, TelemetryEnvelope[]>();
  for (const event of errors) {
    const source = typeof event.data.source === "string" ? event.data.source : event.name;
    bySource.set(source, [...(bySource.get(source) ?? []), event]);
  }
  for (const [source, group] of bySource) {
    if (group.length >= 3) findings.push(Object.freeze({
      code: "error_storm",
      level: "error",
      summary: `Repeated runtime errors from ${source}.`,
      evidenceCount: group.length,
      sessionId: group.at(-1)?.sessionId,
      chronicleId: group.at(-1)?.chronicleId,
    }));
  }

  const slowPersistence = events.filter((event) => event.kind === "performance" && event.name.startsWith("indexeddb_") && event.level === "warn");
  if (slowPersistence.length >= 2) findings.push(Object.freeze({
    code: "persistence_degradation",
    level: "warn",
    summary: "IndexedDB operations repeatedly exceeded their latency budget.",
    evidenceCount: slowPersistence.length,
    sessionId: slowPersistence.at(-1)?.sessionId,
    chronicleId: slowPersistence.at(-1)?.chronicleId,
  }));

  const longTasks = events.filter((event) => event.kind === "performance" && event.name === "browser_long_task" && (numberData(event, "value") ?? 0) >= 100);
  if (longTasks.length >= 3) findings.push(Object.freeze({
    code: "main_thread_pressure",
    level: "warn",
    summary: "Repeated browser long tasks indicate main-thread pressure that can make actions feel unresponsive.",
    evidenceCount: longTasks.length,
    sessionId: longTasks.at(-1)?.sessionId,
    chronicleId: longTasks.at(-1)?.chronicleId,
  }));

  const ledgerRegressions = events.filter((event) => event.kind === "anomaly" && event.name === "event_ledger_regressed");
  if (ledgerRegressions.length > 0) findings.push(Object.freeze({
    code: "ledger_regression",
    level: "fatal",
    summary: "The canonical Event Ledger moved backwards; save/state integrity is at risk.",
    evidenceCount: ledgerRegressions.length,
    sessionId: ledgerRegressions.at(-1)?.sessionId,
    chronicleId: ledgerRegressions.at(-1)?.chronicleId,
  }));

  const lastQuestionTransitionIndex = events.reduce((last, event, index) => event.name === "quaestio_status_changed" ? index : last, -1);
  const tail = events.slice(lastQuestionTransitionIndex + 1);
  const gameEventsSinceProgress = tail.filter((event) => event.kind === "game_event");
  const latestHealth = [...tail].reverse().find((event) => event.name === "gameplay_health_snapshot");
  const unresolved = latestHealth ? numberData(latestHealth, "unresolvedQuestionCount") ?? 0 : 0;
  if (unresolved > 0 && gameEventsSinceProgress.length >= 20) findings.push(Object.freeze({
    code: "progress_stall",
    level: "warn",
    summary: "Many gameplay events occurred without any QUAESTIO status progress while unresolved questions remain.",
    evidenceCount: gameEventsSinceProgress.length,
    sessionId: latestHealth?.sessionId,
    chronicleId: latestHealth?.chronicleId,
  }));

  return Object.freeze(findings);
}

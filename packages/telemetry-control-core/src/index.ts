import { analyzeTelemetry, type TelemetryFinding } from "@hnk/telemetry-engine/diagnostics";
import type { TelemetryEnvelope } from "@hnk/telemetry-engine";

export interface StoredTelemetryEvent extends TelemetryEnvelope {
  readonly receivedAt: string;
  readonly remoteAddress?: string;
  readonly release?: string;
  readonly buildSha?: string;
}

export interface TelemetryRecentOptions {
  readonly limit?: number;
  readonly since?: Date;
  readonly sessionId?: string;
}

export interface TelemetryStore {
  append(events: readonly StoredTelemetryEvent[]): Promise<void>;
  recent(options?: TelemetryRecentOptions): Promise<readonly StoredTelemetryEvent[]>;
  prune(before: Date): Promise<number>;
  health(): Promise<{ readonly mode: string; readonly ok: boolean }>;
}

export interface QualityRunSnapshot {
  readonly result: "pass" | "fail" | "unknown";
  readonly buildSha: string | null;
  readonly receivedAt: string;
  readonly campaignScenarios: number;
  readonly autonomousSeeds: number;
  readonly semanticMutants: number;
  readonly mutationDomains: number;
  readonly protectedMilestones: number;
  readonly typecheckMs: number | null;
  readonly testMs: number | null;
  readonly buildMs: number | null;
  readonly regressionBudgetStatus: "pass" | "warn" | "fail" | "no_baseline" | "unknown";
  readonly regressionViolations: number;
  readonly regressionWarnings: number;
  readonly baselineSha: string | null;
}

export interface ReleaseDecisionSnapshot {
  readonly decision: "eligible" | "blocked" | "unknown";
  readonly candidateSha: string | null;
  readonly receivedAt: string;
  readonly reasons: readonly string[];
  readonly productionErrors: number;
  readonly productionFatal: number;
  readonly diagnostics: number;
}

export interface ControlCenterSnapshot {
  readonly generatedAt: string;
  readonly periodHours: number;
  readonly totals: {
    readonly events: number;
    readonly sessions: number;
    readonly chronicles: number;
    readonly errors: number;
    readonly fatal: number;
    readonly warnings: number;
  };
  readonly performance: {
    readonly slowPersistence: number;
    readonly longTasks: number;
    readonly p95PersistenceMs: number | null;
  };
  readonly progress: {
    readonly quaestioTransitions: number;
    readonly threeWitnessesCompleted: number;
    readonly combustionStarted: number;
    readonly foliosRecovered: number;
  };
  readonly quality: {
    readonly runs: number;
    readonly passed: number;
    readonly failed: number;
    readonly budgetPassed: number;
    readonly budgetWarnings: number;
    readonly budgetFailed: number;
    readonly latest: QualityRunSnapshot | null;
  };
  readonly releaseReadiness: {
    readonly decisions: number;
    readonly eligible: number;
    readonly blocked: number;
    readonly latest: ReleaseDecisionSnapshot | null;
    readonly recent: readonly ReleaseDecisionSnapshot[];
  };
  readonly topErrors: readonly { readonly name: string; readonly source: string; readonly count: number }[];
  readonly diagnostics: readonly TelemetryFinding[];
  readonly recentEvents: readonly StoredTelemetryEvent[];
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? null;
}

function numberData(event: StoredTelemetryEvent, key: string): number | undefined {
  const value = event.data[key];
  return typeof value === "number" ? value : undefined;
}
function stringData(event: StoredTelemetryEvent, key: string): string | undefined {
  const value = event.data[key];
  return typeof value === "string" ? value : undefined;
}
function stringArrayData(event: StoredTelemetryEvent, key: string): readonly string[] {
  const value = event.data[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function qualityDuration(event: StoredTelemetryEvent, gate: string): number | null {
  const gates = event.data.gates;
  if (!gates || typeof gates !== "object") return null;
  const value = (gates as Record<string, unknown>)[gate];
  if (!value || typeof value !== "object") return null;
  const duration = (value as Record<string, unknown>).durationMs;
  return typeof duration === "number" ? duration : null;
}
function qualityRun(event: StoredTelemetryEvent): QualityRunSnapshot {
  const result = event.data.result === "pass" || event.data.result === "fail" ? event.data.result : "unknown";
  const budget = stringData(event, "regressionBudgetStatus");
  const regressionBudgetStatus = budget === "pass" || budget === "warn" || budget === "fail" || budget === "no_baseline" ? budget : "unknown";
  return Object.freeze({
    result,
    buildSha: event.buildSha ?? null,
    receivedAt: event.receivedAt,
    campaignScenarios: numberData(event, "campaignScenarios") ?? 0,
    autonomousSeeds: numberData(event, "autonomousSeeds") ?? 0,
    semanticMutants: numberData(event, "semanticMutants") ?? 0,
    mutationDomains: numberData(event, "mutationDomains") ?? 0,
    protectedMilestones: numberData(event, "protectedMilestones") ?? 0,
    typecheckMs: qualityDuration(event, "typecheck"),
    testMs: qualityDuration(event, "test"),
    buildMs: qualityDuration(event, "build"),
    regressionBudgetStatus,
    regressionViolations: numberData(event, "regressionViolations") ?? 0,
    regressionWarnings: numberData(event, "regressionWarnings") ?? 0,
    baselineSha: stringData(event, "baselineSha") ?? null,
  });
}
function releaseDecision(event: StoredTelemetryEvent): ReleaseDecisionSnapshot {
  const raw = stringData(event, "decision");
  const decision = raw === "eligible" || raw === "blocked" ? raw : "unknown";
  return Object.freeze({
    decision,
    candidateSha: stringData(event, "candidateSha") ?? event.buildSha ?? null,
    receivedAt: event.receivedAt,
    reasons: Object.freeze([...stringArrayData(event, "reasons")]),
    productionErrors: numberData(event, "productionErrors") ?? 0,
    productionFatal: numberData(event, "productionFatal") ?? 0,
    diagnostics: numberData(event, "diagnostics") ?? 0,
  });
}

export function buildControlCenterSnapshot(events: readonly StoredTelemetryEvent[], periodHours = 24): ControlCenterSnapshot {
  const sessions = new Set(events.map((event) => event.sessionId));
  const chronicles = new Set(events.flatMap((event) => event.chronicleId ? [event.chronicleId] : []));
  const errors = events.filter((event) => event.kind === "error");
  const qualityEvents = events.filter((event) => event.name === "ci_quality_report").sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const releaseEvents = events.filter((event) => event.name === "release_gate_decision").sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const releaseDecisions = releaseEvents.map(releaseDecision);
  const persistence = events.filter((event) => event.kind === "performance" && event.name.startsWith("indexeddb_"));
  const persistenceValues = persistence.flatMap((event) => {
    const value = numberData(event, "value");
    return value === undefined ? [] : [value];
  });
  const errorsByKey = new Map<string, { name: string; source: string; count: number }>();
  for (const event of errors) {
    const source = typeof event.data.source === "string" ? event.data.source : "unknown";
    const key = `${event.name}|${source}`;
    const current = errorsByKey.get(key) ?? { name: event.name, source, count: 0 };
    current.count += 1;
    errorsByKey.set(key, current);
  }
  const diagnostics = [...new Set(events.map((event) => event.sessionId))].flatMap((sessionId) =>
    analyzeTelemetry(events.filter((event) => event.sessionId === sessionId)),
  );
  const topErrors = [...errorsByKey.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((item) => Object.freeze({ name: item.name, source: item.source, count: item.count }));
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    periodHours,
    totals: Object.freeze({
      events: events.length,
      sessions: sessions.size,
      chronicles: chronicles.size,
      errors: errors.length,
      fatal: events.filter((event) => event.level === "fatal").length,
      warnings: events.filter((event) => event.level === "warn").length,
    }),
    performance: Object.freeze({
      slowPersistence: persistence.filter((event) => event.level === "warn").length,
      longTasks: events.filter((event) => event.name === "browser_long_task").length,
      p95PersistenceMs: percentile(persistenceValues, 0.95),
    }),
    progress: Object.freeze({
      quaestioTransitions: events.filter((event) => event.name === "quaestio_status_changed").length,
      threeWitnessesCompleted: events.filter((event) => event.name === "ThreeWitnessesUnderstood").length,
      combustionStarted: events.filter((event) => event.name === "CombustionStarted").length,
      foliosRecovered: events.filter((event) => event.name === "TransferBox7Opened").length,
    }),
    quality: Object.freeze({
      runs: qualityEvents.length,
      passed: qualityEvents.filter((event) => event.data.result === "pass").length,
      failed: qualityEvents.filter((event) => event.data.result === "fail").length,
      budgetPassed: qualityEvents.filter((event) => event.data.regressionBudgetStatus === "pass").length,
      budgetWarnings: qualityEvents.filter((event) => event.data.regressionBudgetStatus === "warn").length,
      budgetFailed: qualityEvents.filter((event) => event.data.regressionBudgetStatus === "fail").length,
      latest: qualityEvents[0] ? qualityRun(qualityEvents[0]) : null,
    }),
    releaseReadiness: Object.freeze({
      decisions: releaseDecisions.length,
      eligible: releaseDecisions.filter((item) => item.decision === "eligible").length,
      blocked: releaseDecisions.filter((item) => item.decision === "blocked").length,
      latest: releaseDecisions[0] ?? null,
      recent: Object.freeze(releaseDecisions.slice(0, 10)),
    }),
    topErrors: Object.freeze(topErrors),
    diagnostics: Object.freeze(diagnostics),
    recentEvents: Object.freeze([...events].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 100)),
  });
}

export class MemoryTelemetryStore implements TelemetryStore {
  private events: StoredTelemetryEvent[] = [];
  async append(events: readonly StoredTelemetryEvent[]): Promise<void> { this.events.push(...events); }
  async recent(options: TelemetryRecentOptions = {}): Promise<readonly StoredTelemetryEvent[]> {
    const sinceMs = options.since?.getTime() ?? 0;
    return this.events
      .filter((event) => Date.parse(event.receivedAt) >= sinceMs && (!options.sessionId || event.sessionId === options.sessionId))
      .slice(-(options.limit ?? 5000));
  }
  async prune(before: Date): Promise<number> {
    const previous = this.events.length;
    const cutoff = before.getTime();
    this.events = this.events.filter((event) => Date.parse(event.receivedAt) >= cutoff);
    return previous - this.events.length;
  }
  async health() { return { mode: "memory", ok: true } as const; }
}

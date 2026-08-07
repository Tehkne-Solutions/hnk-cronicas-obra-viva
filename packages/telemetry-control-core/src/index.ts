import { analyzeTelemetry, type TelemetryFinding } from "@hnk/telemetry-engine/diagnostics";
import type { TelemetryEnvelope } from "@hnk/telemetry-engine";

export interface StoredTelemetryEvent extends TelemetryEnvelope {
  readonly receivedAt: string;
  readonly remoteAddress?: string;
  readonly release?: string;
  readonly buildSha?: string;
}

export interface TelemetryStore {
  append(events: readonly StoredTelemetryEvent[]): Promise<void>;
  recent(options?: { limit?: number; since?: Date }): Promise<readonly StoredTelemetryEvent[]>;
  prune(before: Date): Promise<number>;
  health(): Promise<{ readonly mode: string; readonly ok: boolean }>;
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

export function buildControlCenterSnapshot(events: readonly StoredTelemetryEvent[], periodHours = 24): ControlCenterSnapshot {
  const sessions = new Set(events.map((event) => event.sessionId));
  const chronicles = new Set(events.flatMap((event) => event.chronicleId ? [event.chronicleId] : []));
  const errors = events.filter((event) => event.kind === "error");
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
    topErrors: Object.freeze(topErrors),
    diagnostics: Object.freeze(diagnostics),
    recentEvents: Object.freeze([...events].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 100)),
  });
}

export class MemoryTelemetryStore implements TelemetryStore {
  private events: StoredTelemetryEvent[] = [];
  async append(events: readonly StoredTelemetryEvent[]): Promise<void> { this.events.push(...events); }
  async recent(options: { limit?: number; since?: Date } = {}): Promise<readonly StoredTelemetryEvent[]> {
    const sinceMs = options.since?.getTime() ?? 0;
    return this.events.filter((event) => Date.parse(event.receivedAt) >= sinceMs).slice(-(options.limit ?? 5000));
  }
  async prune(before: Date): Promise<number> {
    const previous = this.events.length;
    const cutoff = before.getTime();
    this.events = this.events.filter((event) => Date.parse(event.receivedAt) >= cutoff);
    return previous - this.events.length;
  }
  async health() { return { mode: "memory", ok: true } as const; }
}

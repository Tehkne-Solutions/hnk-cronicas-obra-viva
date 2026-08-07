import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";

export type TelemetryLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type TelemetryKind = "game_event" | "state_transition" | "error" | "performance" | "health" | "anomaly" | "session";

export interface TelemetryEnvelope {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly occurredAt: string;
  readonly kind: TelemetryKind;
  readonly name: string;
  readonly level: TelemetryLevel;
  readonly sessionId: string;
  readonly chronicleId?: string;
  readonly locationId?: string;
  readonly worldDay?: number;
  readonly worldMinute?: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface TelemetrySink {
  emit(event: TelemetryEnvelope): void | Promise<void>;
  flush?(): void | Promise<void>;
}

export interface ChronicleObservationContext {
  readonly sessionId: string;
  readonly previous?: ChronicleSaveV2 | null;
  readonly current: ChronicleSaveV2;
}

const SENSITIVE_KEYS = new Set(["email", "name", "token", "password", "authorization", "cookie", "text", "body", "content"]);

function cleanValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => cleanValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEYS.has(key.toLowerCase()))
      .slice(0, 30)
      .map(([key, item]) => [key, cleanValue(item, depth + 1)]));
  }
  return String(value);
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `telemetry.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 9)}`;
}

function base(
  sessionId: string,
  chronicle: ChronicleSaveV2 | undefined,
  kind: TelemetryKind,
  name: string,
  level: TelemetryLevel,
  data: Record<string, unknown>,
): TelemetryEnvelope {
  const persona = chronicle?.personas[chronicle.activePersonaId as string];
  return Object.freeze({
    schemaVersion: 1 as const,
    id: uid(),
    occurredAt: new Date().toISOString(),
    kind,
    name,
    level,
    sessionId,
    ...(chronicle ? { chronicleId: chronicle.chronicleId as string } : {}),
    ...(persona?.currentLocation ? { locationId: persona.currentLocation as string } : {}),
    ...(chronicle ? { worldDay: chronicle.world.timestamp.day, worldMinute: chronicle.world.timestamp.minuteOfDay } : {}),
    data: Object.freeze(cleanValue(data) as Record<string, unknown>),
  });
}

export function createTelemetryEvent(input: {
  sessionId: string;
  chronicle?: ChronicleSaveV2;
  kind: TelemetryKind;
  name: string;
  level?: TelemetryLevel;
  data?: Record<string, unknown>;
}): TelemetryEnvelope {
  return base(input.sessionId, input.chronicle, input.kind, input.name, input.level ?? "info", input.data ?? {});
}

export function observeChronicleTransition(context: ChronicleObservationContext): readonly TelemetryEnvelope[] {
  const { previous, current, sessionId } = context;
  const output: TelemetryEnvelope[] = [];
  if (!previous) {
    output.push(base(sessionId, current, "session", "chronicle_hydrated", "info", {
      eventCount: current.eventLedger.length,
      contentVersion: current.contentVersion,
    }));
    return Object.freeze(output);
  }

  const previousPersona = previous.personas[previous.activePersonaId as string];
  const currentPersona = current.personas[current.activePersonaId as string];
  if (previousPersona?.currentLocation !== currentPersona?.currentLocation) {
    output.push(base(sessionId, current, "state_transition", "location_changed", "info", {
      from: previousPersona?.currentLocation,
      to: currentPersona?.currentLocation,
    }));
  }
  if (previous.world.timestamp.day !== current.world.timestamp.day || previous.world.timestamp.minuteOfDay !== current.world.timestamp.minuteOfDay) {
    output.push(base(sessionId, current, "state_transition", "world_time_changed", "debug", {
      fromDay: previous.world.timestamp.day,
      fromMinute: previous.world.timestamp.minuteOfDay,
      toDay: current.world.timestamp.day,
      toMinute: current.world.timestamp.minuteOfDay,
    }));
  }

  const newEvents = current.eventLedger.slice(previous.eventLedger.length);
  for (const event of newEvents) {
    output.push(base(sessionId, current, "game_event", event.type, "info", {
      eventId: event.id,
      payload: event.payload,
    }));
  }

  const previousQuestions = previous.knowledgeByPersona[previous.activePersonaId as string]?.questions ?? {};
  const currentQuestions = current.knowledgeByPersona[current.activePersonaId as string]?.questions ?? {};
  for (const [questionId, question] of Object.entries(currentQuestions)) {
    const before = previousQuestions[questionId];
    if (!before || before.status !== question.status) {
      output.push(base(sessionId, current, "state_transition", "quaestio_status_changed", "info", {
        questionId,
        from: before?.status ?? null,
        to: question.status,
      }));
    }
  }

  if (current.eventLedger.length < previous.eventLedger.length) {
    output.push(base(sessionId, current, "anomaly", "event_ledger_regressed", "error", {
      previousCount: previous.eventLedger.length,
      currentCount: current.eventLedger.length,
    }));
  }

  return Object.freeze(output);
}

export function createErrorTelemetry(input: {
  sessionId: string;
  chronicle?: ChronicleSaveV2;
  error: unknown;
  source: string;
  fatal?: boolean;
}): TelemetryEnvelope {
  const error = input.error instanceof Error ? input.error : new Error(String(input.error));
  return base(input.sessionId, input.chronicle, "error", "runtime_error", input.fatal ? "fatal" : "error", {
    source: input.source,
    errorName: error.name,
    message: error.message,
    stack: error.stack?.split("\n").slice(0, 12).join("\n"),
  });
}

export function createPerformanceTelemetry(input: {
  sessionId: string;
  chronicle?: ChronicleSaveV2;
  metric: string;
  value: number;
  unit: "ms" | "count" | "bytes";
  threshold?: number;
}): TelemetryEnvelope {
  const level: TelemetryLevel = input.threshold !== undefined && input.value > input.threshold ? "warn" : "info";
  return base(input.sessionId, input.chronicle, "performance", input.metric, level, {
    value: input.value,
    unit: input.unit,
    threshold: input.threshold,
  });
}

export class MemoryTelemetrySink implements TelemetrySink {
  readonly events: TelemetryEnvelope[] = [];
  emit(event: TelemetryEnvelope): void { this.events.push(event); }
}

export function emitAll(sink: TelemetrySink, events: readonly TelemetryEnvelope[]): void {
  for (const event of events) void sink.emit(event);
}

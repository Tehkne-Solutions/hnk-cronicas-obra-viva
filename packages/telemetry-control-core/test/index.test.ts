import { describe, expect, it } from "vitest";
import { buildControlCenterSnapshot, MemoryTelemetryStore, type StoredTelemetryEvent } from "../src/index.js";

function event(partial: Partial<StoredTelemetryEvent> & Pick<StoredTelemetryEvent, "name" | "kind">): StoredTelemetryEvent {
  return {
    schemaVersion: 1,
    id: partial.id ?? `event.${Math.random()}`,
    occurredAt: partial.occurredAt ?? "2026-08-07T12:00:00.000Z",
    receivedAt: partial.receivedAt ?? "2026-08-07T12:00:01.000Z",
    kind: partial.kind,
    name: partial.name,
    level: partial.level ?? "info",
    sessionId: partial.sessionId ?? "session.a",
    data: partial.data ?? {},
    ...partial,
  };
}

describe("telemetry control center", () => {
  it("aggregates operational and campaign signals", () => {
    const snapshot = buildControlCenterSnapshot([
      event({ kind: "game_event", name: "CombustionStarted", chronicleId: "c1" }),
      event({ kind: "state_transition", name: "quaestio_status_changed", chronicleId: "c1" }),
      event({ kind: "game_event", name: "TransferBox7Opened", chronicleId: "c1" }),
      event({ kind: "game_event", name: "ThreeWitnessesUnderstood", chronicleId: "c1" }),
      event({ kind: "performance", name: "indexeddb_save", level: "warn", data: { value: 330 } }),
      event({ kind: "error", name: "runtime_error", level: "error", data: { source: "window.error" } }),
    ]);
    expect(snapshot.totals.sessions).toBe(1);
    expect(snapshot.totals.errors).toBe(1);
    expect(snapshot.progress.threeWitnessesCompleted).toBe(1);
    expect(snapshot.performance.p95PersistenceMs).toBe(330);
    expect(snapshot.topErrors[0]?.source).toBe("window.error");
  });

  it("keeps memory storage bounded by retention operations", async () => {
    const store = new MemoryTelemetryStore();
    await store.append([event({ kind: "session", name: "old", receivedAt: "2026-07-01T00:00:00.000Z" }), event({ kind: "session", name: "new", receivedAt: "2026-08-07T00:00:00.000Z" })]);
    expect(await store.prune(new Date("2026-08-01T00:00:00.000Z"))).toBe(1);
    expect((await store.recent()).map((item) => item.name)).toEqual(["new"]);
  });
});

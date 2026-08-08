import { describe, expect, it } from "vitest";
import { buildControlCenterSnapshot, MemoryTelemetryStore, type StoredTelemetryEvent } from "../src/index.js";

function event(partial: Partial<StoredTelemetryEvent> & Pick<StoredTelemetryEvent, "name" | "kind">): StoredTelemetryEvent {
  return {
    schemaVersion: 1,
    id: partial.id ?? `event.${Math.random()}`,
    occurredAt: partial.occurredAt ?? "2026-08-07T12:00:00.000Z",
    receivedAt: partial.receivedAt ?? "2026-08-07T12:00:01.000Z",
    level: partial.level ?? "info",
    sessionId: partial.sessionId ?? "session.a",
    data: partial.data ?? {},
    ...partial,
    kind: partial.kind,
    name: partial.name,
  };
}

describe("telemetry control center", () => {
  it("aggregates operational, campaign, engineering-quality and release-readiness signals", () => {
    const snapshot = buildControlCenterSnapshot([
      event({ kind: "game_event", name: "CombustionStarted", chronicleId: "c1" }),
      event({ kind: "state_transition", name: "quaestio_status_changed", chronicleId: "c1" }),
      event({ kind: "game_event", name: "TransferBox7Opened", chronicleId: "c1" }),
      event({ kind: "game_event", name: "ThreeWitnessesUnderstood", chronicleId: "c1" }),
      event({ kind: "performance", name: "indexeddb_save", level: "warn", data: { value: 330 } }),
      event({ kind: "error", name: "runtime_error", level: "error", data: { source: "window.error" } }),
      event({ kind: "health", name: "ci_quality_report", sessionId: "ci.1.1", receivedAt: "2026-08-07T12:30:00.000Z", buildSha: "abc123", data: { result: "pass", campaignScenarios: 18, autonomousSeeds: 12, semanticMutants: 15, mutationDomains: 8, protectedMilestones: 13, regressionBudgetStatus: "pass", regressionViolations: 0, regressionWarnings: 0, baselineSha: "base123", gates: { typecheck: { status: "success", durationMs: 1000 }, test: { status: "success", durationMs: 2200 }, build: { status: "success", durationMs: 900 } } } }),
      event({ kind: "health", name: "release_gate_decision", sessionId: "release.1", receivedAt: "2026-08-07T12:45:00.000Z", buildSha: "abc123", data: { decision: "eligible", candidateSha: "abc123", reasons: [], productionErrors: 0, productionFatal: 0, diagnostics: 0 } }),
    ]);
    expect(snapshot.totals.errors).toBe(1);
    expect(snapshot.progress.threeWitnessesCompleted).toBe(1);
    expect(snapshot.performance.p95PersistenceMs).toBe(330);
    expect(snapshot.quality.latest?.regressionBudgetStatus).toBe("pass");
    expect(snapshot.releaseReadiness.decisions).toBe(1);
    expect(snapshot.releaseReadiness.eligible).toBe(1);
    expect(snapshot.releaseReadiness.latest?.candidateSha).toBe("abc123");
    expect(snapshot.releaseReadiness.latest?.decision).toBe("eligible");
  });

  it("keeps blocked release reasons and recent decision history", () => {
    const snapshot = buildControlCenterSnapshot([
      event({ kind: "anomaly", name: "release_gate_decision", level: "error", receivedAt: "2026-08-07T13:00:00.000Z", data: { decision: "blocked", candidateSha: "bad123", reasons: ["production_fatal_events", "critical_diagnostics"], productionErrors: 2, productionFatal: 1, diagnostics: 1 } }),
      event({ kind: "health", name: "release_gate_decision", receivedAt: "2026-08-07T12:00:00.000Z", data: { decision: "eligible", candidateSha: "good123", reasons: [], productionErrors: 0, productionFatal: 0, diagnostics: 0 } }),
    ]);
    expect(snapshot.releaseReadiness.decisions).toBe(2);
    expect(snapshot.releaseReadiness.blocked).toBe(1);
    expect(snapshot.releaseReadiness.eligible).toBe(1);
    expect(snapshot.releaseReadiness.latest?.decision).toBe("blocked");
    expect(snapshot.releaseReadiness.latest?.reasons).toEqual(["production_fatal_events", "critical_diagnostics"]);
    expect(snapshot.releaseReadiness.recent).toHaveLength(2);
  });

  it("counts failing CI reports and regression budgets separately", () => {
    const snapshot = buildControlCenterSnapshot([
      event({ kind: "health", name: "ci_quality_report", data: { result: "pass", regressionBudgetStatus: "pass" }, receivedAt: "2026-08-07T12:00:00.000Z" }),
      event({ kind: "health", name: "ci_quality_report", level: "warn", data: { result: "pass", regressionBudgetStatus: "warn", regressionWarnings: 1 }, receivedAt: "2026-08-07T12:30:00.000Z" }),
      event({ kind: "anomaly", name: "ci_quality_report", level: "error", data: { result: "fail", regressionBudgetStatus: "fail", regressionViolations: 2 }, receivedAt: "2026-08-07T13:00:00.000Z" }),
    ]);
    expect(snapshot.quality.runs).toBe(3);
    expect(snapshot.quality.budgetWarnings).toBe(1);
    expect(snapshot.quality.budgetFailed).toBe(1);
  });

  it("keeps memory storage bounded by retention operations", async () => {
    const store = new MemoryTelemetryStore();
    await store.append([event({ kind: "session", name: "old", receivedAt: "2026-07-01T00:00:00.000Z" }), event({ kind: "session", name: "new", receivedAt: "2026-08-07T00:00:00.000Z" })]);
    expect(await store.prune(new Date("2026-08-01T00:00:00.000Z"))).toBe(1);
    expect((await store.recent()).map((item) => item.name)).toEqual(["new"]);
  });
});

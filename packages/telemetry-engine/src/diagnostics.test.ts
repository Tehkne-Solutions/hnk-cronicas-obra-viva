import { describe, expect, it } from "vitest";
import { analyzeTelemetry } from "./diagnostics.js";
import type { TelemetryEnvelope } from "./index.js";

function event(partial: Partial<TelemetryEnvelope> & Pick<TelemetryEnvelope, "kind" | "name">): TelemetryEnvelope {
  return {
    schemaVersion: 1,
    id: Math.random().toString(36),
    occurredAt: new Date().toISOString(),
    level: "info",
    sessionId: "session.test",
    data: {},
    ...partial,
  };
}

describe("telemetry diagnostics", () => {
  it("detects repeated persistence degradation", () => {
    const findings = analyzeTelemetry([
      event({ kind: "performance", name: "indexeddb_save", level: "warn", data: { value: 410 } }),
      event({ kind: "performance", name: "indexeddb_load", level: "warn", data: { value: 330 } }),
    ]);
    expect(findings.some((finding) => finding.code === "persistence_degradation")).toBe(true);
  });

  it("detects a likely progress stall without declaring truth", () => {
    const events: TelemetryEnvelope[] = [event({ kind: "health", name: "gameplay_health_snapshot", data: { unresolvedQuestionCount: 2 } })];
    for (let index = 0; index < 20; index += 1) events.push(event({ kind: "game_event", name: `Action${index}` }));
    expect(analyzeTelemetry(events).some((finding) => finding.code === "progress_stall")).toBe(true);
  });

  it("promotes Event Ledger regression to fatal integrity finding", () => {
    const findings = analyzeTelemetry([event({ kind: "anomaly", name: "event_ledger_regressed", level: "error" })]);
    expect(findings[0]?.code).toBe("ledger_regression");
    expect(findings[0]?.level).toBe("fatal");
  });
});

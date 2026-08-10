import { describe, expect, it } from "vitest";
import type { ControlCenterSnapshot, StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { buildExecutiveHealthSnapshot } from "./executive-health.js";

const SHA = "1234567890abcdef1234567890abcdef12345678";
function event(name: string, data: Record<string, unknown>, receivedAt: string): StoredTelemetryEvent {
  return {
    schemaVersion: 1,
    id: `${name}.${receivedAt}`,
    occurredAt: receivedAt,
    receivedAt,
    kind: name.includes("fail") ? "anomaly" : "health",
    name,
    level: name.includes("fail") ? "error" : "info",
    sessionId: "executive-health-test",
    buildSha: SHA,
    release: "test",
    data,
  } as StoredTelemetryEvent;
}
function snapshot(events: readonly StoredTelemetryEvent[]): ControlCenterSnapshot {
  return {
    generatedAt: "2026-08-10T18:00:00.000Z",
    recentEvents: events,
  } as unknown as ControlCenterSnapshot;
}

const promotion = event("promotion_completed", { promotionId: "promotion.test", candidateSha: SHA, verifiedManifestSha: SHA, failures: [] }, "2026-08-10T17:50:00.000Z");
const sentinel = event("post_release_sentinel_pass", { promotionId: "promotion.test", candidateSha: SHA, failures: [] }, "2026-08-10T17:51:00.000Z");

describe("executive operational health", () => {
  it("declares READY only with coherent quality and release evidence", () => {
    const quality = event("quality_release_gate_pass", { candidateSha: SHA, regressionBudgetStatus: "pass" }, "2026-08-10T17:52:00.000Z");
    const result = buildExecutiveHealthSnapshot(snapshot([promotion, sentinel, quality]));
    expect(result.status).toBe("ready");
    expect(result.ready).toBe(true);
    expect(result.score).toBe(100);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("blocks readiness when the quality gate fails", () => {
    const quality = event("quality_release_gate_fail", { candidateSha: SHA, regressionBudgetStatus: "fail" }, "2026-08-10T17:52:00.000Z");
    const result = buildExecutiveHealthSnapshot(snapshot([promotion, sentinel, quality]));
    expect(result.status).toBe("blocked");
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("quality_release_gate_failed");
  });
});

import { describe, expect, it } from "vitest";
import type { ControlCenterSnapshot, StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { renderIncidentDashboard } from "../src/incident-dashboard.js";

function event(id: string, sha: string, failure: string, receivedAt: string): StoredTelemetryEvent {
  return {
    schemaVersion: 1,
    id,
    occurredAt: receivedAt,
    receivedAt,
    kind: "anomaly",
    name: "post_release_sentinel_fail",
    level: "error",
    sessionId: `sentinel.${id}`,
    buildSha: sha,
    data: { promotionId: `promotion.${id}`, candidateSha: sha, failures: [failure] },
  };
}

describe("incident dashboard", () => {
  it("renders grouped fingerprints, recurrence and affected SHAs", () => {
    const recentEvents = [
      event("r1", "a".repeat(40), "runtime_error_threshold:4", "2026-08-09T20:00:00.000Z"),
      event("r2", "a".repeat(40), "runtime_error_threshold:8", "2026-08-09T20:05:00.000Z"),
      event("r3", "b".repeat(40), "runtime_error_threshold:9", "2026-08-09T21:00:00.000Z"),
    ];
    const snapshot = { generatedAt: "2026-08-09T21:01:00.000Z", recentEvents } as unknown as ControlCenterSnapshot;
    const html = renderIncidentDashboard(snapshot, { mode: "memory", release: "production" });
    expect(html).toContain("Incident Ledger");
    expect(html).toContain("Reincidente");
    expect(html).toContain("runtime");
    expect(html).toContain("aaaaaaaa");
    expect(html).toContain("bbbbbbbb");
    expect(html).toContain("Ação recomendada");
  });
});

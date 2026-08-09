import { describe, expect, it } from "vitest";
import type { ControlCenterSnapshot, StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { renderPromotionDashboard } from "../src/promotion-dashboard.js";

function event(name: string, receivedAt: string, data: Record<string, unknown>, level: "info" | "error" = "info"): StoredTelemetryEvent {
  return {
    schemaVersion: 1,
    id: `${name}.${receivedAt}`,
    occurredAt: receivedAt,
    receivedAt,
    kind: level === "error" ? "anomaly" : "health",
    name,
    level,
    sessionId: "promotion.ui",
    buildSha: "a".repeat(40),
    data,
  };
}

describe("promotion dashboard", () => {
  it("renders healthy and degraded post-release states", () => {
    const recentEvents = [
      event("promotion_completed", "2026-08-09T19:00:00.000Z", { promotionId: "promotion.1", candidateSha: "a".repeat(40), authorizationId: "auth.1", verifiedManifestSha: "a".repeat(40), failures: [] }),
      event("post_release_sentinel_pass", "2026-08-09T19:02:00.000Z", { promotionId: "promotion.1", candidateSha: "a".repeat(40), failures: [] }),
      event("promotion_completed", "2026-08-09T20:00:00.000Z", { promotionId: "promotion.2", candidateSha: "b".repeat(40), authorizationId: "auth.2", verifiedManifestSha: "b".repeat(40), failures: [] }),
      event("post_release_sentinel_fail", "2026-08-09T20:02:00.000Z", { promotionId: "promotion.2", candidateSha: "b".repeat(40), failures: ["runtime_error_threshold:4"] }, "error"),
    ];
    const snapshot = { generatedAt: "2026-08-09T20:03:00.000Z", recentEvents } as unknown as ControlCenterSnapshot;
    const html = renderPromotionDashboard(snapshot, { release: "production", mode: "memory" });
    expect(html).toContain("Promotion &amp; Post-Release Ledger");
    expect(html).toContain("Degradada");
    expect(html).toContain("Saudáveis");
    expect(html).toContain("Runtime");
    expect(html).toContain("auth.2");
  });
});

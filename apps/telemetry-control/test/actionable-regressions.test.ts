import { describe, expect, it } from "vitest";
import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { deriveActionableRegression } from "../src/actionable-regressions.js";

const base = (name: string, failures: string[]): StoredTelemetryEvent => ({
  schemaVersion: 1,
  id: `${name}.1`,
  occurredAt: "2026-08-09T21:00:00.000Z",
  receivedAt: "2026-08-09T21:00:00.000Z",
  kind: "anomaly",
  name,
  level: "error",
  sessionId: "sentinel.1",
  buildSha: "a".repeat(40),
  data: { promotionId: "promotion.1", candidateSha: "a".repeat(40), failures },
});

describe("actionable regression routing", () => {
  it("routes runtime sentinel failures", () => {
    const result = deriveActionableRegression(base("post_release_sentinel_fail", ["runtime_error_threshold:4"]));
    expect(result?.domain).toBe("runtime");
    expect(result?.recommendedAction.length).toBeGreaterThan(20);
  });

  it("routes release manifest failures", () => {
    const result = deriveActionableRegression(base("promotion_rollback_required", ["release_manifest_sha_mismatch"]));
    expect(result?.domain).toBe("release_infrastructure");
    expect(result?.recommendedAction).toContain("release.json");
  });

  it("ignores unrelated events", () => {
    expect(deriveActionableRegression(base("gameplay_event", ["runtime_error"]))).toBeNull();
  });
});

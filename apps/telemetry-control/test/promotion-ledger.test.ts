import { describe, expect, it } from "vitest";
import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { classifyRegressionDomain, derivePromotionLedger } from "../src/promotion-ledger.js";

function event(name: string, receivedAt: string, data: Record<string, unknown>, level: "info" | "error" = "info"): StoredTelemetryEvent {
  return {
    schemaVersion: 1,
    id: `${name}.${receivedAt}`,
    occurredAt: receivedAt,
    receivedAt,
    kind: level === "error" ? "anomaly" : "health",
    name,
    level,
    sessionId: "promotion.abc",
    buildSha: "a".repeat(40),
    data,
  };
}

describe("promotion ledger", () => {
  it("correlates successful promotion with sentinel pass", () => {
    const ledger = derivePromotionLedger([
      event("promotion_completed", "2026-08-09T19:00:00.000Z", { promotionId: "promotion.1", candidateId: "prc.1", candidateSha: "a".repeat(40), authorizationId: "auth.1", verifiedManifestSha: "a".repeat(40), failures: [] }),
      event("post_release_sentinel_pass", "2026-08-09T19:02:00.000Z", { promotionId: "promotion.1", candidateSha: "a".repeat(40), failures: [] }),
    ]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.health).toBe("healthy");
    expect(ledger[0]?.sentinelStatus).toBe("pass");
  });

  it("marks post-release runtime regression as degraded", () => {
    const ledger = derivePromotionLedger([
      event("promotion_completed", "2026-08-09T19:00:00.000Z", { promotionId: "promotion.2", candidateSha: "a".repeat(40), failures: [] }),
      event("post_release_sentinel_fail", "2026-08-09T19:02:00.000Z", { promotionId: "promotion.2", candidateSha: "a".repeat(40), failures: ["runtime_error_threshold:4"] }, "error"),
    ]);
    expect(ledger[0]?.health).toBe("degraded");
    expect(ledger[0]?.regressionDomains).toContain("runtime");
  });

  it("keeps promotion rollback distinct from post-release degradation", () => {
    const ledger = derivePromotionLedger([
      event("promotion_rollback_required", "2026-08-09T19:00:00.000Z", { promotionId: "promotion.3", candidateSha: "a".repeat(40), failures: ["post_deploy_verification_failed:release_manifest_sha_mismatch"] }, "error"),
    ]);
    expect(ledger[0]?.health).toBe("rollback_required");
    expect(ledger[0]?.regressionDomains).toContain("release_infrastructure");
  });
});

describe("regression domain classifier", () => {
  it("classifies operational domains", () => {
    expect(classifyRegressionDomain("indexeddb_save_failed")).toBe("persistence");
    expect(classifyRegressionDomain("long_task_threshold")).toBe("performance");
    expect(classifyRegressionDomain("chronicle_progress_stalled")).toBe("progression");
    expect(classifyRegressionDomain("release_manifest_sha_mismatch")).toBe("release_infrastructure");
    expect(classifyRegressionDomain("runtime_exception")).toBe("runtime");
  });
});

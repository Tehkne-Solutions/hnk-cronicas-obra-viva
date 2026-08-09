import { describe, expect, it } from "vitest";
import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { deriveIncidentIntelligence } from "../src/incident-intelligence.js";

function regression(id: string, sha: string, failure: string, receivedAt: string): StoredTelemetryEvent {
  return {
    schemaVersion: 1,
    id,
    occurredAt: receivedAt,
    receivedAt,
    kind: "anomaly",
    name: "post_release_sentinel_fail",
    level: "error",
    sessionId: `sentinel.${sha.slice(0, 6)}`,
    buildSha: sha,
    data: { promotionId: `promotion.${sha.slice(0, 6)}`, candidateSha: sha, failures: [failure] },
  };
}

describe("incident intelligence", () => {
  it("classifies the first fingerprint as new", () => {
    const current = regression("r1", "a".repeat(40), "runtime_error_threshold:4", "2026-08-09T21:00:00.000Z");
    const result = deriveIncidentIntelligence(current, []);
    expect(result?.state).toBe("new");
    expect(result?.occurrences).toBe(1);
    expect(result?.fingerprint).toHaveLength(20);
  });

  it("classifies the same fingerprint on the same SHA as recurrent", () => {
    const first = regression("r1", "a".repeat(40), "runtime_error_threshold:4", "2026-08-09T21:00:00.000Z");
    const current = regression("r2", "a".repeat(40), "runtime_error_threshold:9", "2026-08-09T21:05:00.000Z");
    const result = deriveIncidentIntelligence(current, [first]);
    expect(result?.state).toBe("recurrent");
    expect(result?.occurrences).toBe(2);
  });

  it("classifies a fingerprint seen on another SHA as known regression", () => {
    const first = regression("r1", "a".repeat(40), "runtime_error_threshold:4", "2026-08-09T21:00:00.000Z");
    const current = regression("r2", "b".repeat(40), "runtime_error_threshold:7", "2026-08-09T22:00:00.000Z");
    const result = deriveIncidentIntelligence(current, [first]);
    expect(result?.state).toBe("known_regression");
    expect(result?.affectedBuildShas).toHaveLength(2);
  });
});

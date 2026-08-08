import { describe, expect, it } from "vitest";
import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { deriveReleaseCandidateRegistry } from "../src/release-candidates.js";

function candidate(partial: Partial<StoredTelemetryEvent> = {}): StoredTelemetryEvent {
  return {
    schemaVersion: 1,
    id: "candidate.event",
    occurredAt: "2026-08-08T12:00:00.000Z",
    receivedAt: "2026-08-08T12:00:01.000Z",
    kind: "health",
    name: "release_candidate_registered",
    level: "info",
    sessionId: "release.abc",
    buildSha: "abc123",
    data: {
      candidateId: "rc.abc123.1",
      candidateSha: "abc123",
      createdAt: "2026-08-08T12:00:00.000Z",
      expiresAt: "2026-08-09T12:00:00.000Z",
      regressionBudget: "pass",
      qualityBaselineSha: "base123",
    },
    ...partial,
  };
}

describe("release candidate registry", () => {
  it("keeps the current non-expired candidate active", () => {
    const [item] = deriveReleaseCandidateRegistry([candidate()], "abc123", new Date("2026-08-08T18:00:00.000Z"));
    expect(item?.status).toBe("active");
    expect(item?.qualityBaselineSha).toBe("base123");
  });

  it("marks a candidate superseded when a newer main quality SHA exists", () => {
    const [item] = deriveReleaseCandidateRegistry([candidate()], "def456", new Date("2026-08-08T18:00:00.000Z"));
    expect(item?.status).toBe("superseded");
  });

  it("marks expiration before supersession", () => {
    const [item] = deriveReleaseCandidateRegistry([candidate()], "def456", new Date("2026-08-10T12:00:00.000Z"));
    expect(item?.status).toBe("expired");
  });
});

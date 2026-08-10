import { describe, expect, it } from "vitest";
import type { IncidentLifecycle } from "../src/incident-lifecycle.js";
import { recommendRecovery } from "../src/recovery-intelligence.js";

const base = {
  severity: "error",
  domain: "runtime",
  state: "new",
  failures: ["runtime_error_threshold:4"],
  recommendedAction: "investigate runtime",
  candidateSha: "a".repeat(40),
  fingerprint: "fp-runtime",
  occurrences: 1,
  affectedBuildShas: ["a".repeat(40)],
  firstSeenAt: "2026-08-10T10:00:00.000Z",
  lastSeenAt: "2026-08-10T10:00:00.000Z",
  lifecycleState: "open",
  openedAt: "2026-08-10T10:00:00.000Z",
  openDurationMs: 60000,
  reopenCount: 0,
  transitions: [],
} as unknown as IncidentLifecycle;

describe("automatic recovery intelligence", () => {
  it("continues after resolution", () => expect(recommendRecovery({ ...base, lifecycleState: "resolved" } as IncidentLifecycle).decision).toBe("continue"));
  it("blocks promotion for active regression", () => expect(recommendRecovery(base).decision).toBe("block_promotion"));
  it("recommends rollback for recurrent fatal incident", () => {
    const result = recommendRecovery({ ...base, severity: "fatal", state: "recurrent", occurrences: 4, reopenCount: 1, domain: "persistence" } as IncidentLifecycle);
    expect(result.decision).toBe("rollback_recommended");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });
});

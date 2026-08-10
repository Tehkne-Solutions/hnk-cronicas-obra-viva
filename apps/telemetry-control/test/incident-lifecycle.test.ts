import { describe, expect, it } from "vitest";
import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { deriveIncidentLifecycles, type IncidentLifecycle } from "../src/incident-lifecycle.js";

function event(id: string, name: string, receivedAt: string, data: Record<string, unknown>, buildSha = "a".repeat(40)): StoredTelemetryEvent {
  return { schemaVersion: 1, id, occurredAt: receivedAt, receivedAt, kind: name.startsWith("incident_") ? "health" : "anomaly", name, level: name.startsWith("incident_") ? "info" : "error", sessionId: `incident.${id}`, buildSha, data };
}

function requireIncident(value: IncidentLifecycle | undefined): IncidentLifecycle {
  expect(value).toBeDefined();
  if (!value) throw new Error("expected incident lifecycle");
  return value;
}

describe("incident lifecycle", () => {
  it("tracks open through resolved and computes MTTA/MTTR", () => {
    const failure = event("r1", "post_release_sentinel_fail", "2026-08-09T20:00:00.000Z", { candidateSha: "a".repeat(40), failures: ["runtime_error_threshold:4"] });
    const seed = requireIncident(deriveIncidentLifecycles([failure], "2026-08-09T20:01:00.000Z")[0]);
    const fp = seed.fingerprint;
    const events = [
      failure,
      event("i1", "incident_investigating", "2026-08-09T20:05:00.000Z", { fingerprint: fp }),
      event("m1", "incident_mitigated", "2026-08-09T20:10:00.000Z", { fingerprint: fp }),
      event("x1", "incident_resolved", "2026-08-09T20:20:00.000Z", { fingerprint: fp, resolvedBuildSha: "b".repeat(40) }, "b".repeat(40)),
    ];
    const incident = requireIncident(deriveIncidentLifecycles(events, "2026-08-09T20:30:00.000Z")[0]);
    expect(incident.lifecycleState).toBe("resolved");
    expect(incident.mttaMs).toBe(5 * 60_000);
    expect(incident.mttrMs).toBe(20 * 60_000);
    expect(incident.resolvedBuildSha).toBe("b".repeat(40));
    expect(incident.transitions.map((item) => item.state)).toEqual(["open", "investigating", "mitigated", "resolved"]);
  });

  it("reopens a resolved incident when the same fingerprint regresses again", () => {
    const first = event("r1", "post_release_sentinel_fail", "2026-08-09T20:00:00.000Z", { candidateSha: "a".repeat(40), failures: ["runtime_error_threshold:4"] });
    const fp = requireIncident(deriveIncidentLifecycles([first], "2026-08-09T20:01:00.000Z")[0]).fingerprint;
    const resolved = event("x1", "incident_resolved", "2026-08-09T20:10:00.000Z", { fingerprint: fp, resolvedBuildSha: "b".repeat(40) }, "b".repeat(40));
    const relapse = event("r2", "post_release_sentinel_fail", "2026-08-09T21:00:00.000Z", { candidateSha: "c".repeat(40), failures: ["runtime_error_threshold:9"] }, "c".repeat(40));
    const incident = requireIncident(deriveIncidentLifecycles([first, resolved, relapse], "2026-08-09T21:05:00.000Z")[0]);
    expect(incident.lifecycleState).toBe("open");
    expect(incident.reopenCount).toBe(1);
    expect(incident.transitions.at(-1)?.state).toBe("open");
  });
});

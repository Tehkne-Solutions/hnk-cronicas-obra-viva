import { describe, expect, it, vi } from "vitest";
import { MemoryTelemetryStore, type StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { TelemetryAlertManager } from "../src/alerting.js";

function sentinel(id: string, sha: string, receivedAt: string): StoredTelemetryEvent {
  return {
    schemaVersion: 1,
    id,
    occurredAt: receivedAt,
    receivedAt,
    kind: "anomaly",
    name: "post_release_sentinel_fail",
    level: "error",
    sessionId: "sentinel.alert",
    buildSha: sha,
    data: { promotionId: `promotion.${id}`, candidateSha: sha, failures: ["runtime_error_threshold:4"] },
  };
}

describe("incident alerting", () => {
  it("sends fingerprint, recurrence state and occurrence count", async () => {
    const store = new MemoryTelemetryStore();
    const firstAt = new Date(Date.now() - 60_000).toISOString();
    const secondAt = new Date().toISOString();
    await store.append([sentinel("one", "a".repeat(40), firstAt), sentinel("two", "a".repeat(40), secondAt)]);
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const manager = new TelemetryAlertManager({ store, webhook: "https://alerts.example/hook", release: "production", buildSha: "a".repeat(40), fetchImpl, cooldownMs: 60_000 });
    await manager.inspectSessions(["sentinel.alert"]);
    const incidentPayload = bodies.map((body) => body as { hnk?: { incident?: { fingerprint?: string; state?: string; occurrences?: number } } }).find((body) => body.hnk?.incident);
    expect(incidentPayload?.hnk?.incident?.fingerprint).toHaveLength(20);
    expect(incidentPayload?.hnk?.incident?.state).toBe("recurrent");
    expect(incidentPayload?.hnk?.incident?.occurrences).toBe(2);
  });
});

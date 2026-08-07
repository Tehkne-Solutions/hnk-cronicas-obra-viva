import { describe, expect, it, vi } from "vitest";
import { MemoryTelemetryStore, type StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { TelemetryAlertManager } from "../src/alerting.js";

function runtimeError(id: string): StoredTelemetryEvent {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id,
    occurredAt: now,
    receivedAt: now,
    kind: "error",
    name: "runtime_error",
    level: "error",
    sessionId: "session.alert",
    chronicleId: "chronicle.alert",
    data: { source: "window.error" },
  };
}

describe("TelemetryAlertManager", () => {
  it("dispatches an error storm once and deduplicates during cooldown", async () => {
    const store = new MemoryTelemetryStore();
    await store.append([runtimeError("e1"), runtimeError("e2"), runtimeError("e3")]);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const manager = new TelemetryAlertManager({ store, webhook: "https://alerts.example/hook", release: "test", buildSha: "abc", fetchImpl, cooldownMs: 60_000 });
    const first = await manager.inspectSessions(["session.alert"]);
    const second = await manager.inspectSessions(["session.alert"]);
    expect(first.map((item) => item.finding.code)).toContain("error_storm");
    expect(second).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

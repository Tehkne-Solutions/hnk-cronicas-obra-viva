import { afterEach, describe, expect, it } from "vitest";
import { MemoryTelemetryStore } from "@hnk/telemetry-control-core";
import { createControlCenterServer } from "../src/app.js";
import type { Server } from "node:http";

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; });

async function boot() {
  const store = new MemoryTelemetryStore();
  server = createControlCenterServer({ store, adminToken: "secret", allowedOrigins: new Set(["https://game.example"]), retentionDays: 30, release: "test", buildSha: "abc123", rateLimitPerMinute: 20 });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test server address");
  return { store, base: `http://127.0.0.1:${address.port}` };
}

const envelope = { schemaVersion: 1, id: "event.1", occurredAt: "2026-08-07T12:00:00.000Z", kind: "game_event", name: "CombustionStarted", level: "info", sessionId: "session.1", chronicleId: "chronicle.1", data: {} };

describe("telemetry control HTTP", () => {
  it("accepts telemetry from an allowed origin and preserves release identity", async () => {
    const { store, base } = await boot();
    const response = await fetch(`${base}/v1/telemetry`, { method: "POST", headers: { "content-type": "application/json", origin: "https://game.example" }, body: JSON.stringify({ schemaVersion: 1, release: "alpha.7", buildSha: "deadbeef", events: [envelope] }) });
    expect(response.status).toBe(202);
    const stored = await store.recent();
    expect(stored[0]?.name).toBe("CombustionStarted");
    expect(stored[0]?.release).toBe("alpha.7");
    expect(stored[0]?.buildSha).toBe("deadbeef");
    expect(stored[0]?.remoteAddress).toBeUndefined();
  });

  it("rejects disallowed browser origins", async () => {
    const { base } = await boot();
    const response = await fetch(`${base}/v1/telemetry`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ events: [envelope] }) });
    expect(response.status).toBe(403);
  });

  it("protects dashboard and exposes snapshot after authentication", async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/api/snapshot`)).status).toBe(401);
    await fetch(`${base}/v1/telemetry`, { method: "POST", headers: { "content-type": "application/json", origin: "https://game.example" }, body: JSON.stringify({ events: [envelope] }) });
    const auth = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
    const snapshotResponse = await fetch(`${base}/api/snapshot`, { headers: { authorization: auth } });
    expect(snapshotResponse.status).toBe(200);
    const snapshot = await snapshotResponse.json() as { progress: { combustionStarted: number } };
    expect(snapshot.progress.combustionStarted).toBe(1);
    const dashboard = await fetch(`${base}/control`, { headers: { authorization: auth } });
    expect(await dashboard.text()).toContain("Telemetry Control Center");
  });
});

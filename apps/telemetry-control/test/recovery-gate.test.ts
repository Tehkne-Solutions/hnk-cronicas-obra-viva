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
  return `http://127.0.0.1:${address.port}`;
}

const auth = { authorization: "Bearer secret" };

describe("recovery gate API", () => {
  it("allows promotion when there are no active incidents", async () => {
    const base = await boot();
    expect((await fetch(`${base}/api/recovery`)).status).toBe(401);
    const response = await fetch(`${base}/api/recovery`, { headers: auth });
    expect(response.status).toBe(200);
    const body = await response.json() as { decision: string; blocked: boolean; activeIncidents: number };
    expect(body.decision).toBe("continue");
    expect(body.blocked).toBe(false);
    expect(body.activeIncidents).toBe(0);
  });

  it("blocks promotion when an unresolved post-release regression exists", async () => {
    const base = await boot();
    const occurredAt = new Date().toISOString();
    const event = {
      schemaVersion: 1,
      id: "sentinel.failure.1",
      occurredAt,
      kind: "anomaly",
      name: "post_release_sentinel_fail",
      level: "error",
      sessionId: "sentinel.production",
      data: { candidateSha: "a".repeat(40), failures: ["runtime_error_threshold:4"] },
    };
    const accepted = await fetch(`${base}/v1/telemetry`, { method: "POST", headers: { "content-type": "application/json", origin: "https://game.example" }, body: JSON.stringify({ release: "production", buildSha: "a".repeat(40), events: [event] }) });
    expect(accepted.status).toBe(202);
    const response = await fetch(`${base}/api/recovery`, { headers: auth });
    const body = await response.json() as { decision: string; blocked: boolean; activeIncidents: number; recommendations: Array<{ fingerprint: string }> };
    expect(body.blocked).toBe(true);
    expect(body.decision).toBe("block_promotion");
    expect(body.activeIncidents).toBe(1);
    expect(body.recommendations[0]?.fingerprint).toHaveLength(20);
  });
});

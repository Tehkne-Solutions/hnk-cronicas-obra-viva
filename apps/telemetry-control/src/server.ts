import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { buildControlCenterSnapshot, MemoryTelemetryStore, type StoredTelemetryEvent, type TelemetryStore } from "@hnk/telemetry-control-core";
import type { TelemetryEnvelope } from "@hnk/telemetry-engine";
import { renderDashboard } from "./dashboard.js";
import { PostgresTelemetryStore } from "./postgres-store.js";

const PORT = Number(process.env.PORT ?? 8787);
const ADMIN_TOKEN = process.env.HNK_TELEMETRY_ADMIN_TOKEN ?? "";
const DATABASE_URL = process.env.DATABASE_URL;
const RETENTION_DAYS = Math.max(1, Number(process.env.HNK_TELEMETRY_RETENTION_DAYS ?? 30));
const RELEASE = process.env.HNK_RELEASE ?? "dev";
const BUILD_SHA = process.env.HNK_BUILD_SHA ?? "unknown";
const SSL = process.env.HNK_TELEMETRY_DB_SSL === "true";
const ALLOWED_ORIGINS = new Set((process.env.HNK_TELEMETRY_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((item) => item.trim()).filter(Boolean));
const RATE_LIMIT_PER_MINUTE = Math.max(10, Number(process.env.HNK_TELEMETRY_RATE_LIMIT_PER_MINUTE ?? 300));
const MAX_BODY_BYTES = 512 * 1024;
const store: TelemetryStore = DATABASE_URL ? new PostgresTelemetryStore(DATABASE_URL, SSL) : new MemoryTelemetryStore();
const rates = new Map<string, { start: number; count: number }>();

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function text(res: ServerResponse, status: number, value: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(value);
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function cors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-methods", "POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
  }
}

function remoteAddress(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return value?.trim() || req.socket.remoteAddress || "unknown";
}

function rateAllowed(req: IncomingMessage): boolean {
  const key = remoteAddress(req);
  const now = Date.now();
  const current = rates.get(key);
  if (!current || now - current.start >= 60_000) { rates.set(key, { start: now, count: 1 }); return true; }
  current.count += 1;
  if (rates.size > 5000) for (const [address, item] of rates) if (now - item.start >= 120_000) rates.delete(address);
  return current.count <= RATE_LIMIT_PER_MINUTE;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("payload_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isEnvelope(value: unknown): value is TelemetryEnvelope {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.schemaVersion === 1 && typeof event.id === "string" && typeof event.occurredAt === "string" &&
    typeof event.kind === "string" && typeof event.name === "string" && typeof event.level === "string" &&
    typeof event.sessionId === "string" && event.data !== null && typeof event.data === "object";
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function adminAuthorized(req: IncomingMessage): boolean {
  if (!ADMIN_TOKEN) return false;
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return secureEqual(auth.slice(7), ADMIN_TOKEN);
  if (auth.startsWith("Basic ")) {
    try { const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8"); return secureEqual(decoded.split(":").slice(1).join(":"), ADMIN_TOKEN); } catch { return false; }
  }
  return false;
}

function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
  if (adminAuthorized(req)) return true;
  res.setHeader("www-authenticate", 'Basic realm="HENUVOKODAN Telemetry"');
  text(res, ADMIN_TOKEN ? 401 : 503, ADMIN_TOKEN ? "Authentication required." : "HNK_TELEMETRY_ADMIN_TOKEN is not configured.");
  return false;
}

async function snapshot(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const events = await store.recent({ since, limit: 20_000 });
  return buildControlCenterSnapshot(events, hours);
}

async function ingest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  cors(req, res);
  if (!originAllowed(req)) { json(res, 403, { ok: false, error: "origin_not_allowed" }); return; }
  if (!rateAllowed(req)) { json(res, 429, { ok: false, error: "rate_limited" }); return; }
  try {
    const value = await readBody(req) as Record<string, unknown>;
    const rawEvents = Array.isArray(value.events) ? value.events : [];
    if (rawEvents.length === 0 || rawEvents.length > 100 || rawEvents.some((event) => !isEnvelope(event))) {
      json(res, 400, { ok: false, error: "invalid_telemetry_batch" }); return;
    }
    const receivedAt = new Date().toISOString();
    const remote = remoteAddress(req);
    const release = typeof value.release === "string" ? value.release.slice(0, 80) : undefined;
    const buildSha = typeof value.buildSha === "string" ? value.buildSha.slice(0, 80) : undefined;
    const events: StoredTelemetryEvent[] = rawEvents.map((event) => Object.freeze({
      ...(event as TelemetryEnvelope), receivedAt, remoteAddress: remote,
      ...(release ? { release } : {}), ...(buildSha ? { buildSha } : {}),
    }));
    await store.append(events);
    if (Math.random() < 0.02) await store.prune(new Date(Date.now() - RETENTION_DAYS * 86_400_000));
    json(res, 202, { ok: true, accepted: events.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ingest_failed";
    json(res, message === "payload_too_large" ? 413 : 400, { ok: false, error: message });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "OPTIONS" && url.pathname === "/v1/telemetry") { cors(req, res); res.writeHead(204); res.end(); return; }
    if (req.method === "POST" && url.pathname === "/v1/telemetry") { await ingest(req, res); return; }
    if (req.method === "GET" && url.pathname === "/health") {
      const health = await store.health(); json(res, health.ok ? 200 : 503, { ok: health.ok, storage: health.mode, release: RELEASE, buildSha: BUILD_SHA, uptimeSeconds: Math.round(process.uptime()) }); return;
    }
    if (req.method === "GET" && url.pathname === "/api/snapshot") {
      if (!requireAdmin(req, res)) return; const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours") ?? 24))); json(res, 200, await snapshot(hours)); return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/control")) {
      if (!requireAdmin(req, res)) return; const health = await store.health(); const view = await snapshot(24); text(res, 200, renderDashboard(view, { mode: health.mode, release: RELEASE, retentionDays: RETENTION_DAYS }), "text/html; charset=utf-8"); return;
    }
    json(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    console.error("telemetry-control request failed", error);
    json(res, 500, { ok: false, error: "internal_error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HENUVOKODAN Telemetry Control Center listening on :${PORT} (${DATABASE_URL ? "postgres" : "memory"})`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)));

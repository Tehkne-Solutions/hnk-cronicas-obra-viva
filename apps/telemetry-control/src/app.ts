import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { buildControlCenterSnapshot, type StoredTelemetryEvent, type TelemetryStore } from "@hnk/telemetry-control-core";
import type { TelemetryEnvelope } from "@hnk/telemetry-engine";
import type { TelemetryAlertManager } from "./alerting.js";
import { renderDashboard } from "./dashboard.js";

export interface ControlCenterConfig {
  readonly store: TelemetryStore;
  readonly adminToken: string;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly retentionDays: number;
  readonly release: string;
  readonly buildSha: string;
  readonly rateLimitPerMinute: number;
  readonly alertManager?: TelemetryAlertManager;
}

const MAX_BODY_BYTES = 512 * 1024;

function json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(value)); }
function text(res: ServerResponse, status: number, value: string, type = "text/plain; charset=utf-8"): void { res.writeHead(status, { "content-type": type, "cache-control": "no-store" }); res.end(value); }
function remoteAddress(req: IncomingMessage): string { const forwarded = req.headers["x-forwarded-for"]; const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]; return value?.trim() || req.socket.remoteAddress || "unknown"; }
function secureEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > MAX_BODY_BYTES) throw new Error("payload_too_large"); chunks.push(buffer); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isEnvelope(value: unknown): value is TelemetryEnvelope {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.schemaVersion === 1 && typeof event.id === "string" && typeof event.occurredAt === "string" && typeof event.kind === "string" && typeof event.name === "string" && typeof event.level === "string" && typeof event.sessionId === "string" && event.data !== null && typeof event.data === "object";
}

export function createControlCenterServer(config: ControlCenterConfig) {
  const rates = new Map<string, { start: number; count: number }>();
  const originAllowed = (req: IncomingMessage) => !req.headers.origin || config.allowedOrigins.has(req.headers.origin);
  const cors = (req: IncomingMessage, res: ServerResponse) => { const origin = req.headers.origin; if (origin && config.allowedOrigins.has(origin)) { res.setHeader("access-control-allow-origin", origin); res.setHeader("vary", "Origin"); res.setHeader("access-control-allow-methods", "POST,OPTIONS"); res.setHeader("access-control-allow-headers", "content-type"); } };
  const rateAllowed = (req: IncomingMessage) => { const key = remoteAddress(req); const now = Date.now(); const current = rates.get(key); if (!current || now - current.start >= 60_000) { rates.set(key, { start: now, count: 1 }); return true; } current.count += 1; return current.count <= config.rateLimitPerMinute; };
  const adminAuthorized = (req: IncomingMessage) => {
    if (!config.adminToken) return false; const auth = req.headers.authorization ?? "";
    if (auth.startsWith("Bearer ")) return secureEqual(auth.slice(7), config.adminToken);
    if (auth.startsWith("Basic ")) { try { const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8"); return secureEqual(decoded.split(":").slice(1).join(":"), config.adminToken); } catch { return false; } }
    return false;
  };
  const requireAdmin = (req: IncomingMessage, res: ServerResponse) => { if (adminAuthorized(req)) return true; res.setHeader("www-authenticate", 'Basic realm="HENUVOKODAN Telemetry"'); text(res, config.adminToken ? 401 : 503, config.adminToken ? "Authentication required." : "HNK_TELEMETRY_ADMIN_TOKEN is not configured."); return false; };
  const snapshot = async (hours = 24) => buildControlCenterSnapshot(await config.store.recent({ since: new Date(Date.now() - hours * 3_600_000), limit: 20_000 }), hours);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "OPTIONS" && url.pathname === "/v1/telemetry") { cors(req, res); res.writeHead(204); res.end(); return; }
      if (req.method === "POST" && url.pathname === "/v1/telemetry") {
        cors(req, res);
        if (!originAllowed(req)) { json(res, 403, { ok: false, error: "origin_not_allowed" }); return; }
        if (!rateAllowed(req)) { json(res, 429, { ok: false, error: "rate_limited" }); return; }
        try {
          const value = await readBody(req) as Record<string, unknown>; const rawEvents = Array.isArray(value.events) ? value.events : [];
          if (rawEvents.length === 0 || rawEvents.length > 100 || rawEvents.some((event) => !isEnvelope(event))) { json(res, 400, { ok: false, error: "invalid_telemetry_batch" }); return; }
          const receivedAt = new Date().toISOString(); const release = typeof value.release === "string" ? value.release.slice(0, 80) : undefined; const buildSha = typeof value.buildSha === "string" ? value.buildSha.slice(0, 80) : undefined;
          const events: StoredTelemetryEvent[] = rawEvents.map((event) => Object.freeze({ ...(event as TelemetryEnvelope), receivedAt, ...(release ? { release } : {}), ...(buildSha ? { buildSha } : {}) }));
          await config.store.append(events);
          if (config.alertManager) void config.alertManager.inspectSessions(events.map((event) => event.sessionId)).catch((error) => console.error("telemetry alert dispatch failed", error));
          if (Math.random() < 0.02) await config.store.prune(new Date(Date.now() - config.retentionDays * 86_400_000));
          json(res, 202, { ok: true, accepted: events.length }); return;
        } catch (error) { const message = error instanceof Error ? error.message : "ingest_failed"; json(res, message === "payload_too_large" ? 413 : 400, { ok: false, error: message }); return; }
      }
      if (req.method === "GET" && url.pathname === "/health") { const health = await config.store.health(); json(res, health.ok ? 200 : 503, { ok: health.ok, storage: health.mode, release: config.release, buildSha: config.buildSha, uptimeSeconds: Math.round(process.uptime()) }); return; }
      if (req.method === "GET" && url.pathname === "/api/snapshot") { if (!requireAdmin(req, res)) return; const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours") ?? 24))); json(res, 200, await snapshot(hours)); return; }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/control")) { if (!requireAdmin(req, res)) return; const health = await config.store.health(); text(res, 200, renderDashboard(await snapshot(24), { mode: health.mode, release: config.release, retentionDays: config.retentionDays }), "text/html; charset=utf-8"); return; }
      json(res, 404, { ok: false, error: "not_found" });
    } catch (error) { console.error("telemetry-control request failed", error); json(res, 500, { ok: false, error: "internal_error" }); }
  });
}

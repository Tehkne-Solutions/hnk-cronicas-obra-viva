import { MemoryTelemetryStore } from "@hnk/telemetry-control-core";
import { TelemetryAlertManager } from "./alerting.js";
import { createControlCenterServer } from "./app.js";
import { PostgresTelemetryStore } from "./postgres-store.js";

const PORT = Number(process.env.PORT ?? 8787);
const DATABASE_URL = process.env.DATABASE_URL;
const RELEASE = process.env.HNK_RELEASE ?? process.env.RENDER_SERVICE_NAME ?? "dev";
const BUILD_SHA = process.env.HNK_BUILD_SHA ?? process.env.RENDER_GIT_COMMIT ?? "unknown";
const store = DATABASE_URL
  ? new PostgresTelemetryStore(DATABASE_URL, process.env.HNK_TELEMETRY_DB_SSL === "true")
  : new MemoryTelemetryStore();
const configuredLevel = process.env.HNK_TELEMETRY_ALERT_MIN_LEVEL;
const minLevel: "warn" | "error" | "fatal" = configuredLevel === "error" || configuredLevel === "fatal" ? configuredLevel : "warn";
const alertWebhook = process.env.HNK_TELEMETRY_ALERT_WEBHOOK;
const alertManager = alertWebhook ? new TelemetryAlertManager({
  store,
  webhook: alertWebhook,
  release: RELEASE,
  buildSha: BUILD_SHA,
  minLevel,
  cooldownMs: Math.max(60_000, Number(process.env.HNK_TELEMETRY_ALERT_COOLDOWN_MS ?? 900_000)),
}) : undefined;

const server = createControlCenterServer({
  store,
  adminToken: process.env.HNK_TELEMETRY_ADMIN_TOKEN ?? "",
  allowedOrigins: new Set((process.env.HNK_TELEMETRY_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((item) => item.trim()).filter(Boolean)),
  retentionDays: Math.max(1, Number(process.env.HNK_TELEMETRY_RETENTION_DAYS ?? 30)),
  release: RELEASE,
  buildSha: BUILD_SHA,
  rateLimitPerMinute: Math.max(10, Number(process.env.HNK_TELEMETRY_RATE_LIMIT_PER_MINUTE ?? 300)),
  ...(alertManager ? { alertManager } : {}),
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HENUVOKODAN Telemetry Control Center listening on :${PORT} (${DATABASE_URL ? "postgres" : "memory"}, alerts=${alertWebhook ? "on" : "off"})`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)));

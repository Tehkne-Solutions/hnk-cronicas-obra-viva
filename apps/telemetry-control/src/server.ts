import { MemoryTelemetryStore } from "@hnk/telemetry-control-core";
import { createControlCenterServer } from "./app.js";
import { PostgresTelemetryStore } from "./postgres-store.js";

const PORT = Number(process.env.PORT ?? 8787);
const DATABASE_URL = process.env.DATABASE_URL;
const store = DATABASE_URL
  ? new PostgresTelemetryStore(DATABASE_URL, process.env.HNK_TELEMETRY_DB_SSL === "true")
  : new MemoryTelemetryStore();

const server = createControlCenterServer({
  store,
  adminToken: process.env.HNK_TELEMETRY_ADMIN_TOKEN ?? "",
  allowedOrigins: new Set((process.env.HNK_TELEMETRY_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((item) => item.trim()).filter(Boolean)),
  retentionDays: Math.max(1, Number(process.env.HNK_TELEMETRY_RETENTION_DAYS ?? 30)),
  release: process.env.HNK_RELEASE ?? "dev",
  buildSha: process.env.HNK_BUILD_SHA ?? "unknown",
  rateLimitPerMinute: Math.max(10, Number(process.env.HNK_TELEMETRY_RATE_LIMIT_PER_MINUTE ?? 300)),
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HENUVOKODAN Telemetry Control Center listening on :${PORT} (${DATABASE_URL ? "postgres" : "memory"})`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)));

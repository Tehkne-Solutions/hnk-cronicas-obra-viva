const baseUrl = (process.env.HNK_TELEMETRY_BASE_URL ?? "").replace(/\/$/, "");
const adminToken = process.env.HNK_TELEMETRY_ADMIN_TOKEN ?? "";

if (!baseUrl || !adminToken) {
  console.error("HNK_TELEMETRY_BASE_URL and HNK_TELEMETRY_ADMIN_TOKEN are required.");
  process.exit(2);
}

const sessionId = `smoke.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
const now = new Date().toISOString();
const events = Array.from({ length: 3 }, (_, index) => ({
  schemaVersion: 1,
  id: `${sessionId}.${index + 1}`,
  occurredAt: now,
  kind: "error",
  name: "runtime_error",
  level: "error",
  sessionId,
  data: {
    source: "production_smoke",
    synthetic: true,
    ordinal: index + 1,
  },
}));

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  return body;
}

const health = await request("/health");
if (!health?.ok) throw new Error("health endpoint did not report ok=true");
if (!health?.storage) throw new Error("health endpoint did not report storage mode");

const ingest = await request("/v1/telemetry", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: process.env.HNK_TELEMETRY_GAME_ORIGIN ?? "http://localhost:5173",
  },
  body: JSON.stringify({
    schemaVersion: 1,
    release: process.env.HNK_RELEASE ?? "production-smoke",
    buildSha: process.env.HNK_BUILD_SHA ?? process.env.GITHUB_SHA ?? "smoke",
    events,
  }),
});
if (ingest?.accepted !== 3) throw new Error(`expected accepted=3, received ${JSON.stringify(ingest)}`);

await new Promise((resolve) => setTimeout(resolve, 250));
const snapshot = await request("/api/snapshot?hours=1", {
  headers: { authorization: `Bearer ${adminToken}` },
});

const recent = Array.isArray(snapshot?.recentEvents) ? snapshot.recentEvents : [];
const observed = recent.filter((event) => event?.sessionId === sessionId);
if (observed.length !== 3) throw new Error(`expected 3 persisted smoke events, found ${observed.length}`);

const diagnostics = Array.isArray(snapshot?.diagnostics) ? snapshot.diagnostics : [];
const storm = diagnostics.find((finding) => finding?.code === "error_storm" && finding?.sessionId === sessionId);
if (!storm) throw new Error("server-side error_storm diagnostic was not produced for smoke session");

console.log(JSON.stringify({
  ok: true,
  storage: health.storage,
  release: health.release,
  buildSha: health.buildSha,
  accepted: ingest.accepted,
  smokeSessionId: sessionId,
  diagnostic: storm.code,
}, null, 2));

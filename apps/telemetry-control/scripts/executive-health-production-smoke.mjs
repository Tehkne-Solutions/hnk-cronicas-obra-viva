import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.HNK_TELEMETRY_BASE_URL ?? "").replace(/\/$/, "");
const adminToken = process.env.HNK_TELEMETRY_ADMIN_TOKEN ?? "";
if (!baseUrl || !adminToken) throw new Error("HNK_TELEMETRY_BASE_URL and HNK_TELEMETRY_ADMIN_TOKEN are required");

const allowedStatuses = new Set(["ready", "watch", "blocked", "recovery_required", "unknown"]);
let health = null;
let executive = null;
let lastError = "not_started";
for (let attempt = 1; attempt <= 30; attempt += 1) {
  try {
    const healthResponse = await fetch(`${baseUrl}/health`, { cache: "no-store" });
    if (!healthResponse.ok) throw new Error(`health_http_${healthResponse.status}`);
    health = await healthResponse.json();
    const response = await fetch(`${baseUrl}/api/executive-health`, {
      headers: { authorization: `Bearer ${adminToken}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`executive_http_${response.status}`);
    executive = await response.json();
    break;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    if (attempt === 30) throw new Error(`executive health endpoint unavailable after retries: ${lastError}`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

if (!executive || executive.schemaVersion !== 1) throw new Error("invalid executive health schema");
if (executive.signature !== "Tehkné Solutions") throw new Error("invalid executive health signature");
if (!allowedStatuses.has(executive.status)) throw new Error(`invalid executive status ${executive.status}`);
if (typeof executive.ready !== "boolean") throw new Error("ready must be boolean");
if (executive.ready !== (executive.status === "ready")) throw new Error("ready/status mismatch");
if (!Number.isFinite(executive.score) || executive.score < 0 || executive.score > 100) throw new Error(`invalid health score ${executive.score}`);
if (!Array.isArray(executive.blockers) || !Array.isArray(executive.warnings)) throw new Error("blockers/warnings contract invalid");
if (!executive.quality || !executive.recovery || !executive.incidents || !executive.release || !executive.telemetry) throw new Error("executive dimensions missing");
if (executive.status === "ready") {
  if (executive.blockers.length || executive.warnings.length) throw new Error("READY cannot contain blockers or warnings");
  if (executive.quality.status !== "pass") throw new Error("READY requires Quality PASS");
  if (executive.recovery.blocked !== false) throw new Error("READY cannot have Recovery blocked");
  if (executive.release.health !== "healthy" || executive.release.sentinelStatus !== "pass") throw new Error("READY requires healthy release and sentinel pass");
  if (!executive.quality.candidateSha || executive.quality.candidateSha !== executive.release.candidateSha) throw new Error("READY requires Quality/Release SHA coherence");
}
if ((executive.status === "blocked" || executive.status === "recovery_required") && executive.ready) throw new Error("blocked state cannot be ready");

const htmlResponse = await fetch(`${baseUrl}/executive`, { headers: { authorization: `Bearer ${adminToken}` }, cache: "no-store" });
if (!htmlResponse.ok) throw new Error(`executive dashboard HTTP ${htmlResponse.status}`);
const html = await htmlResponse.text();
if (!html.includes("Executive Health & Readiness")) throw new Error("executive dashboard marker missing");

const report = {
  schemaVersion: 1,
  ok: true,
  checkedAt: new Date().toISOString(),
  controlCenter: { release: health?.release ?? null, buildSha: health?.buildSha ?? null, storage: health?.storage ?? null },
  executive,
  dashboard: { ok: true },
  signature: "Tehkné Solutions",
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/executive-health-production-smoke.json", `${JSON.stringify(report, null, 2)}\n`);
const md = [
  "# HENUVOKODAN Executive Health Production Smoke",
  "",
  `- Contract: **PASS**`,
  `- Operational status: **${String(executive.status).toUpperCase()}**`,
  `- Ready: **${executive.ready ? "YES" : "NO"}**`,
  `- Health score: **${executive.score}**`,
  `- Quality: **${executive.quality.status}**`,
  `- Recovery: **${executive.recovery.decision}**`,
  `- Active incidents: **${executive.incidents.active}**`,
  `- Release: **${executive.release.health}**`,
  `- Control Center SHA: \`${health?.buildSha ?? "unknown"}\``,
  "",
  "Tehkné Solutions",
].join("\n");
await writeFile("artifacts/executive-health-production-smoke.md", `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });
console.log(`executive health production smoke: contract PASS; status=${executive.status}; ready=${executive.ready}; score=${executive.score}`);

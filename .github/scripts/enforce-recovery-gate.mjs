import fs from "node:fs/promises";

const baseUrl = (process.env.HNK_TELEMETRY_BASE_URL ?? "").replace(/\/$/, "");
const adminToken = process.env.HNK_TELEMETRY_ADMIN_TOKEN ?? "";
const candidateId = process.env.HNK_CANDIDATE_ID ?? "unknown";
const authorizationId = process.env.HNK_AUTHORIZATION_ID ?? "unknown";

if (!baseUrl) throw new Error("HNK_TELEMETRY_BASE_URL is required for fail-closed recovery enforcement");
if (!adminToken) throw new Error("HNK_TELEMETRY_ADMIN_TOKEN is required for fail-closed recovery enforcement");

await fs.mkdir("artifacts/promotion-input", { recursive: true });
const endpoint = `${baseUrl}/api/recovery?hours=168`;
const checkedAt = new Date().toISOString();
let response;
try {
  response = await fetch(endpoint, { headers: { authorization: `Bearer ${adminToken}`, accept: "application/json" } });
} catch (error) {
  throw new Error(`recovery gate unavailable: ${error instanceof Error ? error.message : String(error)}`);
}

const raw = await response.text();
if (!response.ok) throw new Error(`recovery gate returned HTTP ${response.status}: ${raw.slice(0, 500)}`);

let gate;
try { gate = JSON.parse(raw); } catch { throw new Error("recovery gate returned invalid JSON"); }
if (gate?.schemaVersion !== 1 || typeof gate?.blocked !== "boolean" || typeof gate?.decision !== "string") {
  throw new Error("recovery gate response contract is invalid");
}

const report = Object.freeze({
  schemaVersion: 1,
  checkedAt,
  candidateId,
  authorizationId,
  telemetryBaseUrl: baseUrl,
  decision: gate.decision,
  blocked: gate.blocked,
  activeIncidents: Number(gate.activeIncidents ?? 0),
  recommendations: Array.isArray(gate.recommendations) ? gate.recommendations : [],
  signature: "Tehkné Solutions",
});

await fs.writeFile("artifacts/promotion-input/recovery-gate.json", `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile("artifacts/promotion-input/recovery-gate.md", `# Promotion Recovery Enforcement\n\n- checkedAt: ${checkedAt}\n- candidateId: ${candidateId}\n- authorizationId: ${authorizationId}\n- decision: **${report.decision}**\n- blocked: **${report.blocked}**\n- activeIncidents: ${report.activeIncidents}\n- signature: Tehkné Solutions\n`);

console.log(`recovery gate: decision=${report.decision} blocked=${report.blocked} activeIncidents=${report.activeIncidents}`);
if (report.blocked) {
  const top = report.recommendations[0];
  throw new Error(`promotion blocked by recovery intelligence${top?.fingerprint ? `: ${top.fingerprint}` : ""}${top?.reason ? ` — ${top.reason}` : ""}`);
}

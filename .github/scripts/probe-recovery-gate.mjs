import fs from "node:fs/promises";

const baseUrl = (process.env.HNK_TELEMETRY_BASE_URL ?? "").replace(/\/$/, "");
const adminToken = process.env.HNK_TELEMETRY_ADMIN_TOKEN ?? "";
const candidateId = process.env.HNK_CANDIDATE_ID ?? "recovery-gate-probe";
const authorizationId = process.env.HNK_AUTHORIZATION_ID ?? "recovery-gate-probe";

if (!baseUrl) throw new Error("HNK_TELEMETRY_BASE_URL is required for recovery gate probe");
if (!adminToken) throw new Error("HNK_TELEMETRY_ADMIN_TOKEN is required for recovery gate probe");

await fs.mkdir("artifacts/promotion-input", { recursive: true });
const checkedAt = new Date().toISOString();
const response = await fetch(`${baseUrl}/api/recovery?hours=168`, {
  headers: { authorization: `Bearer ${adminToken}`, accept: "application/json" },
});
const raw = await response.text();
if (!response.ok) throw new Error(`recovery gate probe returned HTTP ${response.status}: ${raw.slice(0, 500)}`);

let gate;
try { gate = JSON.parse(raw); } catch { throw new Error("recovery gate probe returned invalid JSON"); }
if (gate?.schemaVersion !== 1 || typeof gate?.blocked !== "boolean" || typeof gate?.decision !== "string") {
  throw new Error("recovery gate probe response contract is invalid");
}
if (gate.signature !== "Tehkné Solutions") throw new Error("recovery gate probe signature invalid");

const report = Object.freeze({
  schemaVersion: 1,
  checkedAt,
  candidateId,
  authorizationId,
  telemetryBaseUrl: baseUrl,
  decision: gate.decision,
  blocked: gate.blocked,
  activeIncidents: Number(gate.activeIncidents ?? 0),
  ignoredSyntheticEvents: Number(gate.ignoredSyntheticEvents ?? 0),
  recommendations: Array.isArray(gate.recommendations) ? gate.recommendations : [],
  signature: "Tehkné Solutions",
});

await fs.writeFile("artifacts/promotion-input/recovery-gate.json", `${JSON.stringify(report, null, 2)}\n`);
const md = [
  "# Recovery Gate Production Probe",
  "",
  `- checkedAt: ${checkedAt}`,
  `- decision: **${report.decision}**`,
  `- blocked: **${report.blocked}**`,
  `- activeIncidents: ${report.activeIncidents}`,
  `- ignoredSyntheticEvents: ${report.ignoredSyntheticEvents}`,
  report.recommendations[0]?.fingerprint ? `- topIncident: \`${report.recommendations[0].fingerprint}\`` : "- topIncident: —",
  "",
  "Tehkné Solutions",
].join("\n");
await fs.writeFile("artifacts/promotion-input/recovery-gate.md", `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await fs.writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });

console.log(`recovery gate probe: decision=${report.decision} blocked=${report.blocked} activeIncidents=${report.activeIncidents}`);

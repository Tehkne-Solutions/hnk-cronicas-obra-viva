import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const candidatePath = resolve(root, process.env.HNK_RELEASE_CANDIDATE_PATH ?? "artifacts/authorization-input/release-candidate.json");
const gatePath = resolve(root, process.env.HNK_RELEASE_GATE_REPORT_PATH ?? "artifacts/authorization-input/release-gate-report.json");
const qualityPath = resolve(root, process.env.HNK_QUALITY_REPORT_PATH ?? "artifacts/authorization-input/ci-quality-report.json");
const smokePath = resolve(root, process.env.HNK_SMOKE_REPORT_PATH ?? "artifacts/authorization-input/release-smoke.json");
const outDir = resolve(root, "artifacts");
const requestedCandidateId = process.env.HNK_CANDIDATE_ID ?? "";
const currentMainSha = process.env.HNK_CURRENT_MAIN_SHA ?? "";
const actor = process.env.GITHUB_ACTOR ?? "unknown";
const reason = (process.env.HNK_AUTHORIZATION_REASON ?? "").trim();
const environment = (process.env.HNK_DEPLOYMENT_ENVIRONMENT ?? "production").toLowerCase() === "preview" ? "preview" : "production";
const baseUrl = (process.env.HNK_TELEMETRY_BASE_URL ?? "").replace(/\/$/, "");
const adminToken = process.env.HNK_TELEMETRY_ADMIN_TOKEN ?? "";

async function parseJson(path) { return JSON.parse(await readFile(path, "utf8")); }
function fingerprint(parts) { const hash = createHash("sha256"); for (const part of parts) hash.update(JSON.stringify(part)); return `sha256:${hash.digest("hex")}`; }
async function jsonFetch(path, options = {}) { const response = await fetch(`${baseUrl}${path}`, options); const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; } if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${String(text).slice(0, 300)}`); return body; }

const failures = [];
if (!requestedCandidateId) failures.push("candidate_id_required");
if (!reason) failures.push("authorization_reason_required");
if (!currentMainSha) failures.push("current_main_sha_required");

let candidate = null, gate = null, quality = null, smoke = null;
try { candidate = await parseJson(candidatePath); } catch (error) { failures.push(`candidate_unavailable:${error instanceof Error ? error.message : String(error)}`); }
try { gate = await parseJson(gatePath); } catch (error) { failures.push(`gate_report_unavailable:${error instanceof Error ? error.message : String(error)}`); }
try { quality = await parseJson(qualityPath); } catch (error) { failures.push(`quality_report_unavailable:${error instanceof Error ? error.message : String(error)}`); }
try { smoke = await parseJson(smokePath); } catch (error) { failures.push(`smoke_report_unavailable:${error instanceof Error ? error.message : String(error)}`); }

const now = new Date();
if (candidate) {
  const candidateMode = candidate.gateMode ?? candidate.environment ?? "production";
  if (candidateMode !== environment) failures.push(`candidate_environment_mismatch:${candidateMode}:${environment}`);
  if (candidate.candidateId !== requestedCandidateId) failures.push(`candidate_id_mismatch:${candidate.candidateId}`);
  if (candidate.immutable !== true) failures.push("candidate_not_immutable");
  if (candidate.signature !== "Tehkné Solutions") failures.push("candidate_signature_invalid");
  if (candidate.candidateSha !== currentMainSha) failures.push(`candidate_superseded:${candidate.candidateSha}:${currentMainSha}`);
  if (!candidate.expiresAt || Date.parse(candidate.expiresAt) <= now.getTime()) failures.push(`candidate_expired:${candidate.expiresAt ?? "missing"}`);
  if (candidate.evidence?.regressionBudget !== "pass") failures.push(`candidate_budget_not_pass:${candidate.evidence?.regressionBudget ?? "missing"}`);
  if (candidate.evidence?.qualityReportSha !== candidate.candidateSha) failures.push("candidate_quality_sha_mismatch");
  if (!candidate.evidence?.productionSmokeSessionId) failures.push("candidate_smoke_session_missing");
  if (environment === "production" && (candidate.evidence?.controlCenterStorage === "memory" || !candidate.evidence?.controlCenterStorage)) failures.push(`candidate_storage_invalid:${candidate.evidence?.controlCenterStorage ?? "missing"}`);
  if (environment === "preview" && !candidate.evidence?.controlCenterStorage) failures.push("candidate_storage_missing");
  if ((candidate.evidence?.criticalDiagnostics ?? 0) !== 0) failures.push(`candidate_has_critical_diagnostics:${candidate.evidence?.criticalDiagnostics}`);
  if ((candidate.evidence?.recentProductionFatals ?? 0) !== 0) failures.push(`candidate_has_production_fatals:${candidate.evidence?.recentProductionFatals}`);
}
if (gate) {
  if ((gate.gateMode ?? "production") !== environment) failures.push(`gate_environment_mismatch:${gate.gateMode ?? "production"}:${environment}`);
  if (gate.decision !== "eligible" || gate.eligible !== true) failures.push(`release_gate_not_eligible:${gate.decision ?? "missing"}`);
  if (candidate && gate.candidateSha !== candidate.candidateSha) failures.push("gate_candidate_sha_mismatch");
  if ((gate.reasons?.length ?? 0) > 0) failures.push("release_gate_has_blocking_reasons");
}
if (quality) {
  if (candidate && quality.sha !== candidate.candidateSha) failures.push("quality_candidate_sha_mismatch");
  if (quality.result !== "pass") failures.push(`quality_not_pass:${quality.result ?? "missing"}`);
  if (quality.regressionBudget?.status !== "pass") failures.push(`quality_budget_not_pass:${quality.regressionBudget?.status ?? "missing"}`);
}
if (smoke?.ok !== true) failures.push("production_smoke_not_pass");

let health = null, snapshot = null;
if (!baseUrl || !adminToken) failures.push("control_center_not_configured");
else {
  try {
    health = await jsonFetch("/health");
    if (health?.ok !== true) failures.push("control_center_health_not_ok");
    if (environment === "production" && health?.storage === "memory") failures.push("control_center_not_persistent");
    snapshot = await jsonFetch("/api/snapshot?hours=6", { headers: { authorization: `Bearer ${adminToken}` } });
  } catch (error) { failures.push(`control_center_unreachable:${error instanceof Error ? error.message : String(error)}`); }
}
const ignoredSession = (sessionId) => typeof sessionId === "string" && (sessionId.startsWith("smoke.") || sessionId.startsWith("ci.") || sessionId.startsWith("release."));
const critical = Array.isArray(snapshot?.diagnostics) ? snapshot.diagnostics.filter((finding) => (finding?.level === "fatal" || finding?.level === "error") && !ignoredSession(finding?.sessionId)) : [];
if (critical.length) failures.push(`fresh_critical_diagnostics:${critical.map((item) => item.code).join(",")}`);
const freshFatals = Array.isArray(snapshot?.recentEvents) ? snapshot.recentEvents.filter((event) => event?.level === "fatal" && !ignoredSession(event?.sessionId)) : [];
if (freshFatals.length) failures.push(`fresh_production_fatals:${freshFatals.length}`);

await mkdir(outDir, { recursive: true });
const evidenceFingerprint = candidate && gate && quality && smoke ? fingerprint([candidate, gate, quality, smoke]) : null;
const authorized = failures.length === 0;
const authorization = {
  schemaVersion: 1,
  authorizationId: `${environment === "preview" ? "preview-deploy-auth" : "deploy-auth"}.${candidate?.candidateSha?.slice(0, 12) ?? "unknown"}.${now.getTime()}`,
  authorized,
  decision: authorized ? "authorized" : "rejected",
  candidateId: candidate?.candidateId ?? (requestedCandidateId || null),
  candidateSha: candidate?.candidateSha ?? null,
  currentMainSha: currentMainSha || null,
  environment,
  authorizedBy: actor,
  authorizedAt: now.toISOString(),
  reason,
  evidenceFingerprint,
  evidence: { releaseGate: gate?.decision ?? "unknown", quality: quality?.result ?? "unknown", regressionBudget: quality?.regressionBudget?.status ?? "unknown", productionSmoke: smoke?.ok === true ? "pass" : "unknown", controlCenter: health?.ok === true ? "healthy" : "unknown", storage: health?.storage ?? "unknown", freshCriticalDiagnostics: critical.length, freshProductionFatals: freshFatals.length },
  failures,
  signature: "Tehkné Solutions",
};
await writeFile(resolve(outDir, "deployment-authorization.json"), `${JSON.stringify(authorization, null, 2)}\n`);
const md = ["# HENUVOKODAN Deployment Authorization Contract", "", `- Decision: **${authorization.decision.toUpperCase()}**`, `- Candidate: **${authorization.candidateId ?? "—"}**`, `- SHA: \`${authorization.candidateSha ?? "—"}\``, `- Environment: **${environment}**`, `- Authorized by: **${actor}**`, `- Reason: ${reason || "—"}`, `- Evidence fingerprint: \`${evidenceFingerprint ?? "—"}\``, "", failures.length ? `## Rejection reasons\n${failures.map((item) => `- ${item}`).join("\n")}` : "## Rejection reasons\n- none", "", "Tehkné Solutions"].join("\n");
await writeFile(resolve(outDir, "deployment-authorization.md"), `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });

if (baseUrl) {
  const event = { schemaVersion: 1, id: `deployment-authorization.${authorization.authorizationId}`, occurredAt: authorization.authorizedAt, kind: authorized ? "health" : "anomaly", name: authorized ? "deployment_authorized" : "deployment_authorization_rejected", level: authorized ? "info" : "error", sessionId: `deploy.${(candidate?.candidateSha ?? currentMainSha).slice(0, 12)}`, data: { authorizationId: authorization.authorizationId, candidateId: authorization.candidateId, candidateSha: authorization.candidateSha, environment, authorizedBy: actor, reason, evidenceFingerprint, failures } };
  try { await fetch(`${baseUrl}/v1/telemetry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ release: "deployment-authorization-contract", buildSha: candidate?.candidateSha ?? currentMainSha, events: [event] }) }); } catch (error) { console.warn("deployment authorization telemetry publish failed", error instanceof Error ? error.message : error); }
}
if (!authorized) process.exit(1);

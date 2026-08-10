import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const inputDir = resolve(root, "artifacts/recovery-execution-input");
const authorization = JSON.parse(await readFile(resolve(inputDir, "recovery-authorization.json"), "utf8"));
const healthyPromotion = JSON.parse(await readFile(resolve(inputDir, "healthy-promotion-report.json"), "utf8"));
const recoveryGate = JSON.parse(await readFile(resolve(inputDir, "recovery-gate.json"), "utf8"));
const requestedAuthorizationId = process.env.HNK_RECOVERY_AUTHORIZATION_ID ?? "";
const requestedTargetSha = process.env.HNK_RECOVERY_TARGET_SHA ?? "";
const renderDeployHookUrl = (process.env.HNK_RENDER_DEPLOY_HOOK_URL ?? "").trim();
const productionUrl = (process.env.HNK_GAME_PRODUCTION_URL ?? "").replace(/\/$/, "");
const telemetryBaseUrl = (process.env.HNK_TELEMETRY_BASE_URL ?? "").replace(/\/$/, "");
const failures = [];

if (authorization.authorizationId !== requestedAuthorizationId) failures.push("recovery_authorization_id_mismatch");
if (authorization.authorized !== true || authorization.decision !== "authorized") failures.push("recovery_not_authorized");
if (authorization.targetSha !== requestedTargetSha) failures.push("recovery_target_sha_mismatch");
if (!authorization.incidentFingerprint) failures.push("recovery_incident_fingerprint_missing");
if (healthyPromotion.status !== "completed" || healthyPromotion.candidateSha !== requestedTargetSha || healthyPromotion.verifiedManifest?.buildSha !== requestedTargetSha) failures.push("target_not_proven_healthy");
if (healthyPromotion.signature !== "Tehkné Solutions" || authorization.signature !== "Tehkné Solutions") failures.push("recovery_evidence_signature_invalid");
if (recoveryGate.blocked !== true || recoveryGate.decision !== "rollback_recommended") failures.push(`recovery_gate_no_longer_requires_rollback:${recoveryGate.decision ?? "unknown"}`);
if (!Array.isArray(recoveryGate.recommendations) || !recoveryGate.recommendations.some((item) => item?.fingerprint === authorization.incidentFingerprint)) failures.push("authorized_incident_not_currently_blocking");
if (!renderDeployHookUrl) failures.push("render_deploy_hook_not_configured");
if (!productionUrl) failures.push("production_url_not_configured");

let deployHookTarget = null;
let recoveryResponse = null;
let verifiedManifest = null;
if (!failures.length) {
  try {
    const deployUrl = new URL(renderDeployHookUrl);
    deployUrl.searchParams.set("ref", requestedTargetSha);
    deployHookTarget = `${deployUrl.origin}${deployUrl.pathname}?ref=${requestedTargetSha}`;
    const response = await fetch(deployUrl, { method: "POST" });
    const text = await response.text();
    try { recoveryResponse = JSON.parse(text); } catch { recoveryResponse = { raw: text }; }
    if (!response.ok) failures.push(`render_recovery_hook_failed:${response.status}`);
  } catch (error) {
    failures.push(`render_recovery_hook_failed:${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!failures.length) {
  const timeoutMs = Number(process.env.HNK_POST_DEPLOY_TIMEOUT_MS ?? 180000);
  const pollMs = Number(process.env.HNK_POST_DEPLOY_POLL_MS ?? 5000);
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  let lastError = "manifest_not_seen";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${productionUrl}/release.json?ts=${Date.now()}`, { cache: "no-store" });
      if (response.ok) {
        const manifest = await response.json();
        if (manifest?.buildSha === requestedTargetSha && manifest?.signature === "Tehkné Solutions") {
          verifiedManifest = manifest;
          break;
        }
        lastError = `release_manifest_sha_mismatch:${manifest?.buildSha ?? "missing"}`;
      } else lastError = `release_manifest_http_${response.status}`;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await new Promise((resolve) => setTimeout(resolve, Math.max(250, pollMs)));
  }
  if (!verifiedManifest) failures.push(`recovery_post_deploy_verification_failed:${lastError}`);
}

const now = new Date();
const status = failures.length ? "failed" : "recovered";
const report = {
  schemaVersion: 1,
  recoveryId: `recovery.${requestedTargetSha.slice(0, 12)}.${now.getTime()}`,
  provider: "render",
  status,
  authorizationId: authorization.authorizationId ?? null,
  incidentFingerprint: authorization.incidentFingerprint ?? null,
  targetSha: requestedTargetSha || null,
  recoveredAt: now.toISOString(),
  productionUrl: productionUrl || null,
  deployHookTarget,
  recoveryResponse,
  verifiedManifest,
  failures,
  signature: "Tehkné Solutions",
};
await mkdir(resolve(root, "artifacts"), { recursive: true });
await writeFile(resolve(root, "artifacts/recovery-report.json"), `${JSON.stringify(report, null, 2)}\n`);
const md = [
  "# HENUVOKODAN Recovery Executor",
  "",
  `- Status: **${status.toUpperCase()}**`,
  `- Target SHA: \`${requestedTargetSha || "—"}\``,
  `- Incident: \`${authorization.incidentFingerprint ?? "—"}\``,
  `- Authorization: **${authorization.authorizationId ?? "—"}**`,
  `- Verified manifest: ${verifiedManifest ? "yes" : "no"}`,
  `- Incident lifecycle closed: ${status === "recovered" ? "yes" : "no"}`,
  "",
  failures.length ? `## Failures\n${failures.map((x) => `- ${x}`).join("\n")}` : "## Failures\n- none",
  "",
  "Tehkné Solutions",
].join("\n");
await writeFile(resolve(root, "artifacts/recovery-report.md"), `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });

if (telemetryBaseUrl) {
  const events = [{
    schemaVersion: 1,
    id: `recovery-outcome.${report.recoveryId}`,
    occurredAt: report.recoveredAt,
    kind: status === "recovered" ? "health" : "anomaly",
    name: status === "recovered" ? "recovery_completed" : "recovery_failed",
    level: status === "recovered" ? "info" : "error",
    sessionId: `recovery.${requestedTargetSha.slice(0, 12)}`,
    buildSha: requestedTargetSha || null,
    data: { recoveryId: report.recoveryId, status, authorizationId: report.authorizationId, incidentFingerprint: report.incidentFingerprint, targetSha: report.targetSha, verifiedManifestSha: verifiedManifest?.buildSha ?? null, failures },
  }];
  if (status === "recovered" && authorization.incidentFingerprint) {
    events.push({
      schemaVersion: 1,
      id: `incident-resolved.${authorization.incidentFingerprint}.${now.getTime()}`,
      occurredAt: report.recoveredAt,
      kind: "health",
      name: "incident_resolved",
      level: "info",
      sessionId: `incident.${authorization.incidentFingerprint}`,
      buildSha: requestedTargetSha || null,
      data: {
        fingerprint: authorization.incidentFingerprint,
        recoveryId: report.recoveryId,
        recoveryAuthorizationId: report.authorizationId,
        resolvedBuildSha: requestedTargetSha,
        verifiedManifestSha: verifiedManifest?.buildSha ?? null,
        resolution: "verified_render_recovery",
      },
    });
  }
  try {
    const response = await fetch(`${telemetryBaseUrl}/v1/telemetry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ release: "recovery-executor", buildSha: requestedTargetSha || null, events }) });
    if (!response.ok) console.warn(`recovery telemetry publish returned ${response.status}`);
  } catch (error) { console.warn("recovery telemetry publish failed", error instanceof Error ? error.message : error); }
}
if (failures.length) process.exit(1);

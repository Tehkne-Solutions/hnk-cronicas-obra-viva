import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const inputDir = resolve(root, process.env.HNK_PROMOTION_INPUT_DIR ?? "artifacts/promotion-input");
const outDir = resolve(root, "artifacts");
const authorization = JSON.parse(await readFile(resolve(inputDir, "deployment-authorization.json"), "utf8"));
const candidate = JSON.parse(await readFile(resolve(inputDir, "release-candidate.json"), "utf8"));
const gate = JSON.parse(await readFile(resolve(inputDir, "release-gate-report.json"), "utf8"));
const quality = JSON.parse(await readFile(resolve(inputDir, "ci-quality-report.json"), "utf8"));
const smoke = JSON.parse(await readFile(resolve(inputDir, "release-smoke.json"), "utf8"));

const renderDeployHookUrl = (process.env.HNK_RENDER_DEPLOY_HOOK_URL ?? "").trim();
const productionUrl = (process.env.HNK_GAME_PRODUCTION_URL ?? "").replace(/\/$/, "");
const telemetryBaseUrl = (process.env.HNK_TELEMETRY_BASE_URL ?? "").replace(/\/$/, "");
const requestedAuthorizationId = process.env.HNK_AUTHORIZATION_ID ?? "";
const requestedCandidateId = process.env.HNK_CANDIDATE_ID ?? "";
const promotionHeadSha = (process.env.HNK_PROMOTION_HEAD_SHA ?? process.env.GITHUB_SHA ?? "").trim();
const currentMainSha = (process.env.HNK_CURRENT_MAIN_SHA ?? "").trim();
const now = new Date();
const failures = [];
const warnings = [];

function fingerprint(parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(JSON.stringify(part));
  return `sha256:${hash.digest("hex")}`;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

if (!requestedAuthorizationId) failures.push("authorization_id_required");
if (!requestedCandidateId) failures.push("candidate_id_required");
if (!renderDeployHookUrl) failures.push("render_deploy_hook_not_configured");
if (!productionUrl) failures.push("production_url_not_configured");
if (!/^[0-9a-f]{40}$/i.test(promotionHeadSha)) failures.push("promotion_head_sha_invalid");
if (!/^[0-9a-f]{40}$/i.test(currentMainSha)) failures.push("current_main_sha_invalid");
if (authorization.authorizationId !== requestedAuthorizationId) failures.push("authorization_id_mismatch");
if (authorization.decision !== "authorized" || authorization.authorized !== true) failures.push("authorization_not_authorized");
if (authorization.environment !== "production") failures.push(`authorization_environment_invalid:${authorization.environment ?? "missing"}`);
if (authorization.signature !== "Tehkné Solutions") failures.push("authorization_signature_invalid");
if (authorization.candidateId !== requestedCandidateId || candidate.candidateId !== requestedCandidateId) failures.push("candidate_id_mismatch");
if (authorization.candidateSha !== candidate.candidateSha) failures.push("authorization_candidate_sha_mismatch");
if (authorization.currentMainSha !== candidate.candidateSha) failures.push("authorization_main_sha_mismatch");
if (promotionHeadSha && promotionHeadSha !== candidate.candidateSha) failures.push(`promotion_snapshot_mismatch:${promotionHeadSha}:${candidate.candidateSha}`);
if (currentMainSha && currentMainSha !== candidate.candidateSha) failures.push(`candidate_superseded_since_authorization:${candidate.candidateSha}:${currentMainSha}`);
const provenance = authorization.provenance ?? {};
if (provenance.authorizationWorkflow !== "deployment-authorization") failures.push("authorization_provenance_workflow_invalid");
if (provenance.sourceRepository !== process.env.GITHUB_REPOSITORY) failures.push("authorization_provenance_repository_mismatch");
if (provenance.sourceRef !== "refs/heads/main") failures.push(`authorization_provenance_ref_invalid:${provenance.sourceRef ?? "missing"}`);
if (provenance.sourceHeadSha !== candidate.candidateSha) failures.push("authorization_provenance_head_sha_mismatch");
if (!/^\d+$/.test(String(provenance.sourceWorkflowRunId ?? ""))) failures.push("authorization_provenance_run_id_invalid");
if (authorization.evidence?.activeRecoveryIncidents !== 0) failures.push(`authorization_has_active_recovery_incidents:${authorization.evidence?.activeRecoveryIncidents ?? "missing"}`);
if (candidate.expiresAt && Date.parse(candidate.expiresAt) <= now.getTime()) failures.push("candidate_expired");
if (candidate.immutable !== true || candidate.signature !== "Tehkné Solutions") failures.push("candidate_integrity_invalid");
if (gate?.signals?.recoveryBlocked !== false) failures.push(`release_gate_recovery_state_invalid:${String(gate?.signals?.recoveryBlocked)}`);

const expectedFingerprint = fingerprint([candidate, gate, quality, smoke]);
if (authorization.evidenceFingerprint !== expectedFingerprint) failures.push("authorization_evidence_fingerprint_mismatch");

let promotionResponse = null;
let verifiedManifest = null;
let deployHookTarget = null;
let renderDeployHttpStatus = null;
let renderDeployId = null;
let renderDeployQueued = false;
let verificationAttempts = 0;
let observedManifestSha = null;
let verificationTimeoutMs = null;

if (failures.length === 0) {
  try {
    const deployUrl = new URL(renderDeployHookUrl);
    deployUrl.searchParams.set("ref", candidate.candidateSha);
    deployHookTarget = `${deployUrl.origin}${deployUrl.pathname}?ref=${candidate.candidateSha}`;
    const response = await fetch(deployUrl, { method: "POST" });
    renderDeployHttpStatus = response.status;
    renderDeployQueued = response.status === 202;
    const text = await response.text();
    try { promotionResponse = JSON.parse(text); } catch { promotionResponse = { raw: text }; }
    renderDeployId = promotionResponse?.id ?? promotionResponse?.deploy?.id ?? promotionResponse?.deployId ?? null;
    if (!response.ok) failures.push(`render_deploy_hook_failed:${response.status}`);
    if (response.status === 200 && !renderDeployId) warnings.push("render_deploy_id_missing_on_200");
    if (response.status === 202) warnings.push("render_deploy_queued");
  } catch (error) {
    failures.push(`render_deploy_hook_failed:${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length === 0) {
  const standardTimeoutMs = positiveNumber(process.env.HNK_POST_DEPLOY_TIMEOUT_MS, 180000);
  const queuedTimeoutMs = positiveNumber(process.env.HNK_POST_DEPLOY_QUEUED_TIMEOUT_MS, 900000);
  const pollMs = positiveNumber(process.env.HNK_POST_DEPLOY_POLL_MS, 5000);
  verificationTimeoutMs = renderDeployQueued ? Math.max(standardTimeoutMs, queuedTimeoutMs) : standardTimeoutMs;
  const deadline = Date.now() + Math.max(1000, verificationTimeoutMs);
  let lastError = "manifest_not_seen";
  while (Date.now() < deadline) {
    verificationAttempts += 1;
    try {
      const response = await fetch(`${productionUrl}/release.json?ts=${Date.now()}`, { cache: "no-store" });
      if (response.ok) {
        const manifest = await response.json();
        observedManifestSha = manifest?.buildSha ?? null;
        if (manifest?.buildSha === candidate.candidateSha && manifest?.signature === "Tehkné Solutions") {
          verifiedManifest = manifest;
          break;
        }
        lastError = `release_manifest_sha_mismatch:${manifest?.buildSha ?? "missing"}`;
      } else {
        lastError = `release_manifest_http_${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.max(250, pollMs)));
  }
  if (!verifiedManifest) failures.push(`post_deploy_verification_failed:${lastError}`);
}

const status = failures.length === 0 ? "completed" : "rollback_required";
const verificationClassification = verifiedManifest
  ? "verified"
  : failures.some((item) => item.startsWith("post_deploy_verification_failed:"))
    ? "unverified_after_timeout"
    : "not_verified";
const report = {
  schemaVersion: 1,
  promotionId: `promotion.${candidate.candidateSha?.slice(0, 12) ?? "unknown"}.${now.getTime()}`,
  provider: "render",
  authorizationId: authorization.authorizationId ?? null,
  candidateId: candidate.candidateId ?? null,
  candidateSha: candidate.candidateSha ?? null,
  authorizedSourceRunId: provenance.sourceWorkflowRunId ?? null,
  authorizedSourceHeadSha: provenance.sourceHeadSha ?? null,
  promotionHeadSha: promotionHeadSha || null,
  currentMainSha: currentMainSha || null,
  evidenceFingerprint: expectedFingerprint,
  status,
  verificationClassification,
  rollbackAction: "not_executed",
  promotedAt: now.toISOString(),
  productionUrl: productionUrl || null,
  deployHookTarget,
  renderDeployHttpStatus,
  renderDeployId,
  renderDeployQueued,
  verificationTimeoutMs,
  verificationAttempts,
  observedManifestSha,
  promotionResponse,
  verifiedManifest,
  warnings,
  failures,
  signature: "Tehkné Solutions",
};

await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "promotion-report.json"), `${JSON.stringify(report, null, 2)}\n`);
const md = [
  "# HENUVOKODAN Promotion Executor",
  "",
  "- Provider: **Render**",
  `- Status: **${status.toUpperCase()}**`,
  `- Candidate: **${candidate.candidateId ?? "—"}**`,
  `- SHA: \`${candidate.candidateSha ?? "—"}\``,
  `- Authorization: **${authorization.authorizationId ?? "—"}**`,
  `- Authorization source run: **${provenance.sourceWorkflowRunId ?? "—"}**`,
  `- Authorization source SHA: \`${provenance.sourceHeadSha ?? "—"}\``,
  `- Promotion snapshot SHA: \`${promotionHeadSha || "—"}\``,
  `- Current main SHA: \`${currentMainSha || "—"}\``,
  `- Production: ${productionUrl || "—"}`,
  `- Render hook HTTP: ${renderDeployHttpStatus ?? "—"}`,
  `- Render deploy ID: ${renderDeployId ?? "—"}`,
  `- Render queued: ${renderDeployQueued ? "yes" : "no"}`,
  `- Verification: **${verificationClassification}**`,
  `- Observed manifest SHA: \`${observedManifestSha ?? "—"}\``,
  `- Verified manifest: ${verifiedManifest ? "yes" : "no"}`,
  `- Rollback action executed: **no**`,
  "",
  warnings.length ? `## Warnings\n${warnings.map((item) => `- ${item}`).join("\n")}` : "## Warnings\n- none",
  "",
  failures.length ? `## Failures\n${failures.map((item) => `- ${item}`).join("\n")}` : "## Failures\n- none",
  "",
  "Tehkné Solutions",
].join("\n");
await writeFile(resolve(outDir, "promotion-report.md"), `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });

if (telemetryBaseUrl) {
  const event = {
    schemaVersion: 1,
    id: `promotion-outcome.${report.promotionId}`,
    occurredAt: report.promotedAt,
    kind: status === "completed" ? "health" : "anomaly",
    name: status === "completed" ? "promotion_completed" : "promotion_rollback_required",
    level: status === "completed" ? "info" : "error",
    sessionId: `deploy.${String(candidate.candidateSha ?? "unknown").slice(0, 12)}`,
    data: {
      promotionId: report.promotionId,
      provider: report.provider,
      status,
      verificationClassification,
      rollbackAction: report.rollbackAction,
      authorizationId: report.authorizationId,
      candidateId: report.candidateId,
      candidateSha: report.candidateSha,
      authorizedSourceRunId: report.authorizedSourceRunId,
      authorizedSourceHeadSha: report.authorizedSourceHeadSha,
      promotionHeadSha: report.promotionHeadSha,
      currentMainSha: report.currentMainSha,
      productionUrl: report.productionUrl,
      renderDeployHttpStatus,
      renderDeployId,
      renderDeployQueued,
      verificationTimeoutMs,
      verificationAttempts,
      observedManifestSha,
      verifiedManifestSha: verifiedManifest?.buildSha ?? null,
      evidenceFingerprint: expectedFingerprint,
      warnings,
      failures,
    },
  };
  try {
    const response = await fetch(`${telemetryBaseUrl}/v1/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ release: "promotion-executor", buildSha: candidate.candidateSha ?? null, events: [event] }),
    });
    if (!response.ok) console.warn(`promotion telemetry publish returned ${response.status}`);
  } catch (error) {
    console.warn("promotion telemetry publish failed", error instanceof Error ? error.message : error);
  }
}

if (failures.length > 0) process.exit(1);

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
const now = new Date();
const failures = [];

function fingerprint(parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(JSON.stringify(part));
  return `sha256:${hash.digest("hex")}`;
}

if (!requestedAuthorizationId) failures.push("authorization_id_required");
if (!requestedCandidateId) failures.push("candidate_id_required");
if (!renderDeployHookUrl) failures.push("render_deploy_hook_not_configured");
if (!productionUrl) failures.push("production_url_not_configured");
if (authorization.authorizationId !== requestedAuthorizationId) failures.push("authorization_id_mismatch");
if (authorization.decision !== "authorized" || authorization.authorized !== true) failures.push("authorization_not_authorized");
if (authorization.candidateId !== requestedCandidateId || candidate.candidateId !== requestedCandidateId) failures.push("candidate_id_mismatch");
if (authorization.candidateSha !== candidate.candidateSha) failures.push("authorization_candidate_sha_mismatch");
if (candidate.expiresAt && Date.parse(candidate.expiresAt) <= now.getTime()) failures.push("candidate_expired");
if (candidate.immutable !== true || candidate.signature !== "Tehkné Solutions") failures.push("candidate_integrity_invalid");

const expectedFingerprint = fingerprint([candidate, gate, quality, smoke]);
if (authorization.evidenceFingerprint !== expectedFingerprint) failures.push("authorization_evidence_fingerprint_mismatch");

let promotionResponse = null;
let verifiedManifest = null;
let deployHookTarget = null;
if (failures.length === 0) {
  try {
    const deployUrl = new URL(renderDeployHookUrl);
    deployUrl.searchParams.set("ref", candidate.candidateSha);
    deployHookTarget = `${deployUrl.origin}${deployUrl.pathname}?ref=${candidate.candidateSha}`;
    const response = await fetch(deployUrl, { method: "POST" });
    const text = await response.text();
    try { promotionResponse = JSON.parse(text); } catch { promotionResponse = { raw: text }; }
    if (!response.ok) failures.push(`render_deploy_hook_failed:${response.status}`);
  } catch (error) {
    failures.push(`render_deploy_hook_failed:${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length === 0) {
  const timeoutMs = Number(process.env.HNK_POST_DEPLOY_TIMEOUT_MS ?? 180000);
  const pollMs = Number(process.env.HNK_POST_DEPLOY_POLL_MS ?? 5000);
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  let lastError = "manifest_not_seen";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${productionUrl}/release.json?ts=${Date.now()}`, { cache: "no-store" });
      if (response.ok) {
        const manifest = await response.json();
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
    await new Promise((resolve) => setTimeout(resolve, Math.max(250, pollMs)));
  }
  if (!verifiedManifest) failures.push(`post_deploy_verification_failed:${lastError}`);
}

const status = failures.length === 0 ? "completed" : "rollback_required";
const report = {
  schemaVersion: 1,
  promotionId: `promotion.${candidate.candidateSha?.slice(0, 12) ?? "unknown"}.${now.getTime()}`,
  provider: "render",
  authorizationId: authorization.authorizationId ?? null,
  candidateId: candidate.candidateId ?? null,
  candidateSha: candidate.candidateSha ?? null,
  evidenceFingerprint: expectedFingerprint,
  status,
  promotedAt: now.toISOString(),
  productionUrl: productionUrl || null,
  deployHookTarget,
  promotionResponse,
  verifiedManifest,
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
  `- Production: ${productionUrl || "—"}`,
  `- Verified manifest: ${verifiedManifest ? "yes" : "no"}`,
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
      authorizationId: report.authorizationId,
      candidateId: report.candidateId,
      candidateSha: report.candidateSha,
      productionUrl: report.productionUrl,
      verifiedManifestSha: verifiedManifest?.buildSha ?? null,
      evidenceFingerprint: expectedFingerprint,
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

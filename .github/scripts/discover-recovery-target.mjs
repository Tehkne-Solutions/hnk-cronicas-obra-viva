import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const outDir = resolve(root, "artifacts/recovery-target");
const gatePath = resolve(root, "artifacts/promotion-input/recovery-gate.json");
const repository = (process.env.GITHUB_REPOSITORY ?? "").trim();
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
const productionUrl = (process.env.HNK_GAME_PRODUCTION_URL ?? "").replace(/\/$/, "");
const apiBase = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");

if (!repository) throw new Error("GITHUB_REPOSITORY is required for recovery target discovery");
if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required for recovery target discovery");
if (!productionUrl) throw new Error("HNK_GAME_PRODUCTION_URL is required for recovery target discovery");

const headers = {
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "x-github-api-version": "2022-11-28",
  "user-agent": "Tehkne-Solutions-HENUVOKODAN-recovery-probe",
};

async function githubJson(path) {
  const response = await fetch(`${apiBase}${path}`, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub API ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`GitHub API ${path} returned invalid JSON`); }
}

async function download(url, path) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub artifact download -> ${response.status}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function unzip(zipPath, destination) {
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn("unzip", ["-q", zipPath, "-d", destination], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (value) => resolveCode(value ?? 1));
  });
  if (code !== 0) throw new Error(`unzip failed with exit ${code}`);
}

async function findFile(dir, target) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name === target) return path;
    if (entry.isDirectory()) {
      const found = await findFile(path, target);
      if (found) return found;
    }
  }
  return null;
}

await mkdir(outDir, { recursive: true });
const checkedAt = new Date().toISOString();
let liveGate = null;
try { liveGate = JSON.parse(await readFile(gatePath, "utf8")); } catch {}

let currentManifest = null;
let currentManifestError = null;
try {
  const response = await fetch(`${productionUrl}/release.json?ts=${Date.now()}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  currentManifest = JSON.parse(text);
  if (currentManifest?.signature !== "Tehkné Solutions") throw new Error("release manifest signature invalid");
} catch (error) {
  currentManifestError = error instanceof Error ? error.message : String(error);
}

const runsPayload = await githubJson(`/repos/${repository}/actions/workflows/promotion-executor.yml/runs?status=success&per_page=50`);
const runs = Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [];
let healthy = null;
let healthyRunId = null;
let healthyArtifactId = null;
const temp = await mkdtemp(join(tmpdir(), "hnk-recovery-target-"));
try {
  for (const run of runs) {
    const runId = Number(run?.id);
    if (!Number.isFinite(runId)) continue;
    const artifactsPayload = await githubJson(`/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`);
    const artifact = Array.isArray(artifactsPayload?.artifacts)
      ? artifactsPayload.artifacts.find((item) => item?.expired === false && typeof item?.name === "string" && item.name.startsWith("promotion-"))
      : null;
    if (!artifact?.id || !artifact?.archive_download_url) continue;

    const runDir = join(temp, String(runId));
    await mkdir(runDir, { recursive: true });
    const zipPath = join(runDir, "artifact.zip");
    try {
      await download(artifact.archive_download_url, zipPath);
      await unzip(zipPath, runDir);
      const reportPath = await findFile(runDir, "promotion-report.json");
      if (!reportPath) continue;
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      const sha = report?.candidateSha;
      const verifiedSha = report?.verifiedManifest?.buildSha;
      const proven =
        report?.status === "completed" &&
        report?.provider === "render" &&
        typeof sha === "string" && sha.length === 40 &&
        verifiedSha === sha &&
        report?.verifiedManifest?.signature === "Tehkné Solutions" &&
        report?.signature === "Tehkné Solutions";
      if (!proven) continue;
      healthy = report;
      healthyRunId = runId;
      healthyArtifactId = Number(artifact.id);
      await writeFile(resolve(outDir, "healthy-promotion-report.json"), `${JSON.stringify(report, null, 2)}\n`);
      break;
    } catch (error) {
      console.warn(`recovery target probe skipped run ${runId}:`, error instanceof Error ? error.message : error);
    }
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

const currentProductionSha = typeof currentManifest?.buildSha === "string" ? currentManifest.buildSha : null;
const lastProvenHealthySha = typeof healthy?.candidateSha === "string" ? healthy.candidateSha : null;
const blocked = liveGate?.blocked === true;
let recoveryDisposition = "unknown";
if (!blocked) recoveryDisposition = "not_blocked";
else if (!lastProvenHealthySha) recoveryDisposition = "no_proven_healthy_target";
else if (currentProductionSha === lastProvenHealthySha) recoveryDisposition = "reassert_verified_healthy_target";
else recoveryDisposition = "rollback_to_verified_healthy_target";

const report = Object.freeze({
  schemaVersion: 1,
  checkedAt,
  productionUrl,
  currentProduction: currentManifest ? {
    buildSha: currentProductionSha,
    buildShaSource: currentManifest.buildShaSource ?? null,
    release: currentManifest.release ?? null,
    builtAt: currentManifest.builtAt ?? null,
    signature: currentManifest.signature ?? null,
  } : null,
  currentManifestError,
  recoveryGate: liveGate ? {
    decision: liveGate.decision ?? null,
    blocked,
    activeIncidents: Number(liveGate.activeIncidents ?? 0),
    topIncidentFingerprint: liveGate.recommendations?.[0]?.fingerprint ?? null,
    topIncidentCandidateSha: liveGate.recommendations?.[0]?.candidateSha ?? null,
  } : null,
  lastProvenHealthy: healthy ? {
    sha: lastProvenHealthySha,
    candidateId: healthy.candidateId ?? null,
    promotionId: healthy.promotionId ?? null,
    promotedAt: healthy.promotedAt ?? null,
    verifiedManifest: healthy.verifiedManifest ?? null,
    sourceRunId: healthyRunId,
    sourceArtifactId: healthyArtifactId,
  } : null,
  recoveryDisposition,
  signature: "Tehkné Solutions",
});

await writeFile(resolve(outDir, "recovery-target-discovery.json"), `${JSON.stringify(report, null, 2)}\n`);
const md = [
  "# HENUVOKODAN Recovery Target Discovery",
  "",
  `- Checked at: ${checkedAt}`,
  `- Recovery gate: **${report.recoveryGate?.decision ?? "unknown"}**`,
  `- Blocking incident: ${report.recoveryGate?.topIncidentFingerprint ? `\`${report.recoveryGate.topIncidentFingerprint}\`` : "—"}`,
  `- Current production SHA: ${currentProductionSha ? `\`${currentProductionSha}\`` : "—"}`,
  `- Current SHA source: **${report.currentProduction?.buildShaSource ?? "unknown"}**`,
  `- Last proven healthy SHA: ${lastProvenHealthySha ? `\`${lastProvenHealthySha}\`` : "—"}`,
  `- Healthy evidence run: ${healthyRunId ?? "—"}`,
  `- Disposition: **${recoveryDisposition}**`,
  "",
  currentManifestError ? `## Production manifest probe warning\n- ${currentManifestError}\n` : "",
  "Tehkné Solutions",
].filter(Boolean).join("\n");
await writeFile(resolve(outDir, "recovery-target-discovery.md"), `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });

console.log(`recovery target discovery: disposition=${recoveryDisposition} current=${currentProductionSha ?? "unknown"} healthy=${lastProvenHealthySha ?? "none"}`);

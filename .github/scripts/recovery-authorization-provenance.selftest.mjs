import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repo = process.cwd();
const script = resolve(repo, ".github/scripts/authorize-recovery.mjs");
const targetSha = "a".repeat(40);
const incidentFingerprint = "b".repeat(20);
const sourceHeadSha = "c".repeat(40);
const baseEnv = {
  HNK_RECOVERY_TARGET_SHA: targetSha,
  HNK_RECOVERY_INCIDENT_FINGERPRINT: incidentFingerprint,
  HNK_RECOVERY_REASON: "recovery provenance self-test",
  HNK_RECOVERY_CONFIRMATION: "AUTHORIZE_ROLLBACK",
  GITHUB_RUN_ID: "123456789",
  GITHUB_REPOSITORY: "Tehkne-Solutions/hnk-cronicas-obra-viva",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: sourceHeadSha,
  GITHUB_ACTOR: "selftest",
};

async function runScenario(name, envOverrides, expectSuccess, expectedFailure = null) {
  const dir = await mkdtemp(join(tmpdir(), `hnk-recovery-provenance-${name}-`));
  try {
    await mkdir(resolve(dir, "artifacts/recovery-input"), { recursive: true });
    const promotion = {
      schemaVersion: 1,
      status: "completed",
      provider: "render",
      candidateSha: targetSha,
      promotionId: "promotion.selftest",
      evidenceFingerprint: "sha256:selftest",
      verifiedManifest: { buildSha: targetSha, signature: "Tehkné Solutions" },
      signature: "Tehkné Solutions",
    };
    await writeFile(resolve(dir, "artifacts/recovery-input/healthy-promotion-report.json"), `${JSON.stringify(promotion, null, 2)}\n`);
    const result = await new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd: dir,
        env: { ...process.env, ...baseEnv, ...envOverrides },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
    });
    const report = JSON.parse(await readFile(resolve(dir, "artifacts/recovery-authorization/recovery-authorization.json"), "utf8"));
    if ((result.code === 0) !== expectSuccess) throw new Error(`${name}: unexpected exit ${result.code}: ${result.stderr || result.stdout}`);
    if (expectSuccess) {
      if (report.authorized !== true || report.decision !== "authorized") throw new Error(`${name}: authorization was not accepted`);
      if (report.provenance?.sourceWorkflowRunId !== baseEnv.GITHUB_RUN_ID) throw new Error(`${name}: source workflow run not bound`);
      if (report.provenance?.sourceRepository !== baseEnv.GITHUB_REPOSITORY) throw new Error(`${name}: source repository not bound`);
      if (report.provenance?.sourceRef !== baseEnv.GITHUB_REF) throw new Error(`${name}: source ref not bound`);
      if (report.provenance?.sourceHeadSha !== sourceHeadSha) throw new Error(`${name}: source head SHA not bound`);
    } else if (!report.failures?.some((item) => String(item).startsWith(expectedFailure))) {
      throw new Error(`${name}: expected ${expectedFailure}, got ${JSON.stringify(report.failures)}`);
    }
    return { name, status: expectSuccess ? "authorized" : "blocked", expectedFailure };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const results = [];
results.push(await runScenario("main-run-provenance", {}, true));
results.push(await runScenario("non-main-ref", { GITHUB_REF: "refs/heads/feature/recovery" }, false, "source_ref_not_main:"));
results.push(await runScenario("missing-run-id", { GITHUB_RUN_ID: "" }, false, "source_workflow_run_id_invalid"));
results.push(await runScenario("invalid-head-sha", { GITHUB_SHA: "deadbeef" }, false, "source_head_sha_invalid"));

const summary = {
  ok: true,
  scenarios: results.length,
  authorizedScenarios: results.filter((item) => item.status === "authorized").length,
  blockedScenarios: results.filter((item) => item.status === "blocked").length,
  results,
  signature: "Tehkné Solutions",
};
await mkdir(resolve(repo, "artifacts"), { recursive: true });
await writeFile(resolve(repo, "artifacts/recovery-authorization-provenance-selftest.json"), `${JSON.stringify(summary, null, 2)}\n`);
const md = [
  "# HENUVOKODAN Recovery Authorization Provenance Self-Test",
  "",
  "- Result: **PASS**",
  `- Scenarios: **${summary.scenarios}**`,
  `- Authorized: **${summary.authorizedScenarios}**`,
  `- Fail-closed: **${summary.blockedScenarios}**`,
  "",
  ...results.map((item) => `- ${item.name}: **${item.status.toUpperCase()}**${item.expectedFailure ? ` (${item.expectedFailure})` : ""}`),
  "",
  "Tehkné Solutions",
].join("\n");
await writeFile(resolve(repo, "artifacts/recovery-authorization-provenance-selftest.md"), `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });
console.log(`recovery authorization provenance self-test: ${results.length} scenarios PASS`);

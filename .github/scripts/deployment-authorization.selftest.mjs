import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const repo = process.cwd();
const temp = await mkdtemp(join(tmpdir(), "hnk-deployment-auth-"));
const inputDir = join(temp, "input");
await mkdir(inputDir, { recursive: true });

const sha = "c".repeat(40);
const candidateId = "rc.test.warn-policy";
let recoveryBlocked = false;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, storage: "sqlite" }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/snapshot") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ diagnostics: [], recentEvents: [] }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/recovery") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ schemaVersion: 1, blocked: recoveryBlocked, decision: recoveryBlocked ? "rollback_recommended" : "clear", activeIncidents: recoveryBlocked ? 1 : 0, recommendations: recoveryBlocked ? [{ fingerprint: "f".repeat(20) }] : [] }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/telemetry") {
    req.resume();
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ accepted: true }));
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
if (!address || typeof address === "string") throw new Error("server address unavailable");
const baseUrl = `http://127.0.0.1:${address.port}`;

async function writeScenario(candidateBudget, qualityBudget) {
  const candidate = {
    schemaVersion: 1,
    candidateId,
    candidateSha: sha,
    gateMode: "production",
    environment: "production",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    immutable: true,
    evidence: {
      qualityReportSha: sha,
      regressionBudget: candidateBudget,
      productionSmokeSessionId: "smoke.test",
      controlCenterStorage: "sqlite",
      recoveryGate: "clear",
      activeRecoveryIncidents: 0,
      criticalDiagnostics: 0,
      recentProductionFatals: 0,
    },
    signature: "Tehkné Solutions",
  };
  const gate = { schemaVersion: 1, gateMode: "production", candidateSha: sha, eligible: true, decision: "eligible", reasons: [], warnings: candidateBudget === "warn" ? ["quality:regression_budget_warn_non_blocking"] : [], signals: { recoveryBlocked: false } };
  const quality = { sha, result: "pass", regressionBudget: { status: qualityBudget, violations: [], warnings: qualityBudget === "warn" ? ["duration_regression"] : [] } };
  const smoke = { ok: true, smokeSessionId: "smoke.test" };
  for (const [name, value] of [["release-candidate.json", candidate], ["release-gate-report.json", gate], ["ci-quality-report.json", quality], ["release-smoke.json", smoke]]) {
    await writeFile(join(inputDir, name), `${JSON.stringify(value)}\n`);
  }
}

async function run(expectSuccess) {
  await rm(resolve(repo, "artifacts/deployment-authorization.json"), { force: true });
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, [resolve(repo, ".github/scripts/authorize-deployment.mjs")], {
      cwd: repo,
      stdio: "inherit",
      env: {
        ...process.env,
        HNK_RELEASE_CANDIDATE_PATH: join(inputDir, "release-candidate.json"),
        HNK_RELEASE_GATE_REPORT_PATH: join(inputDir, "release-gate-report.json"),
        HNK_QUALITY_REPORT_PATH: join(inputDir, "ci-quality-report.json"),
        HNK_SMOKE_REPORT_PATH: join(inputDir, "release-smoke.json"),
        HNK_CANDIDATE_ID: candidateId,
        HNK_CURRENT_MAIN_SHA: sha,
        HNK_AUTHORIZATION_REASON: "self-test warning policy",
        HNK_DEPLOYMENT_ENVIRONMENT: "production",
        HNK_TELEMETRY_BASE_URL: baseUrl,
        HNK_TELEMETRY_ADMIN_TOKEN: "test-token",
        GITHUB_ACTOR: "selftest",
        GITHUB_RUN_ID: "123456789",
        GITHUB_REPOSITORY: "Tehkne-Solutions/hnk-cronicas-obra-viva",
        GITHUB_REF: "refs/heads/main",
        GITHUB_SHA: sha,
      },
    });
    child.once("error", reject);
    child.once("exit", (value) => resolveCode(value ?? 1));
  });
  if ((code === 0) !== expectSuccess) throw new Error(`unexpected authorization exit ${code}`);
  return JSON.parse(await readFile(resolve(repo, "artifacts/deployment-authorization.json"), "utf8"));
}

try {
  recoveryBlocked = false;
  await writeScenario("warn", "warn");
  const allowed = await run(true);
  if (allowed.authorized !== true || allowed.decision !== "authorized") throw new Error("matching non-blocking warning was not authorized");
  if (!allowed.warnings?.includes("candidate:regression_budget_warn_non_blocking") || !allowed.warnings?.includes("quality:regression_budget_warn_non_blocking")) throw new Error("warning evidence missing from authorization");
  if (allowed.provenance?.sourceHeadSha !== sha || allowed.provenance?.sourceRef !== "refs/heads/main" || allowed.provenance?.sourceWorkflowRunId !== "123456789") throw new Error("deployment authorization provenance missing");
  if (allowed.evidence?.activeRecoveryIncidents !== 0 || allowed.evidence?.recoveryGate !== "clear") throw new Error("clear recovery evidence missing");

  await writeScenario("warn", "pass");
  const mismatch = await run(false);
  if (mismatch.authorized !== false || !mismatch.failures?.some((item) => item.startsWith("candidate_quality_budget_mismatch:"))) throw new Error("candidate/quality budget mismatch was not rejected");

  recoveryBlocked = true;
  await writeScenario("pass", "pass");
  const blocked = await run(false);
  if (blocked.authorized !== false || !blocked.failures?.some((item) => item.startsWith("recovery_gate_blocked:"))) throw new Error("live Recovery Gate did not block deployment authorization");

  console.log("deployment authorization warning/recovery/provenance self-test: PASS");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const inputDir = resolve(root, "artifacts/recovery-execution-input");
const reportPath = resolve(root, "artifacts/recovery-report.json");
const targetSha = "1234567890abcdef1234567890abcdef12345678";
const authorizationId = "recovery-auth.runtime-smoke";
const fingerprint = "runtime-smoke-fingerprint";

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise(server.address().port));
  });
}

let deployCalls = 0;
let lastDeployRef = null;
const deployServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method !== "POST" || url.pathname !== "/deploy") {
    res.writeHead(404).end();
    return;
  }
  deployCalls += 1;
  lastDeployRef = url.searchParams.get("ref");
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, ref: lastDeployRef }));
});
const productionServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/release.json") {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ schemaVersion: 1, buildSha: targetSha, release: "runtime-smoke", signature: "Tehkné Solutions" }));
});

const deployPort = await listen(deployServer);
const productionPort = await listen(productionServer);

const baseAuthorization = {
  schemaVersion: 1,
  authorizationId,
  authorized: true,
  decision: "authorized",
  targetSha,
  incidentFingerprint: fingerprint,
  signature: "Tehkné Solutions",
};
const baseHealthy = {
  schemaVersion: 1,
  status: "completed",
  candidateSha: targetSha,
  verifiedManifest: { buildSha: targetSha, signature: "Tehkné Solutions" },
  signature: "Tehkné Solutions",
};
const baseGate = {
  schemaVersion: 1,
  blocked: true,
  decision: "rollback_recommended",
  recommendations: [{ fingerprint, action: "rollback_recommended" }],
};

async function writeInputs({ authorization = baseAuthorization, healthy = baseHealthy, gate = baseGate } = {}) {
  await rm(inputDir, { recursive: true, force: true });
  await mkdir(inputDir, { recursive: true });
  await writeFile(resolve(inputDir, "recovery-authorization.json"), `${JSON.stringify(authorization, null, 2)}\n`);
  await writeFile(resolve(inputDir, "healthy-promotion-report.json"), `${JSON.stringify(healthy, null, 2)}\n`);
  await writeFile(resolve(inputDir, "recovery-gate.json"), `${JSON.stringify(gate, null, 2)}\n`);
  await rm(reportPath, { force: true });
}

function runExecutor(env = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [".github/scripts/execute-recovery.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        HNK_RECOVERY_AUTHORIZATION_ID: authorizationId,
        HNK_RECOVERY_TARGET_SHA: targetSha,
        HNK_RENDER_DEPLOY_HOOK_URL: `http://127.0.0.1:${deployPort}/deploy`,
        HNK_GAME_PRODUCTION_URL: `http://127.0.0.1:${productionPort}`,
        HNK_TELEMETRY_BASE_URL: "",
        HNK_POST_DEPLOY_TIMEOUT_MS: "3000",
        HNK_POST_DEPLOY_POLL_MS: "50",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function report() {
  return JSON.parse(await readFile(reportPath, "utf8"));
}

async function expectBlocked(name, inputs, expectedFailure, env = {}) {
  const before = deployCalls;
  await writeInputs(inputs);
  const result = await runExecutor(env);
  if (result.code === 0) throw new Error(`${name}: executor unexpectedly succeeded`);
  const output = await report();
  if (!output.failures?.some((item) => String(item).startsWith(expectedFailure))) {
    throw new Error(`${name}: expected failure ${expectedFailure}, got ${JSON.stringify(output.failures)}`);
  }
  if (deployCalls !== before) throw new Error(`${name}: deploy hook was called despite fail-closed rejection`);
  return { name, status: "blocked", failure: expectedFailure };
}

const results = [];
try {
  results.push(await expectBlocked("authorization-required", {
    authorization: { ...baseAuthorization, authorized: false, decision: "rejected" },
  }, "recovery_not_authorized"));

  results.push(await expectBlocked("target-sha-must-match", {
    authorization: { ...baseAuthorization, targetSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
  }, "recovery_target_sha_mismatch"));

  results.push(await expectBlocked("target-must-be-proven-healthy", {
    healthy: { ...baseHealthy, status: "rollback_required", verifiedManifest: null },
  }, "target_not_proven_healthy"));

  results.push(await expectBlocked("live-gate-must-still-recommend-rollback", {
    gate: { ...baseGate, blocked: false, decision: "continue", recommendations: [] },
  }, "recovery_gate_no_longer_requires_rollback"));

  results.push(await expectBlocked("authorized-fingerprint-must-still-block", {
    gate: { ...baseGate, recommendations: [{ fingerprint: "different-fingerprint", action: "rollback_recommended" }] },
  }, "authorized_incident_not_currently_blocking"));

  await writeInputs();
  const before = deployCalls;
  const success = await runExecutor();
  if (success.code !== 0) throw new Error(`valid-recovery: executor failed: ${success.stderr || success.stdout}`);
  const output = await report();
  if (output.status !== "recovered") throw new Error(`valid-recovery: expected recovered, got ${output.status}`);
  if (output.verifiedManifest?.buildSha !== targetSha) throw new Error("valid-recovery: exact release manifest was not verified");
  if (deployCalls !== before + 1) throw new Error(`valid-recovery: expected exactly one deploy call, got ${deployCalls - before}`);
  if (lastDeployRef !== targetSha) throw new Error(`valid-recovery: deploy ref mismatch ${lastDeployRef}`);
  results.push({ name: "valid-recovery", status: "recovered", deployRef: lastDeployRef });

  const summary = {
    ok: true,
    scenarios: results.length,
    blockedScenarios: results.filter((item) => item.status === "blocked").length,
    successfulScenarios: results.filter((item) => item.status === "recovered").length,
    realRenderCalls: 0,
    localDeployCalls: deployCalls,
    results,
    signature: "Tehkné Solutions",
  };
  await mkdir(resolve(root, "artifacts"), { recursive: true });
  await writeFile(resolve(root, "artifacts/recovery-runtime-smoke.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [
    "# HENUVOKODAN Recovery Runtime Smoke",
    "",
    `- Result: **PASS**`,
    `- Scenarios: **${summary.scenarios}**`,
    `- Fail-closed scenarios: **${summary.blockedScenarios}**`,
    `- Valid recovery scenarios: **${summary.successfulScenarios}**`,
    `- Real Render calls: **0**`,
    "",
    ...results.map((item) => `- ${item.name}: **${item.status.toUpperCase()}**${item.failure ? ` (${item.failure})` : ""}`),
    "",
    "Tehkné Solutions",
  ].join("\n");
  await writeFile(resolve(root, "artifacts/recovery-runtime-smoke.md"), `${md}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });
  console.log(`recovery runtime smoke: ${results.length} scenarios PASS; real Render calls=0`);
} finally {
  await new Promise((resolvePromise) => deployServer.close(resolvePromise));
  await new Promise((resolvePromise) => productionServer.close(resolvePromise));
}

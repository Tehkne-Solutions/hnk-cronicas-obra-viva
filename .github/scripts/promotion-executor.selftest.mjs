import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const repo = process.cwd();
const temp = await mkdtemp(join(tmpdir(), "hnk-promotion-"));
const inputDir = join(temp, "input");
await mkdir(inputDir, { recursive: true });

const sha = "a".repeat(40);
const candidate = { schemaVersion: 1, candidateId: "rc.test", candidateSha: sha, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), ttlHours: 1, immutable: true, evidence: { regressionBudget: "pass" }, signature: "Tehkné Solutions" };
const gate = { eligible: true, decision: "eligible", candidateSha: sha, reasons: [] };
const quality = { sha, result: "pass", regressionBudget: { status: "pass" } };
const smoke = { ok: true, smokeSessionId: "smoke.test" };
const hash = createHash("sha256");
for (const part of [candidate, gate, quality, smoke]) hash.update(JSON.stringify(part));
const evidenceFingerprint = `sha256:${hash.digest("hex")}`;
const authorization = { authorizationId: "deploy-auth.test", authorized: true, decision: "authorized", candidateId: candidate.candidateId, candidateSha: sha, evidenceFingerprint, environment: "production", signature: "Tehkné Solutions" };
for (const [name, value] of [["release-candidate.json", candidate], ["release-gate-report.json", gate], ["ci-quality-report.json", quality], ["release-smoke.json", smoke], ["deployment-authorization.json", authorization]]) {
  await writeFile(join(inputDir, name), `${JSON.stringify(value)}\n`);
}

let productionSha = sha;
const server = createServer((req, res) => {
  if (req.url?.startsWith("/promote")) {
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ accepted: true }));
    return;
  }
  if (req.url?.startsWith("/release.json")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ schemaVersion: 1, buildSha: productionSha, release: "production", signature: "Tehkné Solutions" }));
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
if (!address || typeof address === "string") throw new Error("server address unavailable");
const base = `http://127.0.0.1:${address.port}`;

async function run(expectSuccess) {
  await rm(resolve(repo, "artifacts/promotion-report.json"), { force: true });
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, [resolve(repo, ".github/scripts/promote-release.mjs")], {
      cwd: repo,
      stdio: "inherit",
      env: { ...process.env, HNK_PROMOTION_INPUT_DIR: inputDir, HNK_AUTHORIZATION_ID: authorization.authorizationId, HNK_CANDIDATE_ID: candidate.candidateId, HNK_PROMOTION_WEBHOOK_URL: `${base}/promote`, HNK_GAME_PRODUCTION_URL: base, HNK_POST_DEPLOY_TIMEOUT_MS: "900", HNK_POST_DEPLOY_POLL_MS: "100" },
    });
    child.once("error", reject);
    child.once("exit", (value) => resolveCode(value ?? 1));
  });
  if ((code === 0) !== expectSuccess) throw new Error(`unexpected executor exit ${code}`);
  return JSON.parse(await readFile(resolve(repo, "artifacts/promotion-report.json"), "utf8"));
}

try {
  const passed = await run(true);
  if (passed.status !== "completed" || passed.verifiedManifest?.buildSha !== sha) throw new Error("successful promotion was not verified");
  productionSha = "b".repeat(40);
  const failed = await run(false);
  if (failed.status !== "rollback_required" || !failed.failures.some((item) => item.startsWith("post_deploy_verification_failed:"))) throw new Error("wrong production SHA did not require rollback");
  console.log("promotion executor self-test: PASS");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}

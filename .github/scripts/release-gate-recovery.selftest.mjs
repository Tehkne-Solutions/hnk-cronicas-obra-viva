import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repo = process.cwd();
const temp = await mkdtemp(join(tmpdir(), "hnk-release-gate-recovery-"));
const inputDir = join(temp, "input");
await mkdir(inputDir, { recursive: true });
const sha = "d".repeat(40);
let recoveryBlocked = false;

const quality = { sha, result: "pass", runId: 123, regressionBudget: { status: "pass", violations: [], warnings: [], baseline: { sha: "e".repeat(40) } } };
const smoke = { ok: true, smokeSessionId: "smoke.release-gate-test", diagnostic: "ok" };
await writeFile(join(inputDir, "ci-quality-report.json"), `${JSON.stringify(quality)}\n`);
await writeFile(join(inputDir, "release-smoke.json"), `${JSON.stringify(smoke)}\n`);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/health") return res.end(JSON.stringify({ ok: true, storage: "sqlite" }));
  if (url.pathname === "/api/snapshot") return res.end(JSON.stringify({
    diagnostics: [{ level: "error", code: "old_control_plane_error", sessionId: "release.old" }],
    recentEvents: [{ level: "fatal", sessionId: "release.old", name: "release_gate_decision" }],
  }));
  if (url.pathname === "/api/recovery") return res.end(JSON.stringify({
    schemaVersion: 1,
    blocked: recoveryBlocked,
    decision: recoveryBlocked ? "rollback_recommended" : "clear",
    activeIncidents: recoveryBlocked ? 1 : 0,
    recommendations: recoveryBlocked ? [{ fingerprint: "f".repeat(20), reason: "self-test" }] : [],
  }));
  if (req.method === "POST" && url.pathname === "/v1/telemetry") { req.resume(); res.statusCode = 202; return res.end(JSON.stringify({ accepted: true })); }
  res.statusCode = 404; res.end(JSON.stringify({ error: "not_found" }));
});
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
if (!address || typeof address === "string") throw new Error("server address unavailable");
const baseUrl = `http://127.0.0.1:${address.port}`;

async function run(expectSuccess) {
  await rm(resolve(repo, "artifacts/release-candidate.json"), { force: true });
  await rm(resolve(repo, "artifacts/release-gate-report.json"), { force: true });
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, [resolve(repo, ".github/scripts/release-gate.mjs")], {
      cwd: repo,
      stdio: "inherit",
      env: {
        ...process.env,
        HNK_CANDIDATE_SHA: sha,
        HNK_RELEASE_GATE_MODE: "production",
        HNK_RELEASE_CANDIDATE_TTL_HOURS: "1",
        HNK_RECOVERY_GATE_HOURS: "168",
        HNK_QUALITY_REPORT_PATH: join(inputDir, "ci-quality-report.json"),
        HNK_SMOKE_REPORT_PATH: join(inputDir, "release-smoke.json"),
        HNK_TELEMETRY_BASE_URL: baseUrl,
        HNK_TELEMETRY_ADMIN_TOKEN: "test-token",
      },
    });
    child.once("error", reject);
    child.once("exit", (value) => resolveCode(value ?? 1));
  });
  if ((code === 0) !== expectSuccess) throw new Error(`unexpected release gate exit ${code}`);
  const report = JSON.parse(await readFile(resolve(repo, "artifacts/release-gate-report.json"), "utf8"));
  let candidate = null;
  try { candidate = JSON.parse(await readFile(resolve(repo, "artifacts/release-candidate.json"), "utf8")); } catch {}
  return { report, candidate };
}

try {
  recoveryBlocked = false;
  const clear = await run(true);
  if (clear.report.decision !== "eligible" || clear.report.signals?.recoveryBlocked !== false || clear.report.signals?.activeRecoveryIncidents !== 0) throw new Error("clear Recovery Gate was not preserved in release evidence");
  if (!clear.candidate || clear.candidate.candidateSha !== sha || clear.candidate.evidence?.activeRecoveryIncidents !== 0) throw new Error("clear Recovery Gate did not emit eligible RC evidence");
  if (clear.report.signals?.criticalDiagnostics !== 0 || clear.report.signals?.recentProductionFatals !== 0) throw new Error("release control-plane sessions were incorrectly treated as production failures");

  recoveryBlocked = true;
  const blocked = await run(false);
  if (blocked.report.decision !== "blocked" || !blocked.report.reasons?.some((item) => item.startsWith("recovery_gate_blocked:"))) throw new Error("blocked Recovery Gate did not block RC emission");
  if (blocked.candidate !== null) throw new Error("blocked Recovery Gate emitted a release candidate");

  console.log("release gate Recovery Gate self-test: PASS");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
}

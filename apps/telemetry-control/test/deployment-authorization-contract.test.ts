import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const appDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(appDir, "../..");
const script = resolve(repoRoot, ".github/scripts/authorize-deployment.mjs");
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function writeFixture(dir: string, sha = "a".repeat(40)) {
  const candidate = {
    schemaVersion: 1,
    candidateId: `rc.${sha.slice(0, 12)}.1`,
    candidateSha: sha,
    createdAt: "2026-08-08T12:00:00.000Z",
    expiresAt: "2099-08-09T12:00:00.000Z",
    ttlHours: 24,
    immutable: true,
    evidence: {
      qualityReportSha: sha,
      qualityRunId: 123,
      regressionBudget: "pass",
      qualityBaselineSha: "b".repeat(40),
      productionSmokeSessionId: "smoke.1",
      productionSmokeDiagnostic: "error_storm",
      controlCenterStorage: "postgres",
      recoveryGate: "clear",
      activeRecoveryIncidents: 0,
      criticalDiagnostics: 0,
      recentProductionFatals: 0,
    },
    signature: "Tehkné Solutions",
  };
  const gate = {
    candidateSha: sha,
    eligible: true,
    decision: "eligible",
    reasons: [],
    signals: { recoveryGate: "clear", recoveryBlocked: false, activeRecoveryIncidents: 0 },
  };
  const quality = { sha, result: "pass", regressionBudget: { status: "pass", violations: [], warnings: [] } };
  const smoke = { ok: true, smokeSessionId: "smoke.1", diagnostic: "error_storm" };
  await Promise.all([
    writeFile(join(dir, "release-candidate.json"), JSON.stringify(candidate)),
    writeFile(join(dir, "release-gate-report.json"), JSON.stringify(gate)),
    writeFile(join(dir, "ci-quality-report.json"), JSON.stringify(quality)),
    writeFile(join(dir, "release-smoke.json"), JSON.stringify(smoke)),
  ]);
  return candidate;
}

async function fakeControlCenter() {
  const received: unknown[] = [];
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, storage: "postgres" }));
      return;
    }
    if (req.url?.startsWith("/api/snapshot")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ diagnostics: [], recentEvents: [] }));
      return;
    }
    if (req.url?.startsWith("/api/recovery")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ schemaVersion: 1, blocked: false, decision: "clear", activeIncidents: 0, recommendations: [] }));
      return;
    }
    if (req.url === "/v1/telemetry" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.statusCode = 202;
        res.end("{}");
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  return { baseUrl: `http://127.0.0.1:${address.port}`, received, close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())) };
}

async function runContract(cwd: string, env: Record<string, string>) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun) => {
    const child = spawn(process.execPath, [script], { cwd, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

function provenanceEnv(sha: string) {
  return {
    GITHUB_RUN_ID: "123456789",
    GITHUB_REPOSITORY: "Tehkne-Solutions/hnk-cronicas-obra-viva",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: sha,
  };
}

describe("deployment authorization contract", () => {
  it("authorizes only the exact active immutable Release Candidate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hnk-deploy-auth-"));
    cleanup.push(dir);
    const candidate = await writeFixture(dir);
    const control = await fakeControlCenter();
    try {
      const result = await runContract(dir, {
        HNK_RELEASE_CANDIDATE_PATH: join(dir, "release-candidate.json"),
        HNK_RELEASE_GATE_REPORT_PATH: join(dir, "release-gate-report.json"),
        HNK_QUALITY_REPORT_PATH: join(dir, "ci-quality-report.json"),
        HNK_SMOKE_REPORT_PATH: join(dir, "release-smoke.json"),
        HNK_CANDIDATE_ID: candidate.candidateId,
        HNK_CURRENT_MAIN_SHA: candidate.candidateSha,
        HNK_AUTHORIZATION_REASON: "Promote validated RC",
        HNK_DEPLOYMENT_ENVIRONMENT: "production",
        HNK_TELEMETRY_BASE_URL: control.baseUrl,
        HNK_TELEMETRY_ADMIN_TOKEN: "test-token",
        GITHUB_ACTOR: "release-operator",
        ...provenanceEnv(candidate.candidateSha),
      });
      expect(result.code).toBe(0);
      const authorization = JSON.parse(await readFile(join(dir, "artifacts/deployment-authorization.json"), "utf8"));
      expect(authorization.decision).toBe("authorized");
      expect(authorization.candidateId).toBe(candidate.candidateId);
      expect(authorization.authorizedBy).toBe("release-operator");
      expect(authorization.evidenceFingerprint).toMatch(/^sha256:/);
      expect(authorization.evidence.recoveryGate).toBe("clear");
      expect(authorization.evidence.activeRecoveryIncidents).toBe(0);
      expect(authorization.provenance).toMatchObject({
        authorizationWorkflow: "deployment-authorization",
        sourceWorkflowRunId: "123456789",
        sourceRepository: "Tehkne-Solutions/hnk-cronicas-obra-viva",
        sourceRef: "refs/heads/main",
        sourceHeadSha: candidate.candidateSha,
      });
      expect(authorization.failures).toEqual([]);
      expect(control.received).toHaveLength(1);
    } finally {
      await control.close();
    }
  });

  it("rejects a candidate immediately when main has advanced", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hnk-deploy-auth-"));
    cleanup.push(dir);
    const candidate = await writeFixture(dir);
    const control = await fakeControlCenter();
    try {
      const result = await runContract(dir, {
        HNK_RELEASE_CANDIDATE_PATH: join(dir, "release-candidate.json"),
        HNK_RELEASE_GATE_REPORT_PATH: join(dir, "release-gate-report.json"),
        HNK_QUALITY_REPORT_PATH: join(dir, "ci-quality-report.json"),
        HNK_SMOKE_REPORT_PATH: join(dir, "release-smoke.json"),
        HNK_CANDIDATE_ID: candidate.candidateId,
        HNK_CURRENT_MAIN_SHA: "c".repeat(40),
        HNK_AUTHORIZATION_REASON: "Should be rejected",
        HNK_DEPLOYMENT_ENVIRONMENT: "production",
        HNK_TELEMETRY_BASE_URL: control.baseUrl,
        HNK_TELEMETRY_ADMIN_TOKEN: "test-token",
        GITHUB_ACTOR: "release-operator",
        ...provenanceEnv(candidate.candidateSha),
      });
      expect(result.code).toBe(1);
      const authorization = JSON.parse(await readFile(join(dir, "artifacts/deployment-authorization.json"), "utf8"));
      expect(authorization.decision).toBe("rejected");
      expect(authorization.failures.some((item: string) => item.startsWith("candidate_superseded:"))).toBe(true);
    } finally {
      await control.close();
    }
  });
});

import { readFile } from "node:fs/promises";

const baseUrl = (process.env.HNK_TELEMETRY_BASE_URL ?? "").replace(/\/$/, "");
const outcome = (process.env.HNK_QUALITY_GATE_OUTCOME ?? "unknown").toLowerCase();
const candidateSha = process.env.HNK_CANDIDATE_SHA ?? process.env.GITHUB_SHA ?? "unknown";
if (!baseUrl) {
  console.warn("quality gate telemetry skipped: HNK_TELEMETRY_BASE_URL missing");
  process.exit(0);
}

let quality = null;
try { quality = JSON.parse(await readFile("artifacts/candidate-quality/ci-quality-report.json", "utf8")); } catch {}
let gate = null;
try { gate = JSON.parse(await readFile("artifacts/release-gate-report.json", "utf8")); } catch {}
const budget = quality?.regressionBudget?.status ?? null;
const status = outcome === "success" ? (budget === "warn" ? "warn" : "pass") : "fail";
const now = new Date().toISOString();
const event = {
  schemaVersion: 1,
  id: `quality-release-gate.${candidateSha}.${Date.now()}`,
  occurredAt: now,
  kind: status === "fail" ? "anomaly" : "health",
  name: `quality_release_gate_${status}`,
  level: status === "fail" ? "error" : status === "warn" ? "warn" : "info",
  sessionId: `quality.${candidateSha.slice(0, 12)}`,
  data: {
    candidateSha,
    workflowOutcome: outcome,
    regressionBudgetStatus: budget,
    foundationResult: quality?.result ?? null,
    releaseEligible: gate?.eligible ?? gate?.releaseEligible ?? null,
    releaseGateDecision: gate?.decision ?? null,
  },
};

try {
  const response = await fetch(`${baseUrl}/v1/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, release: "quality-release-gate", buildSha: candidateSha, events: [event] }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  console.log(`quality gate telemetry: ${status} candidate=${candidateSha.slice(0, 12)} budget=${budget ?? "unknown"}`);
} catch (error) {
  console.warn("quality gate telemetry publish failed", error instanceof Error ? error.message : String(error));
}

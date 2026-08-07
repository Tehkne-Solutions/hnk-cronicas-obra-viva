import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const read = async (path) => readFile(resolve(root, path), "utf8");
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const status = (value) => value || "not_run";

function countAutonomousSeeds(source) {
  const match = source.match(/for \(const seed of \[([^\]]+)\]\)/);
  return match ? match[1].split(",").map((item) => item.trim()).filter(Boolean).length : 0;
}
function countCampaignScenarios(source) {
  const match = source.match(/Array\.from\(\{ length: (\d+) \}/);
  return match ? Number(match[1]) : 0;
}
function mutationMetrics(source) {
  const mutantIds = [...source.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
  const required = source.match(/const REQUIRED_DOMAINS[^=]*= \[([^\]]+)\]/s);
  const domains = required ? [...required[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [];
  return { mutants: mutantIds.length, domains };
}
function milestoneMetrics(source) {
  const match = source.match(/const REQUIRED_MILESTONES[^=]*= \[([^\]]+)\]/s);
  return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]) : [];
}

const [explorationSource, simulationSource, mutationSource, observabilitySource] = await Promise.all([
  read("apps/game-web/src/autonomous-exploration.test.ts"),
  read("apps/game-web/src/campaign-simulation.test.ts"),
  read("apps/game-web/src/mutation-survival.test.ts"),
  read("apps/game-web/src/observability-gate.test.ts"),
]);
const mutation = mutationMetrics(mutationSource);
const milestones = milestoneMetrics(observabilitySource);
const gates = {
  typecheck: { status: status(process.env.HNK_TYPECHECK_STATUS), durationMs: number(process.env.HNK_TYPECHECK_MS) },
  test: { status: status(process.env.HNK_TEST_STATUS), durationMs: number(process.env.HNK_TEST_MS) },
  build: { status: status(process.env.HNK_BUILD_STATUS), durationMs: number(process.env.HNK_BUILD_MS) },
};
const passed = Object.values(gates).every((gate) => gate.status === "success");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY ?? "local",
  sha: process.env.GITHUB_SHA ?? "local",
  ref: process.env.GITHUB_REF ?? "local",
  runId: process.env.GITHUB_RUN_ID ?? "local",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  result: passed ? "pass" : "fail",
  gates,
  coverage: {
    canonicalPlaythroughs: 1,
    campaignScenarios: countCampaignScenarios(simulationSource),
    autonomousSeeds: countAutonomousSeeds(explorationSource),
    semanticMutants: mutation.mutants,
    mutationDomains: mutation.domains,
    protectedMilestones: milestones,
  },
};

const out = resolve(root, process.env.HNK_QUALITY_REPORT_PATH ?? "artifacts/ci-quality-report.json");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
const md = [
  "# HENUVOKODAN CI Quality Report",
  "",
  `- Result: **${report.result.toUpperCase()}**`,
  `- SHA: \`${report.sha}\``,
  `- Campaign scenarios: **${report.coverage.campaignScenarios}**`,
  `- Autonomous seeds: **${report.coverage.autonomousSeeds}**`,
  `- Semantic mutants killed by contract: **${report.coverage.semanticMutants}**`,
  `- Mutation domains protected: **${report.coverage.mutationDomains.length}** (${report.coverage.mutationDomains.join(", ")})`,
  `- Milestones protected: **${report.coverage.protectedMilestones.length}**`,
  "",
  "| Gate | Status | Duration |",
  "| --- | --- | ---: |",
  ...Object.entries(gates).map(([name, gate]) => `| ${name} | ${gate.status} | ${gate.durationMs ?? "—"} ms |`),
  "",
  "Tehkné Solutions",
].join("\n");
await writeFile(resolve(root, "artifacts/ci-quality-report.md"), `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });

const baseUrl = process.env.HNK_TELEMETRY_BASE_URL?.replace(/\/$/, "");
if (baseUrl) {
  const event = {
    schemaVersion: 1,
    id: `ci-quality.${report.runId}.${report.runAttempt}.${Date.now()}`,
    occurredAt: report.generatedAt,
    kind: passed ? "health" : "anomaly",
    name: "ci_quality_report",
    level: passed ? "info" : "error",
    sessionId: `ci.${report.runId}.${report.runAttempt}`,
    data: {
      result: report.result,
      gates,
      campaignScenarios: report.coverage.campaignScenarios,
      autonomousSeeds: report.coverage.autonomousSeeds,
      semanticMutants: report.coverage.semanticMutants,
      mutationDomains: report.coverage.mutationDomains.length,
      protectedMilestones: report.coverage.protectedMilestones.length,
      ref: report.ref,
    },
  };
  try {
    const response = await fetch(`${baseUrl}/v1/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ release: "ci-quality", buildSha: report.sha, events: [event] }),
    });
    if (!response.ok) console.warn(`CI quality telemetry publish returned ${response.status}`);
  } catch (error) {
    console.warn("CI quality telemetry publish failed without failing the build", error instanceof Error ? error.message : error);
  }
}

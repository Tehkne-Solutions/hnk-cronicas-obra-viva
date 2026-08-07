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
function quotedArray(source, declaration) {
  const match = source.match(new RegExp(`const ${declaration}[^=]*= \\[([^\\]]+)\\]`, "s"));
  return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]) : [];
}
function mutationMetrics(source) {
  const block = source.match(/const mutations:[\s\S]*?= \[([\s\S]*?)\n\];/);
  const mutantIds = block ? [...block[1].matchAll(/\n\s*id: "([^"]+)"/g)].map((match) => match[1]) : [];
  return { mutants: mutantIds.length, domains: quotedArray(source, "requiredDomains") };
}
async function readBaseline() {
  const path = process.env.HNK_QUALITY_BASELINE_PATH;
  if (!path) return null;
  try { return JSON.parse(await readFile(resolve(root, path), "utf8")); } catch { return null; }
}
function evaluateBudget(current, baseline) {
  if (!baseline) return { status: "no_baseline", violations: [], warnings: [], deltas: {} };
  const violations = [];
  const warnings = [];
  const deltas = {};
  const now = current.coverage ?? {};
  const before = baseline.coverage ?? {};
  for (const key of ["canonicalPlaythroughs", "campaignScenarios", "autonomousSeeds", "semanticMutants"]) {
    const currentValue = Number(now[key] ?? 0);
    const baselineValue = Number(before[key] ?? 0);
    deltas[key] = currentValue - baselineValue;
    if (currentValue < baselineValue) violations.push(`coverage_regressed:${key}:${baselineValue}->${currentValue}`);
  }
  for (const key of ["mutationDomains", "protectedMilestones"]) {
    const currentValues = new Set(Array.isArray(now[key]) ? now[key] : []);
    const baselineValues = Array.isArray(before[key]) ? before[key] : [];
    deltas[key] = currentValues.size - baselineValues.length;
    for (const item of baselineValues) if (!currentValues.has(item)) violations.push(`coverage_member_lost:${key}:${item}`);
  }
  for (const gateName of ["typecheck", "test", "build"]) {
    const currentMs = Number(current.gates?.[gateName]?.durationMs);
    const baselineMs = Number(baseline.gates?.[gateName]?.durationMs);
    if (!Number.isFinite(currentMs) || !Number.isFinite(baselineMs) || baselineMs <= 0) continue;
    const ratio = currentMs / baselineMs;
    const deltaMs = currentMs - baselineMs;
    deltas[`${gateName}DurationMs`] = deltaMs;
    if (ratio > 1.75 && deltaMs > 15_000) violations.push(`gate_duration_budget_exceeded:${gateName}:${baselineMs}->${currentMs}`);
    else if (ratio > 1.35 && deltaMs > 5_000) warnings.push(`gate_duration_warning:${gateName}:${baselineMs}->${currentMs}`);
  }
  return { status: violations.length ? "fail" : warnings.length ? "warn" : "pass", violations, warnings, deltas };
}

const [explorationSource, simulationSource, mutationSource, observabilitySource, baseline] = await Promise.all([
  read("apps/game-web/src/autonomous-exploration.test.ts"),
  read("apps/game-web/src/campaign-simulation.test.ts"),
  read("apps/game-web/src/mutation-survival.test.ts"),
  read("apps/game-web/src/observability-gate.test.ts"),
  readBaseline(),
]);
const mutation = mutationMetrics(mutationSource);
const milestones = quotedArray(observabilitySource, "criticalMilestones");
const gates = {
  typecheck: { status: status(process.env.HNK_TYPECHECK_STATUS), durationMs: number(process.env.HNK_TYPECHECK_MS) },
  test: { status: status(process.env.HNK_TEST_STATUS), durationMs: number(process.env.HNK_TEST_MS) },
  build: { status: status(process.env.HNK_BUILD_STATUS), durationMs: number(process.env.HNK_BUILD_MS) },
};
const coverage = {
  canonicalPlaythroughs: 1,
  campaignScenarios: countCampaignScenarios(simulationSource),
  autonomousSeeds: countAutonomousSeeds(explorationSource),
  semanticMutants: mutation.mutants,
  mutationDomains: mutation.domains,
  protectedMilestones: milestones,
};
const gatePass = Object.values(gates).every((gate) => gate.status === "success");
const draft = { gates, coverage };
const budget = evaluateBudget(draft, baseline);
const passed = gatePass && budget.status !== "fail";
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY ?? "local",
  sha: process.env.GITHUB_SHA ?? "local",
  ref: process.env.GITHUB_REF ?? "local",
  runId: process.env.GITHUB_RUN_ID ?? "local",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  result: passed ? "pass" : "fail",
  gates,
  coverage,
  regressionBudget: {
    ...budget,
    baseline: baseline ? { sha: baseline.sha ?? null, runId: baseline.runId ?? null, generatedAt: baseline.generatedAt ?? null } : null,
  },
};

const out = resolve(root, process.env.HNK_QUALITY_REPORT_PATH ?? "artifacts/ci-quality-report.json");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
const budgetLines = budget.status === "no_baseline"
  ? ["- Regression budget: **NO BASELINE**"]
  : [`- Regression budget: **${budget.status.toUpperCase()}**`, `- Baseline SHA: \`${report.regressionBudget.baseline?.sha ?? "unknown"}\``];
const md = [
  "# HENUVOKODAN CI Quality Report",
  "",
  `- Result: **${report.result.toUpperCase()}**`,
  `- SHA: \`${report.sha}\``,
  `- Campaign scenarios: **${coverage.campaignScenarios}**`,
  `- Autonomous seeds: **${coverage.autonomousSeeds}**`,
  `- Semantic mutants killed by contract: **${coverage.semanticMutants}**`,
  `- Mutation domains protected: **${coverage.mutationDomains.length}** (${coverage.mutationDomains.join(", ")})`,
  `- Milestones protected: **${coverage.protectedMilestones.length}**`,
  ...budgetLines,
  "",
  "| Gate | Status | Duration |",
  "| --- | --- | ---: |",
  ...Object.entries(gates).map(([name, gate]) => `| ${name} | ${gate.status} | ${gate.durationMs ?? "—"} ms |`),
  ...(budget.warnings.length ? ["", "## Budget warnings", ...budget.warnings.map((item) => `- ${item}`)] : []),
  ...(budget.violations.length ? ["", "## Budget violations", ...budget.violations.map((item) => `- ${item}`)] : []),
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
    level: passed ? (budget.status === "warn" ? "warn" : "info") : "error",
    sessionId: `ci.${report.runId}.${report.runAttempt}`,
    data: {
      result: report.result,
      gates,
      campaignScenarios: coverage.campaignScenarios,
      autonomousSeeds: coverage.autonomousSeeds,
      semanticMutants: coverage.semanticMutants,
      mutationDomains: coverage.mutationDomains.length,
      protectedMilestones: coverage.protectedMilestones.length,
      regressionBudgetStatus: budget.status,
      regressionViolations: budget.violations.length,
      regressionWarnings: budget.warnings.length,
      baselineSha: report.regressionBudget.baseline?.sha ?? null,
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

if (budget.status === "fail") process.exitCode = 1;

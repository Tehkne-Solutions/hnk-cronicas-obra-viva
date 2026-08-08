import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const candidateSha = process.env.HNK_CANDIDATE_SHA ?? process.env.GITHUB_SHA ?? "unknown";
const baseUrl = (process.env.HNK_TELEMETRY_BASE_URL ?? "").replace(/\/$/, "");
const adminToken = process.env.HNK_TELEMETRY_ADMIN_TOKEN ?? "";
const qualityPath = resolve(root, process.env.HNK_QUALITY_REPORT_PATH ?? "artifacts/candidate-quality/ci-quality-report.json");
const smokePath = resolve(root, process.env.HNK_SMOKE_REPORT_PATH ?? "artifacts/release-smoke.json");
const outDir = resolve(root, "artifacts");

const reasons = [];
const warnings = [];
const now = new Date();

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${String(text).slice(0, 300)}`);
  return body;
}

let quality = null;
try { quality = JSON.parse(await readFile(qualityPath, "utf8")); } catch (error) { reasons.push(`quality_report_unavailable:${error instanceof Error ? error.message : String(error)}`); }

if (quality) {
  if (quality.sha !== candidateSha) reasons.push(`quality_sha_mismatch:${quality.sha}`);
  if (quality.result !== "pass") reasons.push(`foundation_not_green:${quality.result}`);
  const budgetStatus = quality.regressionBudget?.status ?? "missing";
  if (budgetStatus !== "pass") reasons.push(`regression_budget_not_pass:${budgetStatus}`);
  if ((quality.regressionBudget?.violations?.length ?? 0) > 0) reasons.push("regression_budget_has_violations");
  if ((quality.regressionBudget?.warnings?.length ?? 0) > 0) warnings.push(...quality.regressionBudget.warnings.map((item) => `quality:${item}`));
}

let smoke = null;
try { smoke = JSON.parse(await readFile(smokePath, "utf8")); } catch (error) { reasons.push(`production_smoke_unavailable:${error instanceof Error ? error.message : String(error)}`); }
if (smoke && smoke.ok !== true) reasons.push("production_smoke_failed");

let health = null;
let snapshot = null;
if (!baseUrl || !adminToken) {
  reasons.push("control_center_not_configured");
} else {
  try {
    health = await jsonFetch("/health");
    if (health?.ok !== true) reasons.push("control_center_health_not_ok");
    if (health?.storage === "memory") reasons.push("control_center_not_persistent");
    snapshot = await jsonFetch("/api/snapshot?hours=6", { headers: { authorization: `Bearer ${adminToken}` } });
  } catch (error) {
    reasons.push(`control_center_unreachable:${error instanceof Error ? error.message : String(error)}`);
  }
}

const ignoredSession = (sessionId) => typeof sessionId === "string" && (sessionId.startsWith("smoke.") || sessionId.startsWith("ci."));
const criticalFindings = Array.isArray(snapshot?.diagnostics)
  ? snapshot.diagnostics.filter((finding) => (finding?.level === "fatal" || finding?.level === "error") && !ignoredSession(finding?.sessionId))
  : [];
if (criticalFindings.length > 0) reasons.push(`critical_production_diagnostics:${criticalFindings.map((item) => item.code).join(",")}`);

const recentEvents = Array.isArray(snapshot?.recentEvents) ? snapshot.recentEvents : [];
const productionFatals = recentEvents.filter((event) => event?.level === "fatal" && !ignoredSession(event?.sessionId));
if (productionFatals.length > 0) reasons.push(`recent_production_fatals:${productionFatals.length}`);

const eligible = reasons.length === 0;
const report = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  candidateSha,
  eligible,
  decision: eligible ? "eligible" : "blocked",
  signals: {
    foundation: quality?.result ?? "unknown",
    regressionBudget: quality?.regressionBudget?.status ?? "unknown",
    productionSmoke: smoke?.ok === true ? "pass" : "unknown",
    controlCenter: health?.ok === true ? "healthy" : "unknown",
    storage: health?.storage ?? "unknown",
    criticalDiagnostics: criticalFindings.length,
    recentProductionFatals: productionFatals.length,
  },
  qualityBaselineSha: quality?.regressionBudget?.baseline?.sha ?? null,
  reasons,
  warnings,
};

await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "release-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
const md = [
  "# HENUVOKODAN Quality Release Gate",
  "",
  `- Candidate: \`${candidateSha}\``,
  `- Decision: **${report.decision.toUpperCase()}**`,
  `- Foundation: **${report.signals.foundation}**`,
  `- Regression Budget: **${report.signals.regressionBudget}**`,
  `- Production Smoke: **${report.signals.productionSmoke}**`,
  `- Control Center: **${report.signals.controlCenter}** (${report.signals.storage})`,
  `- Critical diagnostics (6h): **${report.signals.criticalDiagnostics}**`,
  `- Production fatals (recent): **${report.signals.recentProductionFatals}**`,
  "",
  reasons.length ? `## Blocking reasons\n${reasons.map((item) => `- ${item}`).join("\n")}` : "## Blocking reasons\n- none",
  warnings.length ? `\n## Warnings\n${warnings.map((item) => `- ${item}`).join("\n")}` : "",
  "",
  "Tehkné Solutions",
].filter(Boolean).join("\n");
await writeFile(resolve(outDir, "release-gate-report.md"), `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });

if (baseUrl) {
  const event = {
    schemaVersion: 1,
    id: `release-gate.${candidateSha}.${Date.now()}`,
    occurredAt: report.generatedAt,
    kind: eligible ? "health" : "anomaly",
    name: "release_gate_decision",
    level: eligible ? "info" : "error",
    sessionId: `release.${candidateSha.slice(0, 12)}`,
    data: {
      candidateSha,
      decision: report.decision,
      reasons,
      warnings,
      foundation: report.signals.foundation,
      regressionBudget: report.signals.regressionBudget,
      productionSmoke: report.signals.productionSmoke,
      controlCenter: report.signals.controlCenter,
      criticalDiagnostics: report.signals.criticalDiagnostics,
      recentProductionFatals: report.signals.recentProductionFatals,
    },
  };
  try {
    await fetch(`${baseUrl}/v1/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ release: "quality-release-gate", buildSha: candidateSha, events: [event] }),
    });
  } catch (error) {
    console.warn("release gate decision telemetry publish failed", error instanceof Error ? error.message : error);
  }
}

if (!eligible) process.exit(1);

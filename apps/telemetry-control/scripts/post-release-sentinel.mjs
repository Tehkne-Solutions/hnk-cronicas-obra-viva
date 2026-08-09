import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const promotionPath = resolve(root, process.env.HNK_PROMOTION_REPORT_PATH ?? "artifacts/sentinel-input/promotion-report.json");
const outDir = resolve(root, "artifacts");
const baseUrl = (process.env.HNK_TELEMETRY_BASE_URL ?? "").replace(/\/$/, "");
const adminToken = process.env.HNK_TELEMETRY_ADMIN_TOKEN ?? "";
const productionUrl = (process.env.HNK_GAME_PRODUCTION_URL ?? "").replace(/\/$/, "");
const observeMs = Math.max(0, Number(process.env.HNK_SENTINEL_OBSERVE_MS ?? 120000));
const pollMs = Math.max(1000, Number(process.env.HNK_SENTINEL_POLL_MS ?? 15000));
const errorThreshold = Math.max(1, Number(process.env.HNK_SENTINEL_ERROR_THRESHOLD ?? 3));

if (!baseUrl || !adminToken || !productionUrl) {
  console.error("HNK_TELEMETRY_BASE_URL, HNK_TELEMETRY_ADMIN_TOKEN and HNK_GAME_PRODUCTION_URL are required.");
  process.exit(2);
}

const promotion = JSON.parse(await readFile(promotionPath, "utf8"));
const candidateSha = promotion?.candidateSha ?? null;
const promotionId = promotion?.promotionId ?? null;
const promotedAt = promotion?.promotedAt ?? null;
if (!candidateSha || !promotionId || promotion?.status !== "completed") {
  console.error("A completed promotion-report.json with promotionId and candidateSha is required.");
  process.exit(2);
}

const ignoredSession = (sessionId) => typeof sessionId === "string" && ["smoke.", "ci.", "release.", "deploy.", "promotion.", "sentinel."].some((prefix) => sessionId.startsWith(prefix));
const afterPromotion = (event) => {
  const timestamp = Date.parse(event?.receivedAt ?? event?.occurredAt ?? "");
  return Number.isFinite(timestamp) && (!promotedAt || timestamp >= Date.parse(promotedAt));
};

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${url} -> ${response.status}: ${text.slice(0, 400)}`);
  return body;
}

const startedAt = new Date();
const deadline = Date.now() + observeMs;
let lastManifest = null;
let latestSnapshot = null;
let observedEvents = [];
let failures = [];

while (true) {
  failures = [];
  try {
    lastManifest = await request(`${productionUrl}/release.json?sentinel=${Date.now()}`, { cache: "no-store" });
    if (lastManifest?.buildSha !== candidateSha) failures.push(`release_manifest_sha_mismatch:${lastManifest?.buildSha ?? "missing"}`);
    if (lastManifest?.signature !== "Tehkné Solutions") failures.push("release_manifest_signature_invalid");
  } catch (error) {
    failures.push(`release_manifest_unreachable:${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    latestSnapshot = await request(`${baseUrl}/api/snapshot?hours=1`, { headers: { authorization: `Bearer ${adminToken}` } });
    const recent = Array.isArray(latestSnapshot?.recentEvents) ? latestSnapshot.recentEvents : [];
    observedEvents = recent.filter((event) => afterPromotion(event) && !ignoredSession(event?.sessionId));
    const fatals = observedEvents.filter((event) => event?.level === "fatal");
    const errors = observedEvents.filter((event) => event?.level === "error" || event?.kind === "error");
    if (fatals.length > 0) failures.push(`post_release_fatal_events:${fatals.length}`);
    if (errors.length >= errorThreshold) failures.push(`post_release_error_threshold:${errors.length}/${errorThreshold}`);
  } catch (error) {
    failures.push(`control_center_snapshot_unreachable:${error instanceof Error ? error.message : String(error)}`);
  }

  if (Date.now() >= deadline) break;
  await new Promise((resolveSleep) => setTimeout(resolveSleep, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
}

const completedAt = new Date();
const status = failures.length === 0 ? "pass" : "fail";
const fatalCount = observedEvents.filter((event) => event?.level === "fatal").length;
const errorCount = observedEvents.filter((event) => event?.level === "error" || event?.kind === "error").length;
const warningCount = observedEvents.filter((event) => event?.level === "warn").length;
const report = {
  schemaVersion: 1,
  sentinelId: `sentinel.${candidateSha.slice(0, 12)}.${startedAt.getTime()}`,
  promotionId,
  candidateSha,
  productionUrl,
  promotedAt,
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  observeMs,
  status,
  manifestSha: lastManifest?.buildSha ?? null,
  observedEvents: observedEvents.length,
  fatalCount,
  errorCount,
  warningCount,
  failures,
  signature: "Tehkné Solutions",
};

await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "post-release-sentinel.json"), `${JSON.stringify(report, null, 2)}\n`);
const md = [
  "# HENUVOKODAN Post-Release Sentinel",
  "",
  `- Status: **${status.toUpperCase()}**`,
  `- Promotion: **${promotionId}**`,
  `- SHA: \`${candidateSha}\``,
  `- Manifest: \`${report.manifestSha ?? "—"}\``,
  `- Window: **${Math.round(observeMs / 1000)}s**`,
  `- Runtime events: **${report.observedEvents}**`,
  `- Errors: **${errorCount}** · Fatals: **${fatalCount}** · Warnings: **${warningCount}**`,
  "",
  failures.length ? `## Failures\n${failures.map((item) => `- ${item}`).join("\n")}` : "## Failures\n- none",
  "",
  "Tehkné Solutions",
].join("\n");
await writeFile(resolve(outDir, "post-release-sentinel.md"), `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });

const event = {
  schemaVersion: 1,
  id: `post-release-sentinel.${report.sentinelId}`,
  occurredAt: completedAt.toISOString(),
  kind: status === "pass" ? "health" : "anomaly",
  name: status === "pass" ? "post_release_sentinel_pass" : "post_release_sentinel_fail",
  level: status === "pass" ? "info" : "error",
  sessionId: `sentinel.${candidateSha.slice(0, 12)}`,
  data: {
    sentinelId: report.sentinelId,
    promotionId,
    candidateSha,
    manifestSha: report.manifestSha,
    observeMs,
    observedEvents: report.observedEvents,
    fatalCount,
    errorCount,
    warningCount,
    failures,
  },
};
try {
  await fetch(`${baseUrl}/v1/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, release: "post-release-sentinel", buildSha: candidateSha, events: [event] }),
  });
} catch (error) {
  console.warn("post-release sentinel telemetry publish failed", error instanceof Error ? error.message : error);
}

if (failures.length > 0) process.exit(1);

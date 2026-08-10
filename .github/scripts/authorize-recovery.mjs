import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const input = resolve(root, "artifacts/recovery-input/healthy-promotion-report.json");
const promotion = JSON.parse(await readFile(input, "utf8"));
const targetSha = (process.env.HNK_RECOVERY_TARGET_SHA ?? "").trim();
const fingerprint = (process.env.HNK_RECOVERY_INCIDENT_FINGERPRINT ?? "").trim();
const reason = (process.env.HNK_RECOVERY_REASON ?? "").trim();
const confirmation = (process.env.HNK_RECOVERY_CONFIRMATION ?? "").trim();
const failures = [];

if (!/^[0-9a-f]{40}$/i.test(targetSha)) failures.push("target_sha_invalid");
if (!/^[0-9a-f]{20}$/i.test(fingerprint)) failures.push("incident_fingerprint_invalid");
if (!reason) failures.push("reason_required");
if (confirmation !== "AUTHORIZE_ROLLBACK") failures.push("explicit_confirmation_required");
if (promotion.status !== "completed") failures.push("target_promotion_not_completed");
if (promotion.candidateSha !== targetSha) failures.push("target_sha_not_proven_healthy");
if (promotion.verifiedManifest?.buildSha !== targetSha) failures.push("target_manifest_not_verified");
if (promotion.signature !== "Tehkné Solutions") failures.push("promotion_evidence_signature_invalid");

const now = new Date();
const digest = createHash("sha256").update(`${targetSha}|${fingerprint}|${reason}|${now.toISOString()}`).digest("hex").slice(0, 20);
const authorizationId = `recovery-auth.${targetSha.slice(0, 12)}.${digest}`;
const report = {
  schemaVersion: 1,
  authorizationId,
  authorized: failures.length === 0,
  decision: failures.length === 0 ? "authorized" : "rejected",
  targetSha,
  incidentFingerprint: fingerprint,
  reason,
  healthyPromotionId: promotion.promotionId ?? null,
  healthyPromotionEvidenceFingerprint: promotion.evidenceFingerprint ?? null,
  authorizedAt: now.toISOString(),
  authorizedBy: process.env.GITHUB_ACTOR ?? "unknown",
  failures,
  signature: "Tehkné Solutions",
};

await mkdir(resolve(root, "artifacts/recovery-authorization"), { recursive: true });
await writeFile(resolve(root, "artifacts/recovery-authorization/recovery-authorization.json"), `${JSON.stringify(report, null, 2)}\n`);
const md = [
  "# HENUVOKODAN Recovery Authorization",
  "",
  `- Decision: **${report.decision.toUpperCase()}**`,
  `- Authorization ID: **${authorizationId}**`,
  `- Target healthy SHA: \`${targetSha || "—"}\``,
  `- Incident fingerprint: \`${fingerprint || "—"}\``,
  `- Reason: ${reason || "—"}`,
  `- Authorized by: **${report.authorizedBy}**`,
  "",
  failures.length ? `## Rejection reasons\n${failures.map((x) => `- ${x}`).join("\n")}` : "## Rejection reasons\n- none",
  "",
  "Tehkné Solutions",
].join("\n");
await writeFile(resolve(root, "artifacts/recovery-authorization/recovery-authorization.md"), `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: "a" });
if (failures.length) process.exit(1);

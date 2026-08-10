import { readFile } from "node:fs/promises";

const files = {
  authorizationWorkflow: await readFile(".github/workflows/recovery-authorization.yml", "utf8"),
  executorWorkflow: await readFile(".github/workflows/recovery-executor.yml", "utf8"),
  authorizationScript: await readFile(".github/scripts/authorize-recovery.mjs", "utf8"),
  executorScript: await readFile(".github/scripts/execute-recovery.mjs", "utf8"),
};

const required = [
  [files.authorizationWorkflow, "AUTHORIZE_ROLLBACK"],
  [files.authorizationWorkflow, "environment: production"],
  [files.authorizationWorkflow, "probe-recovery-gate.mjs"],
  [files.authorizationWorkflow, "discover-recovery-target.mjs"],
  [files.authorizationWorkflow, "rollback_to_verified_healthy_target"],
  [files.authorizationWorkflow, "reassert_verified_healthy_target"],
  [files.authorizationWorkflow, "HNK_RECOVERY_TARGET_SHA"],
  [files.authorizationWorkflow, "HNK_RECOVERY_INCIDENT_FINGERPRINT"],
  [files.authorizationWorkflow, "healthy-promotion-report.json"],
  [files.authorizationWorkflow, "live gate/discovery incident mismatch"],
  [files.executorWorkflow, "recovery-authorization.yml"],
  [files.executorWorkflow, "/api/recovery"],
  [files.executorWorkflow, "rollback_recommended"],
  [files.executorWorkflow, "production-smoke.mjs"],
  [files.authorizationScript, "target_sha_not_proven_healthy"],
  [files.authorizationScript, 'promotion.status !== "completed"'],
  [files.executorScript, "target_not_proven_healthy"],
  [files.executorScript, 'recoveryGate.decision !== "rollback_recommended"'],
  [files.executorScript, 'deployUrl.searchParams.set("ref", requestedTargetSha)'],
  [files.executorScript, "recovery_post_deploy_verification_failed"],
  [files.executorScript, 'name: status === "recovered" ? "recovery_completed" : "recovery_failed"'],
  [files.executorScript, 'name: "incident_resolved"'],
  [files.executorScript, "fingerprint: authorization.incidentFingerprint"],
  [files.executorScript, "resolvedBuildSha: requestedTargetSha"],
  [files.executorScript, 'resolution: "verified_render_recovery"'],
];

for (const [source, token] of required) {
  if (!source.includes(token)) throw new Error(`recovery contract missing: ${token}`);
}

const forbiddenAuthorizationInputs = [
  "inputs.target_sha",
  "inputs.incident_fingerprint",
  'target_sha:\n        description:',
  'incident_fingerprint:\n        description:',
];
for (const token of forbiddenAuthorizationInputs) {
  if (files.authorizationWorkflow.includes(token)) throw new Error(`recovery authorization must auto-discover exact binding: ${token}`);
}
if (files.executorWorkflow.includes("cancel-in-progress: true")) throw new Error("recovery must never cancel an in-progress rollback");
console.log(`recovery-execution selftest: ${required.length + forbiddenAuthorizationInputs.length + 1} invariants PASS`);

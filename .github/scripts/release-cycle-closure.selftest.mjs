import { readFile } from "node:fs/promises";

const qualityWorkflow = await readFile(".github/workflows/quality-release-gate.yml", "utf8");
const releaseGate = await readFile(".github/scripts/release-gate.mjs", "utf8");
const authorizationWorkflow = await readFile(".github/workflows/deployment-authorization.yml", "utf8");
const authorizationScript = await readFile(".github/scripts/authorize-deployment.mjs", "utf8");
const promotionWorkflow = await readFile(".github/workflows/promotion-executor.yml", "utf8");
const promotionScript = await readFile(".github/scripts/promote-release.mjs", "utf8");

const required = [
  [qualityWorkflow, "workflows: [foundation, recovery-executor]"],
  [qualityWorkflow, "HNK_RECOVERY_GATE_HOURS: 168"],
  [releaseGate, "/api/recovery?hours=${recoveryHours}"],
  [releaseGate, "recovery_gate_blocked:"],
  [releaseGate, 'sessionId.startsWith("release.")'],
  [releaseGate, "activeRecoveryIncidents"],
  [authorizationWorkflow, "Require deployment authorization from main"],
  [authorizationWorkflow, "ref: ${{ github.sha }}"],
  [authorizationWorkflow, "Main advanced after authorization dispatch"],
  [authorizationScript, "/api/recovery?hours=168"],
  [authorizationScript, "sourceWorkflowRunId"],
  [authorizationScript, 'sourceRef !== "refs/heads/main"'],
  [authorizationScript, "authorization_snapshot_mismatch:"],
  [authorizationScript, "recovery_gate_blocked:"],
  [authorizationScript, 'authorizationWorkflow: "deployment-authorization"'],
  [promotionWorkflow, "Require promotion dispatch from main"],
  [promotionWorkflow, "Locate exact deployment authorization evidence and provenance"],
  [promotionWorkflow, "Candidate superseded since authorization"],
  [promotionWorkflow, "Candidate superseded immediately before Render promotion"],
  [promotionWorkflow, "ref: ${{ github.sha }}"],
  [promotionWorkflow, 'HNK_CURRENT_MAIN_SHA="$current_main" node .github/scripts/promote-release.mjs'],
  [promotionScript, "candidate_superseded_since_authorization:"],
  [promotionScript, "authorization_provenance_head_sha_mismatch"],
  [promotionScript, "promotion_snapshot_mismatch:"],
  [promotionScript, "authorization_has_active_recovery_incidents:"],
  [promotionScript, "release_gate_recovery_state_invalid:"],
];

for (const [source, token] of required) {
  if (!source.includes(token)) throw new Error(`release cycle closure contract missing: ${token}`);
}

const forbidden = [
  [authorizationWorkflow, "ref: main"],
  [promotionWorkflow, "ref: main"],
];
for (const [source, token] of forbidden) {
  if (source.includes(token)) throw new Error(`release cycle closure still uses floating main checkout: ${token}`);
}

console.log(`release cycle closure self-test: ${required.length + forbidden.length} invariants PASS`);

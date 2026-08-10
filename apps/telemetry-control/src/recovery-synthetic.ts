import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";

function candidateSha(event: StoredTelemetryEvent): string {
  const value = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>).candidateSha : undefined;
  return typeof value === "string" ? value : event.buildSha ?? "";
}

export function isSyntheticRecoveryEvent(event: StoredTelemetryEvent): boolean {
  const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
  if (data.synthetic === true) return true;
  if (/^(test|ci|fixture|synthetic)[.:_-]/i.test(event.sessionId)) return true;
  const sha = candidateSha(event).trim();
  if (/^([0-9a-f])\1{39}$/i.test(sha)) return true;
  return false;
}

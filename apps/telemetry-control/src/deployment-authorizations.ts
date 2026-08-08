import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";

export type DeploymentAuthorizationStatus = "authorized" | "rejected";

export interface DeploymentAuthorizationView {
  readonly status: DeploymentAuthorizationStatus;
  readonly authorizationId: string;
  readonly candidateId: string | null;
  readonly candidateSha: string | null;
  readonly environment: string;
  readonly authorizedBy: string;
  readonly reason: string;
  readonly evidenceFingerprint: string | null;
  readonly receivedAt: string;
  readonly failures: readonly string[];
}

function stringData(event: StoredTelemetryEvent, key: string): string | null {
  const value = event.data[key];
  return typeof value === "string" ? value : null;
}
function stringArrayData(event: StoredTelemetryEvent, key: string): readonly string[] {
  const value = event.data[key];
  return Array.isArray(value) ? Object.freeze(value.filter((item): item is string => typeof item === "string")) : Object.freeze([]);
}

export function deriveDeploymentAuthorizationLedger(events: readonly StoredTelemetryEvent[]): readonly DeploymentAuthorizationView[] {
  const ledger = events
    .filter((event) => event.name === "deployment_authorized" || event.name === "deployment_authorization_rejected")
    .map((event): DeploymentAuthorizationView | null => {
      const authorizationId = stringData(event, "authorizationId");
      if (!authorizationId) return null;
      return Object.freeze({
        status: event.name === "deployment_authorized" ? "authorized" : "rejected",
        authorizationId,
        candidateId: stringData(event, "candidateId"),
        candidateSha: stringData(event, "candidateSha") ?? event.buildSha ?? null,
        environment: stringData(event, "environment") ?? "unknown",
        authorizedBy: stringData(event, "authorizedBy") ?? "unknown",
        reason: stringData(event, "reason") ?? "",
        evidenceFingerprint: stringData(event, "evidenceFingerprint"),
        receivedAt: event.receivedAt,
        failures: stringArrayData(event, "failures"),
      });
    })
    .filter((item): item is DeploymentAuthorizationView => item !== null)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return Object.freeze(ledger);
}

import { describe, expect, it } from "vitest";
import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { deriveDeploymentAuthorizationLedger } from "../src/deployment-authorizations.js";

function event(name: "deployment_authorized" | "deployment_authorization_rejected", receivedAt: string, data: Record<string, unknown>): StoredTelemetryEvent {
  return {
    schemaVersion: 1,
    id: `${name}.${receivedAt}`,
    occurredAt: receivedAt,
    receivedAt,
    kind: name === "deployment_authorized" ? "health" : "anomaly",
    name,
    level: name === "deployment_authorized" ? "info" : "error",
    sessionId: "deploy.abc",
    buildSha: "a".repeat(40),
    data,
  };
}

describe("deployment authorization ledger", () => {
  it("projects authorization identity, reason and evidence fingerprint", () => {
    const ledger = deriveDeploymentAuthorizationLedger([
      event("deployment_authorized", "2026-08-08T12:00:00.000Z", {
        authorizationId: "deploy-auth.1",
        candidateId: "rc.1",
        candidateSha: "a".repeat(40),
        environment: "production",
        authorizedBy: "release-operator",
        reason: "Promote validated RC",
        evidenceFingerprint: "sha256:abc",
        failures: [],
      }),
    ]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      status: "authorized",
      authorizationId: "deploy-auth.1",
      candidateId: "rc.1",
      authorizedBy: "release-operator",
      reason: "Promote validated RC",
      evidenceFingerprint: "sha256:abc",
    });
  });

  it("keeps rejected authorizations and their blocking reasons", () => {
    const ledger = deriveDeploymentAuthorizationLedger([
      event("deployment_authorization_rejected", "2026-08-08T13:00:00.000Z", {
        authorizationId: "deploy-auth.2",
        candidateId: "rc.2",
        candidateSha: "b".repeat(40),
        environment: "production",
        authorizedBy: "release-operator",
        reason: "Attempt stale RC",
        evidenceFingerprint: "sha256:def",
        failures: ["candidate_superseded"],
      }),
    ]);
    expect(ledger[0]?.status).toBe("rejected");
    expect(ledger[0]?.failures).toEqual(["candidate_superseded"]);
  });
});

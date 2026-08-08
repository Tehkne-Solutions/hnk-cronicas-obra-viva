import type { StoredTelemetryEvent } from "@hnk/telemetry-control-core";

export type ReleaseCandidateStatus = "active" | "superseded" | "expired";

export interface ReleaseCandidateView {
  readonly candidateId: string;
  readonly candidateSha: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: ReleaseCandidateStatus;
  readonly regressionBudget: string;
  readonly qualityBaselineSha: string | null;
}

function stringData(event: StoredTelemetryEvent, key: string): string | null {
  const value = event.data[key];
  return typeof value === "string" ? value : null;
}

export function deriveReleaseCandidateRegistry(
  events: readonly StoredTelemetryEvent[],
  latestQualitySha: string | null,
  now = new Date(),
): readonly ReleaseCandidateView[] {
  const candidates = events
    .filter((event) => event.name === "release_candidate_registered")
    .map((event): ReleaseCandidateView | null => {
      const candidateId = stringData(event, "candidateId");
      const candidateSha = stringData(event, "candidateSha") ?? event.buildSha ?? null;
      const createdAt = stringData(event, "createdAt") ?? event.receivedAt;
      const expiresAt = stringData(event, "expiresAt");
      if (!candidateId || !candidateSha || !expiresAt) return null;
      const expired = Date.parse(expiresAt) <= now.getTime();
      const superseded = !expired && latestQualitySha !== null && latestQualitySha !== candidateSha;
      return Object.freeze({
        candidateId,
        candidateSha,
        createdAt,
        expiresAt,
        status: expired ? "expired" : superseded ? "superseded" : "active",
        regressionBudget: stringData(event, "regressionBudget") ?? "unknown",
        qualityBaselineSha: stringData(event, "qualityBaselineSha"),
      });
    })
    .filter((item): item is ReleaseCandidateView => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return Object.freeze(candidates);
}

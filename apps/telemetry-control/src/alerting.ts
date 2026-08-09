import type { TelemetryStore } from "@hnk/telemetry-control-core";
import { analyzeTelemetry, type TelemetryFinding } from "@hnk/telemetry-engine/diagnostics";
import { deriveIncidentIntelligence } from "./incident-intelligence.js";

export interface TelemetryAlertPayload {
  readonly source: "hnk-telemetry-control";
  readonly detectedAt: string;
  readonly release: string;
  readonly buildSha: string;
  readonly finding: TelemetryFinding;
}

const RANK = { warn: 1, error: 2, fatal: 3 } as const;

export class TelemetryAlertManager {
  private readonly lastSent = new Map<string, number>();

  constructor(private readonly options: {
    store: TelemetryStore;
    webhook?: string;
    release: string;
    buildSha: string;
    cooldownMs?: number;
    minLevel?: "warn" | "error" | "fatal";
    fetchImpl?: typeof fetch;
  }) {}

  private eligible(finding: TelemetryFinding): boolean {
    const minimum = this.options.minLevel ?? "warn";
    return RANK[finding.level] >= RANK[minimum];
  }

  private async dispatchActionable(events: Awaited<ReturnType<TelemetryStore["recent"]>>, history: Awaited<ReturnType<TelemetryStore["recent"]>>, sessionId: string, now: number, cooldown: number): Promise<void> {
    if (!this.options.webhook) return;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    for (const event of events) {
      const incident = deriveIncidentIntelligence(event, history);
      if (!incident) continue;
      const minimum = this.options.minLevel ?? "warn";
      if (RANK[incident.severity] < RANK[minimum]) continue;
      const key = `${sessionId}:incident:${incident.fingerprint}:${incident.state}`;
      if (now - (this.lastSent.get(key) ?? 0) < cooldown) continue;
      const response = await fetchImpl(this.options.webhook, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Tehkne-HNK-Telemetry/1" },
        body: JSON.stringify({
          text: `[HENUVOKODAN][${incident.severity.toUpperCase()}][${incident.domain}][${incident.state}] ${incident.summary} Ocorrências: ${incident.occurrences}. Fingerprint: ${incident.fingerprint}. Ação: ${incident.recommendedAction}`,
          hnk: {
            source: "hnk-telemetry-control",
            detectedAt: new Date(now).toISOString(),
            release: this.options.release,
            buildSha: incident.candidateSha ?? this.options.buildSha,
            incident,
          },
        }),
      });
      if (response.ok) this.lastSent.set(key, now);
    }
  }

  async inspectSessions(sessionIds: readonly string[]): Promise<readonly TelemetryAlertPayload[]> {
    if (!this.options.webhook || sessionIds.length === 0) return [];
    const now = Date.now();
    const cooldown = this.options.cooldownMs ?? 15 * 60_000;
    const emitted: TelemetryAlertPayload[] = [];
    const history = await this.options.store.recent({ since: new Date(now - 7 * 24 * 60 * 60_000), limit: 5000 });
    for (const sessionId of [...new Set(sessionIds)]) {
      const events = await this.options.store.recent({ sessionId, since: new Date(now - 30 * 60_000), limit: 1000 });
      await this.dispatchActionable(events, history, sessionId, now, cooldown);
      for (const finding of analyzeTelemetry(events)) {
        if (!this.eligible(finding)) continue;
        const key = `${sessionId}:${finding.code}`;
        if (now - (this.lastSent.get(key) ?? 0) < cooldown) continue;
        const payload: TelemetryAlertPayload = Object.freeze({
          source: "hnk-telemetry-control",
          detectedAt: new Date(now).toISOString(),
          release: this.options.release,
          buildSha: this.options.buildSha,
          finding,
        });
        const fetchImpl = this.options.fetchImpl ?? fetch;
        const response = await fetchImpl(this.options.webhook, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "Tehkne-HNK-Telemetry/1" },
          body: JSON.stringify({
            text: `[HENUVOKODAN][${finding.level.toUpperCase()}] ${finding.code}: ${finding.summary}`,
            hnk: payload,
          }),
        });
        if (response.ok) {
          this.lastSent.set(key, now);
          emitted.push(payload);
        }
      }
    }
    return Object.freeze(emitted);
  }
}

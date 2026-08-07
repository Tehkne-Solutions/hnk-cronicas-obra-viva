import type { TelemetryStore } from "@hnk/telemetry-control-core";
import { analyzeTelemetry, type TelemetryFinding } from "@hnk/telemetry-engine/diagnostics";

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

  async inspectSessions(sessionIds: readonly string[]): Promise<readonly TelemetryAlertPayload[]> {
    if (!this.options.webhook || sessionIds.length === 0) return [];
    const now = Date.now();
    const cooldown = this.options.cooldownMs ?? 15 * 60_000;
    const emitted: TelemetryAlertPayload[] = [];
    for (const sessionId of [...new Set(sessionIds)]) {
      const events = await this.options.store.recent({ sessionId, since: new Date(now - 30 * 60_000), limit: 1000 });
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

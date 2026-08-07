import { Pool } from "pg";
import type { StoredTelemetryEvent, TelemetryRecentOptions, TelemetryStore } from "@hnk/telemetry-control-core";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hnk_telemetry_events (
  id text PRIMARY KEY,
  received_at timestamptz NOT NULL,
  occurred_at timestamptz NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  level text NOT NULL,
  session_id text NOT NULL,
  chronicle_id text,
  location_id text,
  world_day integer,
  world_minute integer,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  release text,
  build_sha text
);
CREATE INDEX IF NOT EXISTS hnk_telemetry_received_idx ON hnk_telemetry_events(received_at DESC);
CREATE INDEX IF NOT EXISTS hnk_telemetry_session_idx ON hnk_telemetry_events(session_id, received_at DESC);
CREATE INDEX IF NOT EXISTS hnk_telemetry_chronicle_idx ON hnk_telemetry_events(chronicle_id, received_at DESC);
CREATE INDEX IF NOT EXISTS hnk_telemetry_name_idx ON hnk_telemetry_events(name, received_at DESC);
`;

export class PostgresTelemetryStore implements TelemetryStore {
  private readonly pool: Pool;
  private initialized = false;

  constructor(connectionString: string, ssl = false) {
    this.pool = new Pool({ connectionString, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(SCHEMA);
    this.initialized = true;
  }

  async append(events: readonly StoredTelemetryEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const event of events) {
        await client.query(
          `INSERT INTO hnk_telemetry_events
          (id, received_at, occurred_at, kind, name, level, session_id, chronicle_id, location_id, world_day, world_minute, data, release, build_sha)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
          ON CONFLICT (id) DO NOTHING`,
          [event.id, event.receivedAt, event.occurredAt, event.kind, event.name, event.level, event.sessionId,
            event.chronicleId ?? null, event.locationId ?? null, event.worldDay ?? null, event.worldMinute ?? null,
            JSON.stringify(event.data), event.release ?? null, event.buildSha ?? null],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recent(options: TelemetryRecentOptions = {}): Promise<readonly StoredTelemetryEvent[]> {
    await this.initialize();
    const limit = Math.min(20_000, Math.max(1, options.limit ?? 5000));
    const since = options.since ?? new Date(0);
    const values: unknown[] = [since.toISOString()];
    let where = "received_at >= $1";
    if (options.sessionId) { values.push(options.sessionId); where += ` AND session_id = $${values.length}`; }
    values.push(limit);
    const result = await this.pool.query(`SELECT * FROM hnk_telemetry_events WHERE ${where} ORDER BY received_at DESC LIMIT $${values.length}`, values);
    return result.rows.map((row) => Object.freeze({
      schemaVersion: 1 as const,
      id: String(row.id),
      occurredAt: new Date(row.occurred_at).toISOString(),
      receivedAt: new Date(row.received_at).toISOString(),
      kind: row.kind,
      name: String(row.name),
      level: row.level,
      sessionId: String(row.session_id),
      ...(row.chronicle_id ? { chronicleId: String(row.chronicle_id) } : {}),
      ...(row.location_id ? { locationId: String(row.location_id) } : {}),
      ...(row.world_day !== null ? { worldDay: Number(row.world_day) } : {}),
      ...(row.world_minute !== null ? { worldMinute: Number(row.world_minute) } : {}),
      data: Object.freeze((row.data ?? {}) as Record<string, unknown>),
      ...(row.release ? { release: String(row.release) } : {}),
      ...(row.build_sha ? { buildSha: String(row.build_sha) } : {}),
    } as StoredTelemetryEvent));
  }

  async prune(before: Date): Promise<number> {
    await this.initialize();
    const result = await this.pool.query(`DELETE FROM hnk_telemetry_events WHERE received_at < $1`, [before.toISOString()]);
    return result.rowCount ?? 0;
  }

  async health(): Promise<{ readonly mode: string; readonly ok: boolean }> {
    try {
      await this.initialize();
      await this.pool.query("SELECT 1");
      return { mode: "postgres", ok: true };
    } catch {
      return { mode: "postgres", ok: false };
    }
  }

  async close(): Promise<void> { await this.pool.end(); }
}

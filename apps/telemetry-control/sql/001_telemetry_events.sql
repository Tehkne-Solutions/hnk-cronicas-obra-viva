-- Tehkné Solutions — HENUVOKODAN telemetry schema
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

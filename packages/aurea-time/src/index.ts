import type { DomainEvent, EventId, WorldTimestamp } from "@hnk/domain";

export interface AureaScheduleEntry {
  readonly id: string;
  readonly occursAt: WorldTimestamp;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
}

export interface AureaScheduleResolution {
  readonly due: readonly AureaScheduleEntry[];
  readonly pending: readonly AureaScheduleEntry[];
}

function rank(timestamp: WorldTimestamp): number {
  return (timestamp.day - 1) * 1440 + timestamp.minuteOfDay;
}

export function resolveAureaSchedule(
  entries: readonly AureaScheduleEntry[],
  now: WorldTimestamp,
): AureaScheduleResolution {
  const threshold = rank(now);
  const due: AureaScheduleEntry[] = [];
  const pending: AureaScheduleEntry[] = [];
  for (const entry of entries) {
    (rank(entry.occursAt) <= threshold ? due : pending).push(entry);
  }
  return Object.freeze({ due: Object.freeze(due), pending: Object.freeze(pending) });
}

export function materializeAureaScheduleEntry(
  entry: AureaScheduleEntry,
  eventId: EventId,
): DomainEvent<Readonly<Record<string, unknown>>> {
  return Object.freeze({
    id: eventId,
    type: entry.eventType,
    occurredAt: entry.occursAt,
    payload: Object.freeze({ ...entry.payload }),
    ...(entry.correlationId ? { correlationId: entry.correlationId } : {}),
  });
}

export function dayPart(timestamp: WorldTimestamp): "night" | "morning" | "afternoon" | "evening" {
  const minute = timestamp.minuteOfDay;
  if (minute < 6 * 60) return "night";
  if (minute < 12 * 60) return "morning";
  if (minute < 18 * 60) return "afternoon";
  if (minute < 22 * 60) return "evening";
  return "night";
}

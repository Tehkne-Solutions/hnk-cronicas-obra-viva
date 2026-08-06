import type { DomainEvent, EventId, WorldTimestamp } from "@hnk/domain";

export interface ScheduledConsequence<TPayload = Readonly<Record<string, unknown>>> {
  readonly id: string;
  readonly causeEventId: EventId;
  readonly dueAt: WorldTimestamp;
  readonly eventType: string;
  readonly payload: TPayload;
  readonly correlationId?: string;
}

export interface ConsequenceResolution {
  readonly due: readonly ScheduledConsequence[];
  readonly pending: readonly ScheduledConsequence[];
}

function timestampRank(timestamp: WorldTimestamp): number {
  return (timestamp.day - 1) * 1440 + timestamp.minuteOfDay;
}

export function scheduleConsequence<TPayload extends Readonly<Record<string, unknown>>>(
  consequence: ScheduledConsequence<TPayload>,
): ScheduledConsequence<TPayload> {
  return Object.freeze({ ...consequence, payload: Object.freeze({ ...consequence.payload }) });
}

export function resolveDueConsequences(
  consequences: readonly ScheduledConsequence[],
  now: WorldTimestamp,
): ConsequenceResolution {
  const threshold = timestampRank(now);
  const due: ScheduledConsequence[] = [];
  const pending: ScheduledConsequence[] = [];
  for (const consequence of consequences) {
    (timestampRank(consequence.dueAt) <= threshold ? due : pending).push(consequence);
  }
  return Object.freeze({ due: Object.freeze(due), pending: Object.freeze(pending) });
}

export function materializeConsequence(
  consequence: ScheduledConsequence,
  eventId: EventId,
): DomainEvent<Readonly<Record<string, unknown>>> {
  return Object.freeze({
    id: eventId,
    type: consequence.eventType,
    occurredAt: consequence.dueAt,
    payload: consequence.payload,
    causationId: consequence.causeEventId,
    ...(consequence.correlationId ? { correlationId: consequence.correlationId } : {}),
  });
}

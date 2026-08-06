export type Brand<T, TBrand extends string> = T & {
  readonly __brand: TBrand;
};

export type EntityId = Brand<string, "EntityId">;
export type PersonaId = Brand<string, "PersonaId">;
export type LocationId = Brand<string, "LocationId">;
export type EventId = Brand<string, "EventId">;
export type ClaimId = Brand<string, "ClaimId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type QuestionId = Brand<string, "QuestionId">;

export type EntityKind =
  | "persona"
  | "character"
  | "location"
  | "object"
  | "material"
  | "document"
  | "institution";

export interface EntityRef {
  readonly id: EntityId;
  readonly kind: EntityKind;
}

export interface WorldTimestamp {
  readonly day: number;
  readonly minuteOfDay: number;
}

export function createWorldTimestamp(
  day: number,
  minuteOfDay: number,
): WorldTimestamp {
  if (!Number.isInteger(day) || day < 1) {
    throw new RangeError("World day must be an integer greater than zero.");
  }

  if (
    !Number.isInteger(minuteOfDay) ||
    minuteOfDay < 0 ||
    minuteOfDay >= 24 * 60
  ) {
    throw new RangeError("minuteOfDay must be between 0 and 1439.");
  }

  return Object.freeze({ day, minuteOfDay });
}

export function advanceWorldTimestamp(
  timestamp: WorldTimestamp,
  elapsedMinutes: number,
): WorldTimestamp {
  if (!Number.isInteger(elapsedMinutes) || elapsedMinutes < 0) {
    throw new RangeError("Elapsed minutes must be a non-negative integer.");
  }

  const absoluteMinutes =
    (timestamp.day - 1) * 24 * 60 + timestamp.minuteOfDay + elapsedMinutes;

  return createWorldTimestamp(
    Math.floor(absoluteMinutes / (24 * 60)) + 1,
    absoluteMinutes % (24 * 60),
  );
}

export interface DomainEvent<TPayload = unknown> {
  readonly id: EventId;
  readonly type: string;
  readonly occurredAt: WorldTimestamp;
  readonly actor?: EntityRef;
  readonly payload: Readonly<TPayload>;
  readonly causationId?: EventId;
  readonly correlationId?: string;
}

export interface PlayerIntent {
  readonly id: string;
  readonly actorId: PersonaId;
  readonly verb:
    | "observe"
    | "take"
    | "place"
    | "add"
    | "remove"
    | "strike"
    | "open"
    | "wait"
    | "read";
  readonly targetId?: EntityId;
  readonly instrumentId?: EntityId;
  readonly params?: Readonly<Record<string, unknown>>;
}

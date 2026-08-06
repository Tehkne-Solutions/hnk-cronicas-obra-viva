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
export type KnowledgeNodeId = Brand<string, "KnowledgeNodeId">;
export type ChronicleId = Brand<string, "ChronicleId">;

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

export interface LocationState {
  readonly id: LocationId;
  readonly illumination: "dark" | "dim" | "lit";
  readonly entityIds: readonly EntityId[];
}

export interface EntityWorldState {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly locationId?: LocationId;
  readonly state: Readonly<Record<string, unknown>>;
}

export interface WorldState {
  readonly worldId: string;
  readonly timestamp: WorldTimestamp;
  readonly locations: Readonly<Record<string, LocationState>>;
  readonly entities: Readonly<Record<string, EntityWorldState>>;
}

export interface CapabilityState {
  readonly observatio: number;
  readonly litterae: number;
  readonly discernimentum: number;
}

export interface PersonaState {
  readonly id: PersonaId;
  readonly currentLocation: LocationId;
  readonly inventory: readonly EntityId[];
  readonly capabilities: CapabilityState;
}

export type KnowledgeKind =
  | "material"
  | "person"
  | "place"
  | "concept"
  | "document"
  | "operation"
  | "phenomenon";

export interface KnowledgeNode {
  readonly id: KnowledgeNodeId;
  readonly kind: KnowledgeKind;
  readonly discoveredAt: WorldTimestamp;
  readonly sourceRefs: readonly string[];
}

export type ClaimStatus =
  | "reported"
  | "observed"
  | "hypothesized"
  | "supported"
  | "reproduced"
  | "contradicted"
  | "retired";

export interface Claim {
  readonly id: ClaimId;
  readonly subjectId: EntityId | KnowledgeNodeId;
  readonly predicate: string;
  readonly value: unknown;
  readonly status: ClaimStatus;
  readonly createdAt: WorldTimestamp;
  readonly assertedBy?: EntityRef;
  readonly sourceRefs: readonly string[];
}

export type EvidenceKind =
  | "observation"
  | "experiment"
  | "document"
  | "testimony"
  | "artifact"
  | "event";

export interface Evidence {
  readonly id: EvidenceId;
  readonly kind: EvidenceKind;
  readonly producedAt: WorldTimestamp;
  readonly sourceRef?: EntityRef;
  readonly supports: readonly ClaimId[];
  readonly contradicts: readonly ClaimId[];
  readonly payload: Readonly<Record<string, unknown>>;
}

export type QuestionStatus =
  | "open"
  | "investigating"
  | "partially_answered"
  | "answered"
  | "nescio";

export interface Question {
  readonly id: QuestionId;
  readonly textKey: string;
  readonly status: QuestionStatus;
  readonly relatedClaims: readonly ClaimId[];
  readonly relatedEvidence: readonly EvidenceId[];
  readonly derivedQuestions: readonly QuestionId[];
  readonly openedAt: WorldTimestamp;
}

export interface KnowledgeState {
  readonly nodes: Readonly<Record<string, KnowledgeNode>>;
  readonly claims: Readonly<Record<string, Claim>>;
  readonly evidence: Readonly<Record<string, Evidence>>;
  readonly questions: Readonly<Record<string, Question>>;
}

export function createEmptyKnowledgeState(): KnowledgeState {
  return Object.freeze({
    nodes: Object.freeze({}),
    claims: Object.freeze({}),
    evidence: Object.freeze({}),
    questions: Object.freeze({}),
  });
}

import type {
  ChronicleId,
  DomainEvent,
  KnowledgeState,
  PersonaId,
  PersonaState,
  WorldState,
} from "@hnk/domain";
import type { ScheduledConsequence } from "@hnk/consequentia-engine";
import type { ChronicleSaveV1 } from "./index.js";

export const CHRONICLE_SCHEMA_VERSION_V2 = 2 as const;

export interface ChronicleSaveV2 {
  readonly schemaVersion: typeof CHRONICLE_SCHEMA_VERSION_V2;
  readonly chronicleId: ChronicleId;
  readonly activePersonaId: PersonaId;
  readonly world: WorldState;
  readonly personas: Readonly<Record<string, PersonaState>>;
  readonly knowledgeByPersona: Readonly<Record<string, KnowledgeState>>;
  readonly eventLedger: readonly DomainEvent[];
  readonly scheduledConsequences: readonly ScheduledConsequence[];
  readonly contentVersion: string;
}

export function migrateChronicleV1ToV2(value: ChronicleSaveV1): ChronicleSaveV2 {
  return Object.freeze({
    ...structuredClone(value),
    schemaVersion: CHRONICLE_SCHEMA_VERSION_V2,
    scheduledConsequences: Object.freeze([]),
  });
}

export function assertChronicleSaveV2(value: unknown): asserts value is ChronicleSaveV2 {
  if (!value || typeof value !== "object") {
    throw new TypeError("Chronicle save v2 must be an object.");
  }
  const candidate = value as Partial<ChronicleSaveV2>;
  if (candidate.schemaVersion !== CHRONICLE_SCHEMA_VERSION_V2) {
    throw new RangeError(`Unsupported Chronicle v2 schema version: ${String(candidate.schemaVersion)}`);
  }
  if (!Array.isArray(candidate.scheduledConsequences)) {
    throw new TypeError("Chronicle save v2 requires scheduledConsequences.");
  }
  if (!candidate.world || typeof candidate.world !== "object") {
    throw new TypeError("Chronicle save v2 requires a world snapshot.");
  }
  if (!Array.isArray(candidate.eventLedger)) {
    throw new TypeError("Chronicle save v2 requires an event ledger array.");
  }
}

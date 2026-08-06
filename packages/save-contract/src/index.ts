import type {
  ChronicleId,
  DomainEvent,
  KnowledgeState,
  PersonaId,
  PersonaState,
  WorldState,
} from "@hnk/domain";

export const CHRONICLE_SCHEMA_VERSION = 1 as const;

export interface ChronicleSaveV1 {
  readonly schemaVersion: typeof CHRONICLE_SCHEMA_VERSION;
  readonly chronicleId: ChronicleId;
  readonly activePersonaId: PersonaId;
  readonly world: WorldState;
  readonly personas: Readonly<Record<string, PersonaState>>;
  readonly knowledgeByPersona: Readonly<Record<string, KnowledgeState>>;
  readonly eventLedger: readonly DomainEvent[];
  readonly contentVersion: string;
}

export type ChronicleSave = ChronicleSaveV1;

export interface ChronicleStorage {
  save(id: ChronicleId, chronicle: ChronicleSave): Promise<void>;
  load(id: ChronicleId): Promise<ChronicleSave | null>;
}

export class MemoryChronicleStorage implements ChronicleStorage {
  readonly #saves = new Map<string, ChronicleSave>();

  async save(id: ChronicleId, chronicle: ChronicleSave): Promise<void> {
    assertChronicleSave(chronicle);
    this.#saves.set(id, structuredClone(chronicle));
  }

  async load(id: ChronicleId): Promise<ChronicleSave | null> {
    const chronicle = this.#saves.get(id);
    return chronicle ? structuredClone(chronicle) : null;
  }
}

export function assertChronicleSave(value: unknown): asserts value is ChronicleSave {
  if (!value || typeof value !== "object") {
    throw new TypeError("Chronicle save must be an object.");
  }

  const candidate = value as Partial<ChronicleSaveV1>;

  if (candidate.schemaVersion !== CHRONICLE_SCHEMA_VERSION) {
    throw new RangeError(
      `Unsupported Chronicle schema version: ${String(candidate.schemaVersion)}`,
    );
  }

  if (typeof candidate.chronicleId !== "string" || candidate.chronicleId.length === 0) {
    throw new TypeError("Chronicle save requires a chronicleId.");
  }

  if (typeof candidate.activePersonaId !== "string" || candidate.activePersonaId.length === 0) {
    throw new TypeError("Chronicle save requires an activePersonaId.");
  }

  if (!candidate.world || typeof candidate.world !== "object") {
    throw new TypeError("Chronicle save requires a world snapshot.");
  }

  if (!Array.isArray(candidate.eventLedger)) {
    throw new TypeError("Chronicle save requires an event ledger array.");
  }

  if (typeof candidate.contentVersion !== "string" || candidate.contentVersion.length === 0) {
    throw new TypeError("Chronicle save requires a contentVersion.");
  }
}

export interface SaveMigration<TFrom = unknown, TTo = unknown> {
  readonly from: number;
  readonly to: number;
  migrate(value: TFrom): TTo;
}

export function migrateChronicleSave(
  value: unknown,
  migrations: readonly SaveMigration[],
): ChronicleSave {
  if (!value || typeof value !== "object") {
    throw new TypeError("Chronicle save must be an object before migration.");
  }

  let current: unknown = structuredClone(value);
  let version = Number((current as { schemaVersion?: unknown }).schemaVersion);

  while (version !== CHRONICLE_SCHEMA_VERSION) {
    const migration = migrations.find((entry) => entry.from === version);
    if (!migration) {
      throw new RangeError(`No Chronicle migration registered from schema ${version}.`);
    }

    current = migration.migrate(current);
    version = migration.to;
  }

  assertChronicleSave(current);
  return current;
}

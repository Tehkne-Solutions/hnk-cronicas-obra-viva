import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  createWorldTimestamp,
  type ChronicleId,
  type LocationId,
  type PersonaId,
} from "@hnk/domain";
import {
  CHRONICLE_SCHEMA_VERSION,
  MemoryChronicleStorage,
  assertChronicleSave,
  migrateChronicleSave,
  type ChronicleSave,
} from "./index";

const chronicleId = "chronicle.test" as ChronicleId;
const personaId = "persona.test" as PersonaId;
const workshopId = "aurea.officina" as LocationId;

function createFixture(): ChronicleSave {
  return {
    schemaVersion: CHRONICLE_SCHEMA_VERSION,
    chronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.test",
      timestamp: createWorldTimestamp(1, 8 * 60),
      locations: {
        [workshopId]: {
          id: workshopId,
          illumination: "dark",
          entityIds: [],
        },
      },
      entities: {},
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: workshopId,
        inventory: [],
        capabilities: {
          observatio: 0,
          litterae: 0,
          discernimentum: 0,
        },
      },
    },
    knowledgeByPersona: {
      [personaId]: createEmptyKnowledgeState(),
    },
    eventLedger: [],
    contentVersion: "ignis-dev-1",
  };
}

describe("Chronicle save contract", () => {
  it("stores and reloads an isolated Chronicle snapshot", async () => {
    const storage = new MemoryChronicleStorage();
    const fixture = createFixture();

    await storage.save(chronicleId, fixture);
    const loaded = await storage.load(chronicleId);

    expect(loaded).toEqual(fixture);
    expect(loaded).not.toBe(fixture);
  });

  it("rejects unsupported schema versions", () => {
    expect(() =>
      assertChronicleSave({
        ...createFixture(),
        schemaVersion: 99,
      }),
    ).toThrow(/Unsupported Chronicle schema version/);
  });

  it("runs registered migrations before validation", () => {
    const legacy = {
      ...createFixture(),
      schemaVersion: 0,
    };

    const migrated = migrateChronicleSave(legacy, [
      {
        from: 0,
        to: 1,
        migrate: (value) => ({
          ...(value as Record<string, unknown>),
          schemaVersion: 1,
        }),
      },
    ]);

    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.chronicleId).toBe(chronicleId);
  });
});

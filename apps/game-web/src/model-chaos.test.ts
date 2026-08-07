import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  createEmptyKnowledgeState,
  type ChronicleId,
  type LocationId,
  type PersonaId,
} from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyProloguePath } from "./prologue.js";
import { applyIgnisAction } from "./ignis.js";
import { projectPlayableLoop } from "./playable-loop.js";
import { createTelemetryClient } from "./telemetry.js";
import {
  deleteChronicleFromBrowser,
  loadChronicleFromBrowser,
  saveChronicleToBrowser,
} from "./storage.js";

const personaId = "persona.player" as PersonaId;
const officina = "aurea.officina" as LocationId;

function freshChronicle(): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.chaos" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 7 * 60 + 45 },
      locations: { [officina]: { id: officina, illumination: "dim", entityIds: [] } },
      entities: {},
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: officina,
        inventory: [],
        capabilities: { observatio: 0, litterae: 0, discernimentum: 0 },
      },
    },
    knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() },
    eventLedger: [],
    scheduledConsequences: [],
    contentVersion: "model-chaos-gate-1",
  };
}

function assertChronicleHealthy(chronicle: ChronicleSaveV2) {
  expect(chronicle.personas[chronicle.activePersonaId]).toBeDefined();
  expect(chronicle.world.locations[chronicle.personas[chronicle.activePersonaId]!.currentLocation]).toBeDefined();
  expect(chronicle.knowledgeByPersona[chronicle.activePersonaId]).toBeDefined();
  expect(new Set(chronicle.eventLedger.map((event) => event.id)).size).toBe(chronicle.eventLedger.length);
  expect(chronicle.world.timestamp.day).toBeGreaterThanOrEqual(1);
  expect(chronicle.world.timestamp.minuteOfDay).toBeGreaterThanOrEqual(0);
  expect(chronicle.world.timestamp.minuteOfDay).toBeLessThan(24 * 60);
  expect(() => projectPlayableLoop(chronicle)).not.toThrow();
}

describe("MODEL BASED CHAOS GATE", () => {
  it("keeps repeated and out-of-order IGNIS actions idempotent and non-corrupting", () => {
    let chronicle = applyProloguePath(freshChronicle(), "observatio");
    const sequence = [
      "strike",
      "wait_wick",
      "place_wick",
      "place_wick",
      "add_oil",
      "add_oil",
      "strike",
      "wait_wick",
      "wait_wick",
      "strike",
      "strike",
    ] as const;

    for (const action of sequence) {
      chronicle = applyIgnisAction(chronicle, action);
      assertChronicleHealthy(chronicle);
    }

    expect(chronicle.eventLedger.filter((event) => event.type === "IgnisOilAdded")).toHaveLength(1);
    expect(chronicle.eventLedger.filter((event) => event.type === "IgnisWickPlaced")).toHaveLength(1);
    expect(chronicle.eventLedger.filter((event) => event.type === "CombustionStarted")).toHaveLength(1);
  });

  it("preserves the last valid save across reload boundaries", async () => {
    await deleteChronicleFromBrowser("chronicle.chaos");
    let chronicle = applyProloguePath(freshChronicle(), "litterae");
    chronicle = applyIgnisAction(chronicle, "add_oil");
    await saveChronicleToBrowser(chronicle);

    const saved = await loadChronicleFromBrowser(chronicle.chronicleId as string);
    expect(saved).not.toBeNull();
    assertChronicleHealthy(saved!);
    expect(saved!.eventLedger.some((event) => event.type === "IgnisOilAdded")).toBe(true);

    chronicle = applyIgnisAction(saved!, "place_wick");
    const staleReload = await loadChronicleFromBrowser(chronicle.chronicleId as string);
    expect(staleReload?.eventLedger.some((event) => event.type === "IgnisWickPlaced")).toBe(false);
    assertChronicleHealthy(staleReload!);

    await saveChronicleToBrowser(chronicle);
    const latestReload = await loadChronicleFromBrowser(chronicle.chronicleId as string);
    expect(latestReload?.eventLedger.some((event) => event.type === "IgnisWickPlaced")).toBe(true);
    assertChronicleHealthy(latestReload!);
    await deleteChronicleFromBrowser("chronicle.chaos");
  });

  it("never lets telemetry transport failure break gameplay", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => { throw new Error("network_down"); }) as typeof fetch;
    try {
      const client = createTelemetryClient({
        endpoint: "https://telemetry.invalid/v1/telemetry",
        release: "chaos-test",
        buildSha: "deadbeef",
        flushIntervalMs: 1,
      });
      expect(() => client.capture({ kind: "session", name: "chaos_transport_test", level: "info", data: {} })).not.toThrow();
      await expect(client.flush()).resolves.toBeUndefined();

      let chronicle = applyProloguePath(freshChronicle(), "discernimentum");
      chronicle = applyIgnisAction(chronicle, "add_oil");
      assertChronicleHealthy(chronicle);
      client.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed when IndexedDB becomes unavailable and does not mutate the in-memory Chronicle", async () => {
    const chronicle = applyIgnisAction(applyProloguePath(freshChronicle(), "observatio"), "add_oil");
    const snapshot = JSON.stringify(chronicle);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    try {
      await expect(saveChronicleToBrowser(chronicle)).rejects.toBeDefined();
      expect(JSON.stringify(chronicle)).toBe(snapshot);
      assertChronicleHealthy(chronicle);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    }
  });

  it("rejects extreme invalid clocks through health invariants before they enter a save", () => {
    const healthy = freshChronicle();
    assertChronicleHealthy(healthy);

    const invalidNegative = {
      ...healthy,
      world: { ...healthy.world, timestamp: { day: 1, minuteOfDay: -1 } },
    } as ChronicleSaveV2;
    expect(() => assertChronicleHealthy(invalidNegative)).toThrow();

    const invalidOverflow = {
      ...healthy,
      world: { ...healthy.world, timestamp: { day: 1, minuteOfDay: 24 * 60 } },
    } as ChronicleSaveV2;
    expect(() => assertChronicleHealthy(invalidOverflow)).toThrow();
  });
});

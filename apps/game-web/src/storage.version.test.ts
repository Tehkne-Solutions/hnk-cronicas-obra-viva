import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type LocationId, type PersonaId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { loadChronicleFromBrowser, saveChronicleToBrowser } from "./storage.js";

it("preserves Chronicle schema v2 through IndexedDB", async () => {
  const personaId = "persona.version" as PersonaId;
  const locationId = "aurea.officina" as LocationId;
  const save: ChronicleSaveV2 = {
    schemaVersion: 2,
    chronicleId: "chronicle.version" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 480 },
      locations: { [locationId]: { id: locationId, illumination: "lit", entityIds: [] } },
      entities: {},
    },
    personas: { [personaId]: { id: personaId, currentLocation: locationId, inventory: [], capabilities: { observatio: 1, litterae: 1, discernimentum: 1 } } },
    knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() },
    eventLedger: [],
    scheduledConsequences: [],
    contentVersion: "browser-version-test-1",
  };

  await saveChronicleToBrowser(save);
  const loaded = await loadChronicleFromBrowser(save.chronicleId as string);
  expect(loaded?.schemaVersion).toBe(2);
});

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type LocationId, type PersonaId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { loadChronicleFromBrowser, saveChronicleToBrowser } from "./storage.js";

const personaId = "persona.browser-reload" as PersonaId;
const chronicleId = "chronicle.browser-reload" as ChronicleId;
const officina = "aurea.officina" as LocationId;
const forum = "aurea.forum" as LocationId;

function fixture(): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 2, minuteOfDay: 15 * 60 + 35 },
      locations: {
        [officina]: { id: officina, illumination: "lit", entityIds: [] },
        [forum]: { id: forum, illumination: "lit", entityIds: [] },
      },
      entities: {},
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: forum,
        inventory: [],
        capabilities: { observatio: 1, litterae: 1, discernimentum: 1 },
      },
    },
    knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() },
    eventLedger: [{
      id: "event.travel.persisted" as never,
      type: "Travelled",
      occurredAt: { day: 2, minuteOfDay: 15 * 60 + 35 },
      payload: { from: officina, to: forum },
    }],
    scheduledConsequences: [{
      id: "consequence.persisted",
      causeEventId: "event.travel.persisted" as never,
      dueAt: { day: 3, minuteOfDay: 9 * 60 },
      eventType: "RumourSpread",
      payload: { source: "forum" },
    }],
    contentVersion: "browser-reload-test-1",
  };
}

describe("browser Chronicle persistence", () => {
  it("round-trips location, time, ledger, knowledge and pending consequences", async () => {
    const beforeReload = fixture();
    await saveChronicleToBrowser(beforeReload);

    const afterReload = await loadChronicleFromBrowser(chronicleId as string);

    expect(afterReload).not.toBeNull();
    expect(afterReload?.world.timestamp).toEqual(beforeReload.world.timestamp);
    expect(afterReload?.personas[personaId as string]?.currentLocation).toBe(forum);
    expect(afterReload?.eventLedger).toEqual(beforeReload.eventLedger);
    expect(afterReload?.knowledgeByPersona).toEqual(beforeReload.knowledgeByPersona);
    expect(afterReload?.scheduledConsequences).toEqual(beforeReload.scheduledConsequences);
  });
});

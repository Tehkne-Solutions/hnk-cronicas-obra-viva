import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type LocationId, type PersonaId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyIgnisAction, projectIgnis } from "./ignis.js";

const personaId = "persona.player" as PersonaId;
const officina = "aurea.officina" as LocationId;
function fixture(): ChronicleSaveV2 { return { schemaVersion: 2, chronicleId: "chronicle.ignis.playable" as ChronicleId, activePersonaId: personaId, world: { worldId: "world.aurea", timestamp: { day: 1, minuteOfDay: 465 }, locations: { [officina]: { id: officina, illumination: "dim", entityIds: [] } }, entities: {} }, personas: { [personaId]: { id: personaId, currentLocation: officina, inventory: [], capabilities: { observatio: 1, litterae: 0, discernimentum: 0 } } }, knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() }, eventLedger: [{ id: "event.prologue.1" as never, type: "ProloguePathChosen", occurredAt: { day: 1, minuteOfDay: 465 }, payload: { path: "observatio" } }], scheduledConsequences: [], contentVersion: "ignis-playable-test" }; }

describe("FIRST IGNIS PLAYABLE", () => {
  it("turns player actions into the first sustained flame and world light", () => {
    let chronicle = fixture();
    expect(projectIgnis(chronicle).availableActions).toContain("add_oil");
    chronicle = applyIgnisAction(chronicle, "add_oil");
    chronicle = applyIgnisAction(chronicle, "place_wick");
    chronicle = applyIgnisAction(chronicle, "wait_wick");
    expect(projectIgnis(chronicle).lamp.wickSaturation).toBe("saturated");
    chronicle = applyIgnisAction(chronicle, "strike");
    expect(projectIgnis(chronicle).completed).toBe(true);
    expect(chronicle.world.locations[officina]?.illumination).toBe("lit");
    expect(chronicle.eventLedger.some((event) => event.type === "CombustionStarted")).toBe(true);
  });
});

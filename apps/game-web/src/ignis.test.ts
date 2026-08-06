import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type LocationId, type PersonaId } from "@hnk/domain";
import { createLiberState, syncLiberKnowledge } from "@hnk/liber-engine";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyIgnisAction, projectIgnis } from "./ignis.js";

const personaId = "persona.player" as PersonaId;
const officina = "aurea.officina" as LocationId;
function fixture(path: "observatio" | "litterae" | "discernimentum" = "observatio"): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.ignis.playable" as ChronicleId,
    activePersonaId: personaId,
    world: { worldId: "world.aurea", timestamp: { day: 1, minuteOfDay: 465 }, locations: { [officina]: { id: officina, illumination: "dim", entityIds: [] } }, entities: {} },
    personas: { [personaId]: { id: personaId, currentLocation: officina, inventory: [], capabilities: { observatio: path === "observatio" ? 1 : 0, litterae: path === "litterae" ? 1 : 0, discernimentum: path === "discernimentum" ? 1 : 0 } } },
    knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() },
    eventLedger: [{ id: "event.prologue.1" as never, type: "ProloguePathChosen", occurredAt: { day: 1, minuteOfDay: 465 }, payload: { path } }],
    scheduledConsequences: [],
    contentVersion: "ignis-knowledge-test",
  };
}
function kindle(chronicle: ChronicleSaveV2): ChronicleSaveV2 {
  let next = applyIgnisAction(chronicle, "add_oil");
  next = applyIgnisAction(next, "place_wick");
  next = applyIgnisAction(next, "wait_wick");
  return applyIgnisAction(next, "strike");
}

describe("FIRST IGNIS PLAYABLE", () => {
  it("turns player actions into the first sustained flame and world light", () => {
    const chronicle = kindle(fixture());
    expect(projectIgnis(chronicle).completed).toBe(true);
    expect(projectIgnis(chronicle).availableActions).toContain("read_manuscript");
    expect(chronicle.world.locations[officina]?.illumination).toBe("lit");
    expect(chronicle.eventLedger.some((event) => event.type === "CombustionStarted")).toBe(true);
  });

  it.each(["observatio", "litterae", "discernimentum"] as const)("lets %s turn the illuminated manuscript into evidence and a QUAESTIO", (path) => {
    let chronicle = kindle(fixture(path));
    chronicle = applyIgnisAction(chronicle, "read_manuscript");
    const knowledge = chronicle.knowledgeByPersona[personaId as string]!;
    const liber = syncLiberKnowledge(createLiberState(), knowledge);
    expect(projectIgnis(chronicle).manuscriptRead).toBe(true);
    expect(Object.keys(knowledge.claims).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(knowledge.evidence).length).toBeGreaterThanOrEqual(2);
    expect(knowledge.questions["question.ignis.first-flame"]?.status).toBe("open");
    expect(liber.questionIds).toContain("question.ignis.first-flame");
  });

  it("does not duplicate the manuscript discovery when the player reads again", () => {
    let chronicle = kindle(fixture("litterae"));
    chronicle = applyIgnisAction(chronicle, "read_manuscript");
    const eventCount = chronicle.eventLedger.length;
    const evidenceCount = Object.keys(chronicle.knowledgeByPersona[personaId as string]!.evidence).length;
    chronicle = applyIgnisAction(chronicle, "read_manuscript");
    expect(chronicle.eventLedger.length).toBe(eventCount);
    expect(Object.keys(chronicle.knowledgeByPersona[personaId as string]!.evidence)).toHaveLength(evidenceCount);
  });
});

import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type EventId, type LocationId, type PersonaId, type Question, type QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyThreeWitnessAction, projectThreeWitnesses } from "./three-witnesses.js";

const personaId = "persona.player" as PersonaId;
const questionId = "question.folio.three-witnesses" as QuestionId;
const officina = "aurea.officina" as LocationId;
const archivum = "aurea.archivum" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const forum = "aurea.forum" as LocationId;

function fixture(location: LocationId, minuteOfDay: number): ChronicleSaveV2 {
  const question: Question = { id: questionId, textKey: "quaestio.folio.what_are_the_three_witnesses", status: "open", relatedClaims: [], relatedEvidence: [], derivedQuestions: [], openedAt: { day: 1, minuteOfDay } };
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.three-witness-route" as ChronicleId,
    activePersonaId: personaId,
    world: { worldId: "world.aurea", timestamp: { day: 1, minuteOfDay }, locations: { [officina]: { id: officina, illumination: "lit", entityIds: [] }, [archivum]: { id: archivum, illumination: "lit", entityIds: [] }, [typographia]: { id: typographia, illumination: "lit", entityIds: [] }, [forum]: { id: forum, illumination: "lit", entityIds: [] } }, entities: {} },
    personas: { [personaId]: { id: personaId, currentLocation: location, inventory: [], capabilities: { observatio: 1, litterae: 2, discernimentum: 2 } } },
    knowledgeByPersona: { [personaId]: { ...createEmptyKnowledgeState(), questions: { [questionId]: question } } },
    eventLedger: [
      { id: "e1" as EventId, type: "TransferBox7Opened", occurredAt: { day: 1, minuteOfDay }, payload: {} },
      { id: "e2" as EventId, type: "RecoveredFolioRead", occurredAt: { day: 1, minuteOfDay }, payload: {} },
      { id: "e3" as EventId, type: "MissingFolioLedgerChecked", occurredAt: { day: 1, minuteOfDay }, payload: {} },
      { id: "e4" as EventId, type: "MiriamIgnisTestimonyReceived", occurredAt: { day: 1, minuteOfDay }, payload: {} },
    ],
    scheduledConsequences: [], contentVersion: "three-witness-route-test",
  };
}

function move(chronicle: ChronicleSaveV2, location: LocationId, minuteOfDay: number): ChronicleSaveV2 {
  return { ...chronicle, world: { ...chronicle.world, timestamp: { ...chronicle.world.timestamp, minuteOfDay } }, personas: { ...chronicle.personas, [personaId]: { ...chronicle.personas[personaId]!, currentLocation: location } } };
}

function compareMemorySources(chronicle: ChronicleSaveV2): ChronicleSaveV2 {
  return {
    ...chronicle,
    eventLedger: [...chronicle.eventLedger, {
      id: `memory-comparison-${chronicle.eventLedger.length + 1}` as EventId,
      type: "MemoryWitnessesCompared",
      occurredAt: chronicle.world.timestamp,
      payload: {},
    }],
  };
}

describe("three witnesses situated route", () => {
  it("requires the material family to be investigated at a physical site", () => {
    const elsewhere = fixture(typographia, 10 * 60);
    expect(projectThreeWitnesses(elsewhere).availableActions).not.toContain("inspect_matter");
    const atArchivum = move(elsewhere, archivum, 10 * 60);
    expect(projectThreeWitnesses(atArchivum).availableActions).toContain("inspect_matter");
  });

  it("blocks word comparison when Typographia is closed", () => {
    expect(projectThreeWitnesses(fixture(typographia, 16 * 60)).availableActions).not.toContain("compare_word");
    expect(projectThreeWitnesses(fixture(typographia, 10 * 60)).availableActions).toContain("compare_word");
  });

  it("requires Forum window and source comparison before memory can conclude the route", () => {
    let chronicle = fixture(archivum, 10 * 60);
    chronicle = applyThreeWitnessAction(chronicle, "inspect_matter");
    chronicle = move(chronicle, typographia, 11 * 60);
    chronicle = applyThreeWitnessAction(chronicle, "compare_word");
    chronicle = move(chronicle, forum, 12 * 60);
    expect(projectThreeWitnesses(chronicle).availableActions).not.toContain("hear_memory");
    chronicle = move(chronicle, forum, 14 * 60);
    expect(projectThreeWitnesses(chronicle).availableActions).not.toContain("hear_memory");
    chronicle = compareMemorySources(chronicle);
    expect(projectThreeWitnesses(chronicle).availableActions).toContain("hear_memory");
    chronicle = applyThreeWitnessAction(chronicle, "hear_memory");
    expect(chronicle.knowledgeByPersona[personaId]?.questions[questionId]?.status).toBe("answered");
    expect(chronicle.eventLedger.some((event) => event.type === "ThreeWitnessesUnderstood")).toBe(true);
  });
});

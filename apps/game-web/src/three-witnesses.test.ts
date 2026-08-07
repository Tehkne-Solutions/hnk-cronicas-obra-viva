import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type EventId, type LocationId, type PersonaId, type Question, type QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyThreeWitnessAction, projectThreeWitnesses } from "./three-witnesses.js";

const personaId = "persona.player" as PersonaId;
const officina = "aurea.officina" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const forum = "aurea.forum" as LocationId;
const questionId = "question.folio.three-witnesses" as QuestionId;

function prerequisiteEvent(type: string, index: number) {
  return {
    id: `event.three-witnesses-fixture.${index}` as EventId,
    type,
    occurredAt: { day: 1, minuteOfDay: 720 },
    payload: {},
  };
}

function fixture(includeMemoryComparison = true): ChronicleSaveV2 {
  const question: Question = {
    id: questionId,
    textKey: "quaestio.folio.what_are_the_three_witnesses",
    status: "open",
    relatedClaims: [],
    relatedEvidence: [],
    derivedQuestions: [],
    openedAt: { day: 1, minuteOfDay: 720 },
  };
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.three-witnesses" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 13 * 60 },
      locations: {
        [officina]: { id: officina, illumination: "lit", entityIds: [] },
        [typographia]: { id: typographia, illumination: "lit", entityIds: [] },
        [forum]: { id: forum, illumination: "lit", entityIds: [] },
      },
      entities: {},
    },
    personas: { [personaId]: { id: personaId, currentLocation: officina, inventory: [], capabilities: { observatio: 2, litterae: 2, discernimentum: 2 } } },
    knowledgeByPersona: { [personaId]: { ...createEmptyKnowledgeState(), questions: { [questionId]: question } } },
    eventLedger: [
      prerequisiteEvent("TransferBox7Opened", 1),
      prerequisiteEvent("RecoveredFolioRead", 2),
      prerequisiteEvent("MissingFolioLedgerChecked", 3),
      prerequisiteEvent("MiriamIgnisTestimonyReceived", 4),
      ...(includeMemoryComparison ? [prerequisiteEvent("MemoryWitnessesCompared", 5)] : []),
    ],
    scheduledConsequences: [],
    contentVersion: "three-witnesses-test",
  };
}

function at(chronicle: ChronicleSaveV2, locationId: LocationId, minuteOfDay = 13 * 60): ChronicleSaveV2 {
  const persona = chronicle.personas[personaId]!;
  return {
    ...chronicle,
    world: { ...chronicle.world, timestamp: { ...chronicle.world.timestamp, minuteOfDay } },
    personas: { ...chronicle.personas, [personaId]: { ...persona, currentLocation: locationId } },
  };
}

describe("Three Witnesses", () => {
  it("does not answer from one or two families", () => {
    let chronicle = fixture();
    chronicle = applyThreeWitnessAction(chronicle, "inspect_matter");
    expect(chronicle.knowledgeByPersona[personaId]?.questions[questionId]?.status).toBe("investigating");
    chronicle = at(chronicle, typographia);
    chronicle = applyThreeWitnessAction(chronicle, "compare_word");
    expect(chronicle.knowledgeByPersona[personaId]?.questions[questionId]?.status).toBe("investigating");
    expect(projectThreeWitnesses(chronicle).complete).toBe(false);
  });

  it("does not integrate memory before witness-source comparison", () => {
    const chronicle = at(fixture(false), forum, 14 * 60);
    expect(projectThreeWitnesses(chronicle).availableActions).not.toContain("hear_memory");
    expect(applyThreeWitnessAction(chronicle, "hear_memory")).toBe(chronicle);
  });

  it("answers only after matter, word and compared memory converge", () => {
    let chronicle = fixture();
    chronicle = applyThreeWitnessAction(chronicle, "inspect_matter");
    chronicle = at(chronicle, typographia);
    chronicle = applyThreeWitnessAction(chronicle, "compare_word");
    chronicle = at(chronicle, forum);
    chronicle = applyThreeWitnessAction(chronicle, "hear_memory");

    const knowledge = chronicle.knowledgeByPersona[personaId]!;
    expect(projectThreeWitnesses(chronicle).complete).toBe(true);
    expect(knowledge.questions[questionId]?.status).toBe("answered");
    expect(knowledge.claims["claim.folio.three-witnesses-principle"]?.value).toEqual(["matter", "word", "memory"]);
    expect(knowledge.evidence["evidence.folio.witness-matter"]?.kind).toBe("artifact");
    expect(knowledge.evidence["evidence.folio.witness-word"]?.kind).toBe("document");
    expect(knowledge.evidence["evidence.folio.witness-memory"]?.kind).toBe("testimony");
    expect(chronicle.eventLedger.some((event) => event.type === "ThreeWitnessesUnderstood")).toBe(true);
  });

  it("is idempotent after a family has been recorded", () => {
    let chronicle = fixture();
    chronicle = applyThreeWitnessAction(chronicle, "inspect_matter");
    const events = chronicle.eventLedger.length;
    chronicle = applyThreeWitnessAction(chronicle, "inspect_matter");
    expect(chronicle.eventLedger).toHaveLength(events);
  });
});

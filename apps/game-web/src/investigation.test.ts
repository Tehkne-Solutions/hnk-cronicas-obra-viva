import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  type ChronicleId,
  type LocationId,
  type PersonaId,
  type Question,
  type QuestionId,
} from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyIgnisInvestigationAction, projectIgnisInvestigation } from "./investigation.js";

const personaId = "persona.player" as PersonaId;
const archivum = "aurea.archivum" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const questionId = "question.ignis.first-flame" as QuestionId;

function fixture(): ChronicleSaveV2 {
  const knowledge = createEmptyKnowledgeState();
  const question: Question = {
    id: questionId,
    textKey: "quaestio.ignis.what_sustains_the_flame",
    status: "open",
    relatedClaims: [],
    relatedEvidence: [],
    derivedQuestions: [],
    openedAt: { day: 1, minuteOfDay: 465 },
  };
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.investigation" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 8 * 60 },
      locations: {
        [archivum]: { id: archivum, illumination: "lit", entityIds: [] },
        [typographia]: { id: typographia, illumination: "lit", entityIds: [] },
      },
      entities: {},
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: archivum,
        inventory: [],
        capabilities: { observatio: 1, litterae: 0, discernimentum: 0 },
      },
    },
    knowledgeByPersona: {
      [personaId]: {
        ...knowledge,
        questions: { [questionId]: question },
      },
    },
    eventLedger: [],
    scheduledConsequences: [],
    contentVersion: "investigation-test",
  };
}

describe("IGNIS QUAESTIO investigation", () => {
  it("uses two independent sources and only answers after convergence", () => {
    let chronicle = fixture();
    expect(projectIgnisInvestigation(chronicle).availableActions).toContain("archivum_catalogue");

    chronicle = applyIgnisInvestigationAction(chronicle, "archivum_catalogue");
    const afterArchivum = chronicle.knowledgeByPersona[personaId]!.questions[questionId]!;
    expect(afterArchivum.status).toBe("partially_answered");
    expect(afterArchivum.relatedEvidence).toContain("evidence.ignis.archivum-catalogue");

    const eventCount = chronicle.eventLedger.length;
    chronicle = applyIgnisInvestigationAction(chronicle, "archivum_catalogue");
    expect(chronicle.eventLedger).toHaveLength(eventCount);

    chronicle = {
      ...chronicle,
      world: { ...chronicle.world, timestamp: { day: 1, minuteOfDay: 8 * 60 + 30 } },
      personas: {
        ...chronicle.personas,
        [personaId]: { ...chronicle.personas[personaId]!, currentLocation: typographia },
      },
    };
    expect(projectIgnisInvestigation(chronicle).availableActions).not.toContain("typographia_lamp_record");
    const beforeClosedAttempt = chronicle;
    chronicle = applyIgnisInvestigationAction(chronicle, "typographia_lamp_record");
    expect(chronicle).toBe(beforeClosedAttempt);

    chronicle = { ...chronicle, world: { ...chronicle.world, timestamp: { day: 1, minuteOfDay: 9 * 60 } } };
    expect(projectIgnisInvestigation(chronicle).availableActions).toContain("typographia_lamp_record");
    chronicle = applyIgnisInvestigationAction(chronicle, "typographia_lamp_record");

    const answered = chronicle.knowledgeByPersona[personaId]!.questions[questionId]!;
    expect(answered.status).toBe("answered");
    expect(answered.relatedEvidence).toContain("evidence.ignis.typographia-lamp-record");
    expect(projectIgnisInvestigation(chronicle).complete).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  type ChronicleId,
  type EntityId,
  type LocationId,
  type PersonaId,
  type Question,
  type QuestionId,
} from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import {
  askMiriamAboutIgnis,
  integrateAnsweredIgnisQuaestio,
  projectMiriamIgnisConversation,
} from "./consequence.js";
import { projectChronicleLiber } from "./liber.js";

const personaId = "persona.player" as PersonaId;
const archivum = "aurea.archivum" as LocationId;
const firstQuestionId = "question.ignis.first-flame" as QuestionId;
const derivedQuestionId = "question.ignis.missing-folio" as QuestionId;

function fixture(): ChronicleSaveV2 {
  const empty = createEmptyKnowledgeState();
  const question: Question = {
    id: firstQuestionId,
    textKey: "quaestio.ignis.what_sustains_the_flame",
    status: "answered",
    relatedClaims: [],
    relatedEvidence: [],
    derivedQuestions: [],
    openedAt: { day: 1, minuteOfDay: 465 },
  };
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.consequence" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 10 * 60 },
      locations: { [archivum]: { id: archivum, illumination: "lit", entityIds: [] } },
      entities: { "npc.miriam": { id: "npc.miriam" as EntityId, kind: "character", state: {} } },
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
      [personaId]: { ...empty, questions: { [firstQuestionId]: question } },
    },
    eventLedger: [],
    scheduledConsequences: [],
    contentVersion: "consequence-test",
  };
}

describe("answered IGNIS QUAESTIO consequences", () => {
  it("progresses practiced capabilities once and opens a derived question", () => {
    let chronicle = integrateAnsweredIgnisQuaestio(fixture());
    expect(chronicle.personas[personaId]!.capabilities.litterae).toBe(1);
    expect(chronicle.personas[personaId]!.capabilities.discernimentum).toBe(1);
    expect(chronicle.knowledgeByPersona[personaId]!.questions[derivedQuestionId]?.status).toBe("open");
    expect(chronicle.knowledgeByPersona[personaId]!.questions[firstQuestionId]?.derivedQuestions).toContain(derivedQuestionId);
    const events = chronicle.eventLedger.length;
    chronicle = integrateAnsweredIgnisQuaestio(chronicle);
    expect(chronicle.eventLedger).toHaveLength(events);
    expect(chronicle.personas[personaId]!.capabilities.litterae).toBe(1);
  });

  it("does not expose Miriam conversation before integration or outside her Archivum window", () => {
    expect(projectMiriamIgnisConversation(fixture()).available).toBe(false);
    let chronicle = integrateAnsweredIgnisQuaestio(fixture());
    chronicle = { ...chronicle, world: { ...chronicle.world, timestamp: { day: 1, minuteOfDay: 12 * 60 } } };
    expect(projectMiriamIgnisConversation(chronicle).available).toBe(false);
    chronicle = { ...chronicle, world: { ...chronicle.world, timestamp: { day: 1, minuteOfDay: 10 * 60 } } };
    expect(projectMiriamIgnisConversation(chronicle).available).toBe(true);
  });

  it("lets demonstrated inquiry unlock one Miriam testimony without exposing her hidden knowledge", () => {
    let chronicle = integrateAnsweredIgnisQuaestio(fixture());
    expect(projectMiriamIgnisConversation(chronicle).available).toBe(true);
    chronicle = askMiriamAboutIgnis(chronicle);
    const knowledge = chronicle.knowledgeByPersona[personaId]!;
    expect(knowledge.claims["claim.miriam.ignis-missing-folio"]?.status).toBe("reported");
    expect(knowledge.evidence["evidence.miriam.ignis-missing-folio"]?.kind).toBe("testimony");
    expect(knowledge.questions[derivedQuestionId]?.status).toBe("investigating");
    expect(Object.values(knowledge.claims).some((claim) => claim.predicate === "ignis_missing_folio_last_seen")).toBe(false);
    expect(projectMiriamIgnisConversation(chronicle).available).toBe(false);
  });

  it("projects the integrated answer and Miriam encounter into DIARIUM", () => {
    let chronicle = integrateAnsweredIgnisQuaestio(fixture());
    chronicle = askMiriamAboutIgnis(chronicle);
    const liber = projectChronicleLiber(chronicle);
    expect(liber.diarium.map((entry) => entry.id)).toContain("diarium.ignis.first-quaestio-answered");
    expect(liber.diarium.map((entry) => entry.id)).toContain("diarium.miriam.ignis-testimony");
  });
});

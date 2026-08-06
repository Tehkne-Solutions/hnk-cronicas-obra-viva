import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type EntityId, type LocationId, type PersonaId, type Question, type QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { integrateAnsweredIgnisQuaestio, projectMiriamIgnisConversation } from "./consequence.js";

const personaId = "persona.player" as PersonaId;
const archivum = "aurea.archivum" as LocationId;
const questionId = "question.ignis.first-flame" as QuestionId;

function fixture(): ChronicleSaveV2 {
  const question: Question = { id: questionId, textKey: "quaestio.ignis.what_sustains_the_flame", status: "answered", relatedClaims: [], relatedEvidence: [], derivedQuestions: [], openedAt: { day: 1, minuteOfDay: 465 } };
  return { schemaVersion: 2, chronicleId: "chronicle.ui-gate" as ChronicleId, activePersonaId: personaId, world: { worldId: "world.aurea", timestamp: { day: 1, minuteOfDay: 10 * 60 }, locations: { [archivum]: { id: archivum, illumination: "lit", entityIds: [] } }, entities: { "npc.miriam": { id: "npc.miriam" as EntityId, kind: "character", state: {} } } }, personas: { [personaId]: { id: personaId, currentLocation: archivum, inventory: [], capabilities: { observatio: 1, litterae: 0, discernimentum: 0 } } }, knowledgeByPersona: { [personaId]: { ...createEmptyKnowledgeState(), questions: { [questionId]: question } } }, eventLedger: [], scheduledConsequences: [], contentVersion: "ui-gate-test" };
}

describe("Miriam contextual UI gate", () => {
  it("only becomes actionable after the answered QUAESTIO is integrated", () => {
    const before = fixture();
    expect(projectMiriamIgnisConversation(before).available).toBe(false);
    const after = integrateAnsweredIgnisQuaestio(before);
    expect(projectMiriamIgnisConversation(after).available).toBe(true);
    expect(after.knowledgeByPersona[personaId]?.questions["question.ignis.missing-folio"]?.status).toBe("open");
  });
});

import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type EntityId, type LocationId, type PersonaId, type Question, type QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { askMiriamAboutIgnis, askMiriamWhereFolioWasLastSeen, integrateAnsweredIgnisQuaestio, projectMiriamIgnisConversation } from "./consequence.js";
import { applyMissingFolioAction, projectMissingFolioInvestigation } from "./missing-folio.js";

const personaId = "persona.player" as PersonaId;
const archivum = "aurea.archivum" as LocationId;
const forum = "aurea.forum" as LocationId;
const firstQuestionId = "question.ignis.first-flame" as QuestionId;

function fixture(): ChronicleSaveV2 {
  const question: Question = { id: firstQuestionId, textKey: "quaestio.ignis.what_sustains_the_flame", status: "answered", relatedClaims: [], relatedEvidence: [], derivedQuestions: [], openedAt: { day: 1, minuteOfDay: 465 } };
  return { schemaVersion: 2, chronicleId: "chronicle.missing-folio" as ChronicleId, activePersonaId: personaId, world: { worldId: "world.aurea", timestamp: { day: 1, minuteOfDay: 10 * 60 }, locations: { [archivum]: { id: archivum, illumination: "lit", entityIds: [] }, [forum]: { id: forum, illumination: "lit", entityIds: [] } }, entities: { "npc.miriam": { id: "npc.miriam" as EntityId, kind: "character", state: {} } } }, personas: { [personaId]: { id: personaId, currentLocation: archivum, inventory: [], capabilities: { observatio: 1, litterae: 0, discernimentum: 0 } } }, knowledgeByPersona: { [personaId]: { ...createEmptyKnowledgeState(), questions: { [firstQuestionId]: question } } }, eventLedger: [], scheduledConsequences: [], contentVersion: "missing-folio-test" };
}

describe("missing folio investigation", () => {
  it("keeps conflicting clues side by side instead of silently choosing one", () => {
    let chronicle = integrateAnsweredIgnisQuaestio(fixture());
    chronicle = askMiriamAboutIgnis(chronicle);
    chronicle = applyMissingFolioAction(chronicle, "inspect_transfer_ledger");
    chronicle = { ...chronicle, personas: { ...chronicle.personas, [personaId]: { ...chronicle.personas[personaId]!, currentLocation: forum } } };
    chronicle = applyMissingFolioAction(chronicle, "follow_forum_rumour");

    const knowledge = chronicle.knowledgeByPersona[personaId]!;
    expect(knowledge.claims["claim.folio.transfer-box-7"]?.value).toBe("archivum.transfer-box.7");
    expect(knowledge.claims["claim.folio.rumour-box-3"]?.value).toBe("archivum.transfer-box.3");
    expect(chronicle.eventLedger.some((event) => event.type === "MissingFolioEvidenceCompared")).toBe(true);
    expect(projectMissingFolioInvestigation(chronicle).complete).toBe(true);
  });

  it("unlocks Miriam's deeper disclosure only after evidence comparison", () => {
    let chronicle = integrateAnsweredIgnisQuaestio(fixture());
    chronicle = askMiriamAboutIgnis(chronicle);
    expect(projectMiriamIgnisConversation(chronicle).deeperAvailable).toBe(false);

    chronicle = applyMissingFolioAction(chronicle, "inspect_transfer_ledger");
    chronicle = { ...chronicle, personas: { ...chronicle.personas, [personaId]: { ...chronicle.personas[personaId]!, currentLocation: forum } } };
    chronicle = applyMissingFolioAction(chronicle, "follow_forum_rumour");
    chronicle = { ...chronicle, personas: { ...chronicle.personas, [personaId]: { ...chronicle.personas[personaId]!, currentLocation: archivum } } };

    expect(projectMiriamIgnisConversation(chronicle).deeperAvailable).toBe(true);
    chronicle = askMiriamWhereFolioWasLastSeen(chronicle);
    expect(chronicle.knowledgeByPersona[personaId]?.claims["claim.miriam.folio-last-seen"]?.value).toBe("archivum.transfer-box.7");
    expect(chronicle.knowledgeByPersona[personaId]?.questions["question.ignis.missing-folio"]?.status).toBe("partially_answered");
    expect(projectMiriamIgnisConversation(chronicle).deeperAvailable).toBe(false);
  });
});

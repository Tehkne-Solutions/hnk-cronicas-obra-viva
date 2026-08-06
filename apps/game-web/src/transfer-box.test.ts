import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState, type ChronicleId, type EntityId, type LocationId, type PersonaId, type Question, type QuestionId } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyTransferBoxAction, projectTransferBox } from "./transfer-box.js";

const personaId = "persona.player" as PersonaId;
const archivum = "aurea.archivum" as LocationId;
const questionId = "question.ignis.missing-folio" as QuestionId;

function fixture(): ChronicleSaveV2 {
  const empty = createEmptyKnowledgeState();
  const question: Question = {
    id: questionId,
    textKey: "quaestio.ignis.where_is_missing_folio",
    status: "partially_answered",
    relatedClaims: [],
    relatedEvidence: [],
    derivedQuestions: [],
    openedAt: { day: 1, minuteOfDay: 600 },
  };
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.transfer-box" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 660 },
      locations: { [archivum]: { id: archivum, illumination: "lit", entityIds: [] } },
      entities: {},
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: archivum,
        inventory: [],
        capabilities: { observatio: 1, litterae: 1, discernimentum: 1 },
      },
    },
    knowledgeByPersona: {
      [personaId]: {
        ...empty,
        claims: {
          "claim.folio.transfer-box-7": {
            id: "claim.folio.transfer-box-7" as never,
            subjectId: "document.ignis.missing-folio" as EntityId,
            predicate: "last_transfer_box",
            value: "archivum.transfer-box.7",
            status: "reported",
            createdAt: { day: 1, minuteOfDay: 620 },
            sourceRefs: [],
          },
          "claim.folio.rumour-box-3": {
            id: "claim.folio.rumour-box-3" as never,
            subjectId: "document.ignis.missing-folio" as EntityId,
            predicate: "last_transfer_box",
            value: "archivum.transfer-box.3",
            status: "reported",
            createdAt: { day: 1, minuteOfDay: 630 },
            sourceRefs: [],
          },
          "claim.miriam.folio-last-seen": {
            id: "claim.miriam.folio-last-seen" as never,
            subjectId: "npc.miriam" as EntityId,
            predicate: "ignis_missing_folio_last_seen",
            value: "archivum.transfer-box.7",
            status: "reported",
            createdAt: { day: 1, minuteOfDay: 650 },
            sourceRefs: [],
          },
        },
        questions: { [questionId]: question },
      },
    },
    eventLedger: [{ id: "event.miriam.deep" as never, type: "MiriamFolioLocationTestimonyReceived", occurredAt: { day: 1, minuteOfDay: 650 }, payload: {} }],
    scheduledConsequences: [],
    contentVersion: "transfer-box-test",
  };
}

describe("transfer box 7 physical verification", () => {
  it("materializes the box as a world object before opening it", () => {
    let chronicle = fixture();
    expect(projectTransferBox(chronicle).availableActions).toEqual(["locate_box_7"]);
    chronicle = applyTransferBoxAction(chronicle, "locate_box_7");
    const box = chronicle.world.entities["archivum.transfer-box.7"];
    expect(box?.kind).toBe("object");
    expect(box?.locationId).toBe(archivum);
    expect(box?.state.opened).toBe(false);
    expect(projectTransferBox(chronicle).availableActions).toEqual(["open_box_7"]);
  });

  it("uses direct observation to answer the QUAESTIO, support box 7 sources and contradict box 3 rumour", () => {
    let chronicle = fixture();
    chronicle = applyTransferBoxAction(chronicle, "locate_box_7");
    chronicle = applyTransferBoxAction(chronicle, "open_box_7");

    const knowledge = chronicle.knowledgeByPersona[personaId]!;
    const evidence = knowledge.evidence["evidence.folio.box-7-direct-observation"];
    expect(knowledge.questions[questionId]?.status).toBe("answered");
    expect(knowledge.claims["claim.folio.box-7-contains-folio"]?.status).toBe("observed");
    expect(evidence?.kind).toBe("observation");
    expect(evidence?.supports).toContain("claim.folio.transfer-box-7");
    expect(evidence?.supports).toContain("claim.miriam.folio-last-seen");
    expect(evidence?.contradicts).toContain("claim.folio.rumour-box-3");
    expect(chronicle.world.entities["archivum.transfer-box.7"]?.state.opened).toBe(true);
    expect(chronicle.eventLedger.some((event) => event.type === "TransferBox7Opened")).toBe(true);
  });
});

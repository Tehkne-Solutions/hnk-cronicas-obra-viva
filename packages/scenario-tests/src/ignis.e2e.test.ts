import { describe, expect, it } from "vitest";
import {
  createEmptyKnowledgeState,
  type ChronicleId,
  type ClaimId,
  type EntityId,
  type EvidenceId,
  type KnowledgeNodeId,
  type KnowledgeState,
  type LocationId,
  type PersonaId,
  type QuestionId,
  type WorldState,
} from "@hnk/domain";
import {
  advanceWickSaturation,
  resolveLampCombustion,
  resolveOperation,
  type LampCombustionState,
} from "@hnk/alchemy-engine";
import { applyWorldLightEvents, deriveLightEvents } from "@hnk/world-engine";
import { resolvePerception } from "@hnk/perception-engine";
import { recordObservation, updateQuestionStatus } from "@hnk/knowledge-engine";
import {
  createLiberState,
  recordDiariumEntry,
  recordExperiment,
  syncLiberKnowledge,
} from "@hnk/liber-engine";
import {
  CHRONICLE_SCHEMA_VERSION,
  MemoryChronicleStorage,
  type ChronicleSaveV1,
} from "@hnk/save-contract";

const workshopId = "officina-ardel" as LocationId;
const lampId = "lamp-01" as EntityId;
const manuscriptId = "manuscript-01" as EntityId;
const personaId = "persona-01" as PersonaId;
const chronicleId = "chronicle-ignis-01" as ChronicleId;
const questionId = "question.lamp.light" as QuestionId;

function initialWorld(): WorldState {
  return {
    worldId: "ignis-fixture",
    timestamp: { day: 1, minuteOfDay: 60 },
    locations: {
      [workshopId as string]: {
        id: workshopId,
        illumination: "dark",
        entityIds: [lampId, manuscriptId],
      },
    },
    entities: {
      [lampId as string]: {
        id: lampId,
        kind: "object",
        locationId: workshopId,
        state: {},
      },
      [manuscriptId as string]: {
        id: manuscriptId,
        kind: "document",
        locationId: workshopId,
        state: { canonicalAuthor: "hidden-world-truth" },
      },
    },
  };
}

describe("IGNIS E2E Gate", () => {
  it("runs darkness → experiment → combustion → perception → knowledge → LIBER → save/reload", async () => {
    const persona = {
      id: personaId,
      currentLocation: workshopId,
      inventory: [] as EntityId[],
      capabilities: { observatio: 1, litterae: 0, discernimentum: 0 },
    };

    let world = initialWorld();
    let knowledge: KnowledgeState = {
      ...createEmptyKnowledgeState(),
      questions: {
        [questionId as string]: {
          id: questionId,
          textKey: "question.lamp.light",
          status: "investigating",
          relatedClaims: [],
          relatedEvidence: [],
          derivedQuestions: [],
          openedAt: world.timestamp,
        },
      },
    };

    const manuscriptCandidate = {
      subjectId: manuscriptId,
      conceptId: "manuscript.visible",
      requirements: [{ minimumIllumination: "lit" as const }],
    };

    expect(
      resolvePerception({ observer: persona, world, knowledge, candidates: [manuscriptCandidate] }),
    ).toHaveLength(0);

    const oil = {
      id: "oleum-01" as EntityId,
      materialId: "oleum" as const,
      quantity: 1,
      state: {},
    };

    expect(
      resolveOperation({
        at: world.timestamp,
        operation: "add",
        actorId: personaId as unknown as EntityId,
        targetId: lampId,
        material: oil,
      }).events[0]?.type,
    ).toBe("MaterialAdded");

    const spark = resolveOperation({
      at: world.timestamp,
      operation: "strike",
      actorId: personaId as unknown as EntityId,
      targetId: "silex-01" as EntityId,
      instrumentId: "ferrum-01" as EntityId,
      targetMaterialId: "silex",
      instrumentMaterialId: "ferrum",
    });
    expect(spark.events[0]?.type).toBe("SparkProduced");

    let lamp: LampCombustionState = {
      lampId,
      reservoirMaterialId: "oleum",
      wickMaterialId: "linum",
      wickSaturation: "dry",
      ignitionState: "unlit",
    };
    lamp = advanceWickSaturation(lamp, 5);
    expect(lamp.wickSaturation).toBe("saturated");

    const combustion = resolveLampCombustion({ sparkApplied: true, state: lamp });
    expect(combustion.events[0]?.type).toBe("CombustionStarted");

    const lightEvents = deriveLightEvents({ combustion, sourceId: lampId, locationId: workshopId });
    world = applyWorldLightEvents(world, lightEvents);
    expect(world.locations[workshopId as string]?.illumination).toBe("lit");

    const perceived = resolvePerception({
      observer: persona,
      world,
      knowledge,
      candidates: [manuscriptCandidate],
    });
    expect(perceived).toHaveLength(1);

    knowledge = recordObservation(knowledge, {
      perceived: perceived[0]!,
      at: world.timestamp,
      nodeId: "knowledge.manuscript.visible" as KnowledgeNodeId,
      evidenceId: "evidence.manuscript.visible" as EvidenceId,
      claimId: "claim.manuscript.visible" as ClaimId,
    });

    expect(knowledge.claims["claim.manuscript.visible"]?.value).toBe("manuscript.visible");
    expect(JSON.stringify(knowledge)).not.toContain("hidden-world-truth");

    knowledge = updateQuestionStatus(
      knowledge,
      questionId,
      "answered",
      "evidence.manuscript.visible" as EvidenceId,
    );
    expect(knowledge.questions[questionId as string]?.status).toBe("answered");

    let liber = createLiberState();
    liber = recordDiariumEntry(liber, {
      id: "day1-first-flame",
      at: world.timestamp,
      titleKey: "diarium.day1.first_flame",
      eventRefs: ["CombustionStarted", "LocationIlluminationChanged"],
    });
    liber = recordExperiment(liber, {
      id: "experiment.lamp.01",
      at: world.timestamp,
      inputRefs: ["oleum", "linum", "silex", "ferrum"],
      actionRefs: ["add", "wait", "strike"],
      outcomeRefs: ["combustion.started", "location.lit", "manuscript.visible"],
      evidenceRefs: ["evidence.manuscript.visible"],
    });
    liber = syncLiberKnowledge(liber, knowledge);
    expect(liber.diarium).toHaveLength(1);
    expect(liber.experiments).toHaveLength(1);
    expect(liber.questionIds).toContain(questionId as string);

    const save: ChronicleSaveV1 = {
      schemaVersion: CHRONICLE_SCHEMA_VERSION,
      chronicleId,
      activePersonaId: personaId,
      world,
      personas: { [personaId as string]: persona },
      knowledgeByPersona: { [personaId as string]: knowledge },
      eventLedger: [],
      contentVersion: "ignis-e2e-1",
    };

    const storage = new MemoryChronicleStorage();
    await storage.save(chronicleId, save);
    const loaded = await storage.load(chronicleId);

    expect(loaded).not.toBeNull();
    expect(loaded?.world).toEqual(world);
    expect(loaded?.knowledgeByPersona[personaId as string]).toEqual(knowledge);

    const rebuiltLiber = syncLiberKnowledge(liber, loaded!.knowledgeByPersona[personaId as string]!);
    expect(rebuiltLiber.questionIds).toEqual(liber.questionIds);
    expect(rebuiltLiber.materiaNodeIds).toEqual(liber.materiaNodeIds);
  });
});

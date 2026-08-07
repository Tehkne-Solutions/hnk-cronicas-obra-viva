import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  advanceWorldTimestamp,
  createEmptyKnowledgeState,
  type ChronicleId,
  type EntityId,
  type LocationId,
  type PersonaId,
} from "@hnk/domain";
import { travelChronicle } from "@hnk/aurea-navigation";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyProloguePath } from "./prologue.js";
import { applyIgnisAction } from "./ignis.js";
import { applyIgnisInvestigationAction } from "./investigation.js";
import {
  askMiriamAboutIgnis,
  askMiriamWhereFolioWasLastSeen,
  integrateAnsweredIgnisQuaestio,
} from "./consequence.js";
import { applyMissingFolioAction } from "./missing-folio.js";
import { applyTransferBoxAction } from "./transfer-box.js";
import { readRecoveredFolio } from "./recovered-folio.js";
import { applyMemoryWitnessAction } from "./memory-witnesses.js";
import { applyThreeWitnessAction, projectThreeWitnesses } from "./three-witnesses.js";
import { projectPlayableLoop } from "./playable-loop.js";
import { deleteChronicleFromBrowser, loadChronicleFromBrowser, saveChronicleToBrowser } from "./storage.js";

const personaId = "persona.player" as PersonaId;
const miriamId = "npc.miriam" as EntityId;
const officina = "aurea.officina" as LocationId;
const archivum = "aurea.archivum" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const forum = "aurea.forum" as LocationId;

function freshChronicle(): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.full-playthrough" as ChronicleId,
    activePersonaId: personaId,
    world: {
      worldId: "world.aurea",
      timestamp: { day: 1, minuteOfDay: 7 * 60 + 45 },
      locations: {
        [officina]: { id: officina, illumination: "dim", entityIds: [] },
        [archivum]: { id: archivum, illumination: "lit", entityIds: [] },
        [typographia]: { id: typographia, illumination: "lit", entityIds: [] },
        [forum]: { id: forum, illumination: "lit", entityIds: [] },
      },
      entities: { [miriamId]: { id: miriamId, kind: "character", state: {} } },
    },
    personas: {
      [personaId]: {
        id: personaId,
        currentLocation: officina,
        inventory: [],
        capabilities: { observatio: 0, litterae: 0, discernimentum: 0 },
      },
    },
    knowledgeByPersona: { [personaId]: createEmptyKnowledgeState() },
    eventLedger: [],
    scheduledConsequences: [],
    contentVersion: "full-playthrough-gate-1",
  };
}

function travel(chronicle: ChronicleSaveV2, to: LocationId, minutes: number): ChronicleSaveV2 {
  const from = chronicle.personas[personaId]!.currentLocation;
  return travelChronicle(chronicle, personaId, { from, to, travelMinutes: minutes }).chronicle;
}

function waitTo(chronicle: ChronicleSaveV2, minuteOfDay: number): ChronicleSaveV2 {
  const delta = minuteOfDay - chronicle.world.timestamp.minuteOfDay;
  if (delta <= 0) return chronicle;
  return {
    ...chronicle,
    world: { ...chronicle.world, timestamp: advanceWorldTimestamp(chronicle.world.timestamp, delta) },
  };
}

function expectRouteOpen(chronicle: ChronicleSaveV2) {
  const current = chronicle.personas[personaId]!.currentLocation;
  const destinations = [officina, archivum, typographia, forum].filter((location) => location !== current);
  expect(destinations.length).toBe(3);
}

describe("FULL PLAYTHROUGH GATE", () => {
  it("plays from prologue to ThreeWitnessesUnderstood across time, travel and browser reload without a dead-end", async () => {
    await deleteChronicleFromBrowser("chronicle.full-playthrough");
    let chronicle = freshChronicle();

    chronicle = applyProloguePath(chronicle, "litterae");
    chronicle = applyIgnisAction(chronicle, "add_oil");
    chronicle = applyIgnisAction(chronicle, "place_wick");
    chronicle = applyIgnisAction(chronicle, "wait_wick");
    chronicle = applyIgnisAction(chronicle, "strike");
    chronicle = applyIgnisAction(chronicle, "read_manuscript");
    expect(chronicle.knowledgeByPersona[personaId]?.questions["question.ignis.first-flame"]?.status).toBe("open");
    expectRouteOpen(chronicle);

    chronicle = travel(chronicle, archivum, 15);
    chronicle = applyIgnisInvestigationAction(chronicle, "archivum_catalogue");
    chronicle = travel(chronicle, typographia, 12);
    expect(chronicle.world.timestamp.minuteOfDay).toBeLessThan(9 * 60);
    expect(projectPlayableLoop(chronicle).actions.some((action) => action.id === "three:compare_word")).toBe(false);
    chronicle = waitTo(chronicle, 9 * 60);
    chronicle = applyIgnisInvestigationAction(chronicle, "typographia_lamp_record");
    expect(chronicle.knowledgeByPersona[personaId]?.questions["question.ignis.first-flame"]?.status).toBe("answered");

    chronicle = integrateAnsweredIgnisQuaestio(chronicle);
    expect(chronicle.knowledgeByPersona[personaId]?.questions["question.ignis.missing-folio"]?.status).toBe("open");
    chronicle = travel(chronicle, archivum, 12);
    chronicle = askMiriamAboutIgnis(chronicle);
    expect(chronicle.eventLedger.some((event) => event.type === "MiriamIgnisTestimonyReceived")).toBe(true);
    expectRouteOpen(chronicle);

    chronicle = applyMissingFolioAction(chronicle, "inspect_transfer_ledger");
    chronicle = travel(chronicle, forum, 14);
    chronicle = applyMissingFolioAction(chronicle, "follow_forum_rumour");
    expect(chronicle.eventLedger.some((event) => event.type === "MissingFolioEvidenceCompared")).toBe(true);

    await saveChronicleToBrowser(chronicle);
    const reloaded = await loadChronicleFromBrowser(chronicle.chronicleId as string);
    expect(reloaded).not.toBeNull();
    chronicle = reloaded!;
    expect(chronicle.personas[personaId]?.currentLocation).toBe(forum);
    expect(chronicle.eventLedger.some((event) => event.type === "MissingFolioEvidenceCompared")).toBe(true);
    expectRouteOpen(chronicle);

    chronicle = travel(chronicle, archivum, 14);
    chronicle = askMiriamWhereFolioWasLastSeen(chronicle);
    expect(chronicle.eventLedger.some((event) => event.type === "MiriamFolioLocationTestimonyReceived")).toBe(true);
    chronicle = applyTransferBoxAction(chronicle, "locate_box_7");
    chronicle = applyTransferBoxAction(chronicle, "open_box_7");
    expect(chronicle.knowledgeByPersona[personaId]?.questions["question.ignis.missing-folio"]?.status).toBe("answered");

    chronicle = readRecoveredFolio(chronicle);
    expect(chronicle.knowledgeByPersona[personaId]?.questions["question.folio.three-witnesses"]?.status).toBe("open");
    chronicle = applyThreeWitnessAction(chronicle, "inspect_matter");

    chronicle = travel(chronicle, typographia, 12);
    chronicle = applyThreeWitnessAction(chronicle, "compare_word");
    expect(projectThreeWitnesses(chronicle).families.word).toBe(true);

    chronicle = travel(chronicle, forum, 10);
    chronicle = waitTo(chronicle, 13 * 60);
    chronicle = applyMemoryWitnessAction(chronicle, "hear_tomas");
    chronicle = applyMemoryWitnessAction(chronicle, "hear_beatrice");
    expect(projectThreeWitnesses(chronicle).availableActions).not.toContain("hear_memory");
    chronicle = applyMemoryWitnessAction(chronicle, "compare_memories");
    expect(projectThreeWitnesses(chronicle).availableActions).toContain("hear_memory");
    chronicle = applyThreeWitnessAction(chronicle, "hear_memory");

    const knowledge = chronicle.knowledgeByPersona[personaId]!;
    expect(knowledge.questions["question.folio.three-witnesses"]?.status).toBe("answered");
    expect(chronicle.eventLedger.some((event) => event.type === "ThreeWitnessesUnderstood")).toBe(true);
    expect(knowledge.evidence["evidence.memory.source-comparison"]?.payload.independenceAssessment).toBe("beatrice_not_independent");
    expectRouteOpen(chronicle);

    await deleteChronicleFromBrowser(chronicle.chronicleId as string);
  });
});

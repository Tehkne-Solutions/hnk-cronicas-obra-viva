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
import { applyProloguePath, type ProloguePath } from "./prologue.js";
import { applyIgnisAction } from "./ignis.js";
import { applyIgnisInvestigationAction } from "./investigation.js";
import { askMiriamAboutIgnis, askMiriamWhereFolioWasLastSeen, integrateAnsweredIgnisQuaestio } from "./consequence.js";
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
const locations = [officina, archivum, typographia, forum] as const;

type ReloadStage = "none" | "after-ignis" | "after-rumour" | "after-folio";
interface Scenario {
  readonly id: string;
  readonly path: ProloguePath;
  readonly firstIgnisSource: "archivum" | "typographia";
  readonly reloadStage: ReloadStage;
  readonly extraWaitMinutes: number;
}

function freshChronicle(id: string): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: id as ChronicleId,
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
    contentVersion: "campaign-simulation-gate-1",
  };
}

function travel(chronicle: ChronicleSaveV2, to: LocationId, minutes = 15): ChronicleSaveV2 {
  const from = chronicle.personas[personaId]!.currentLocation;
  if (from === to) return chronicle;
  return travelChronicle(chronicle, personaId, { from, to, travelMinutes: minutes }).chronicle;
}

function wait(chronicle: ChronicleSaveV2, minutes: number): ChronicleSaveV2 {
  if (minutes <= 0) return chronicle;
  return { ...chronicle, world: { ...chronicle.world, timestamp: advanceWorldTimestamp(chronicle.world.timestamp, minutes) } };
}

function waitUntil(chronicle: ChronicleSaveV2, minuteOfDay: number): ChronicleSaveV2 {
  if (chronicle.world.timestamp.minuteOfDay >= minuteOfDay) return chronicle;
  return wait(chronicle, minuteOfDay - chronicle.world.timestamp.minuteOfDay);
}

function assertHealth(chronicle: ChronicleSaveV2): void {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  expect(persona).toBeDefined();
  expect(locations).toContain(persona!.currentLocation as typeof locations[number]);
  expect(chronicle.world.locations[persona!.currentLocation as string]).toBeDefined();
  expect(chronicle.knowledgeByPersona[chronicle.activePersonaId as string]).toBeDefined();
  const ids = chronicle.eventLedger.map((event) => event.id as string);
  expect(new Set(ids).size).toBe(ids.length);
  expect(chronicle.world.timestamp.day).toBeGreaterThan(0);
  expect(chronicle.world.timestamp.minuteOfDay).toBeGreaterThanOrEqual(0);
  expect(chronicle.world.timestamp.minuteOfDay).toBeLessThan(24 * 60);
  expect(projectPlayableLoop(chronicle)).toBeDefined();
}

async function maybeReload(chronicle: ChronicleSaveV2, stage: ReloadStage, target: ReloadStage): Promise<ChronicleSaveV2> {
  if (stage !== target) return chronicle;
  await saveChronicleToBrowser(chronicle);
  const loaded = await loadChronicleFromBrowser(chronicle.chronicleId as string);
  expect(loaded).not.toBeNull();
  assertHealth(loaded!);
  return loaded!;
}

async function runScenario(scenario: Scenario): Promise<ChronicleSaveV2> {
  let chronicle = freshChronicle(`chronicle.sim.${scenario.id}`);
  await deleteChronicleFromBrowser(chronicle.chronicleId as string);

  chronicle = applyProloguePath(chronicle, scenario.path);
  chronicle = applyIgnisAction(chronicle, "add_oil");
  chronicle = applyIgnisAction(chronicle, "place_wick");
  chronicle = applyIgnisAction(chronicle, "wait_wick");
  chronicle = applyIgnisAction(chronicle, "strike");
  chronicle = applyIgnisAction(chronicle, "read_manuscript");
  assertHealth(chronicle);
  chronicle = await maybeReload(chronicle, scenario.reloadStage, "after-ignis");

  if (scenario.firstIgnisSource === "archivum") {
    chronicle = travel(chronicle, archivum);
    chronicle = applyIgnisInvestigationAction(chronicle, "archivum_catalogue");
    chronicle = travel(chronicle, typographia, 12);
    chronicle = waitUntil(chronicle, 9 * 60);
    chronicle = applyIgnisInvestigationAction(chronicle, "typographia_lamp_record");
  } else {
    chronicle = travel(chronicle, typographia);
    chronicle = waitUntil(chronicle, 9 * 60);
    chronicle = applyIgnisInvestigationAction(chronicle, "typographia_lamp_record");
    chronicle = travel(chronicle, archivum, 12);
    chronicle = applyIgnisInvestigationAction(chronicle, "archivum_catalogue");
  }
  chronicle = wait(chronicle, scenario.extraWaitMinutes);
  expect(chronicle.knowledgeByPersona[personaId]?.questions["question.ignis.first-flame"]?.status).toBe("answered");

  chronicle = integrateAnsweredIgnisQuaestio(chronicle);
  if (chronicle.personas[personaId]!.currentLocation !== archivum) chronicle = travel(chronicle, archivum, 12);
  chronicle = askMiriamAboutIgnis(chronicle);
  chronicle = applyMissingFolioAction(chronicle, "inspect_transfer_ledger");
  chronicle = travel(chronicle, forum, 14);
  chronicle = applyMissingFolioAction(chronicle, "follow_forum_rumour");
  assertHealth(chronicle);
  chronicle = await maybeReload(chronicle, scenario.reloadStage, "after-rumour");

  chronicle = travel(chronicle, archivum, 14);
  chronicle = askMiriamWhereFolioWasLastSeen(chronicle);
  chronicle = applyTransferBoxAction(chronicle, "locate_box_7");
  chronicle = applyTransferBoxAction(chronicle, "open_box_7");
  chronicle = readRecoveredFolio(chronicle);
  assertHealth(chronicle);
  chronicle = await maybeReload(chronicle, scenario.reloadStage, "after-folio");

  if (chronicle.personas[personaId]!.currentLocation !== archivum) chronicle = travel(chronicle, archivum);
  chronicle = applyThreeWitnessAction(chronicle, "inspect_matter");
  chronicle = travel(chronicle, typographia, 12);
  chronicle = waitUntil(chronicle, 9 * 60);
  chronicle = applyThreeWitnessAction(chronicle, "compare_word");
  chronicle = travel(chronicle, forum, 10);
  chronicle = waitUntil(chronicle, 13 * 60);
  chronicle = applyMemoryWitnessAction(chronicle, "hear_tomas");
  chronicle = applyMemoryWitnessAction(chronicle, "hear_beatrice");
  expect(projectThreeWitnesses(chronicle).availableActions).not.toContain("hear_memory");
  chronicle = applyMemoryWitnessAction(chronicle, "compare_memories");
  chronicle = applyThreeWitnessAction(chronicle, "hear_memory");
  assertHealth(chronicle);

  await deleteChronicleFromBrowser(chronicle.chronicleId as string);
  return chronicle;
}

const paths: readonly ProloguePath[] = ["observatio", "litterae", "discernimentum"];
const scenarios: Scenario[] = Array.from({ length: 18 }, (_, index) => ({
  id: String(index + 1).padStart(2, "0"),
  path: paths[index % paths.length]!,
  firstIgnisSource: index % 2 === 0 ? "archivum" : "typographia",
  reloadStage: (["none", "after-ignis", "after-rumour", "after-folio"] as const)[index % 4]!,
  extraWaitMinutes: (index % 3) * 15,
}));

describe("CAMPAIGN SIMULATION GATE", () => {
  for (const scenario of scenarios) {
    it(`scenario ${scenario.id}: ${scenario.path}, ${scenario.firstIgnisSource} first, reload=${scenario.reloadStage}`, async () => {
      const chronicle = await runScenario(scenario);
      const knowledge = chronicle.knowledgeByPersona[personaId]!;
      expect(knowledge.questions["question.folio.three-witnesses"]?.status).toBe("answered");
      expect(chronicle.eventLedger.some((event) => event.type === "ThreeWitnessesUnderstood")).toBe(true);
      expect(knowledge.evidence["evidence.memory.source-comparison"]?.payload.independenceAssessment).toBe("beatrice_not_independent");
    });
  }
});

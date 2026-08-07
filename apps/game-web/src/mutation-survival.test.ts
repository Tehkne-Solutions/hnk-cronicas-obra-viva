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
import { applyThreeWitnessAction } from "./three-witnesses.js";
import { projectPlayableLoop } from "./playable-loop.js";
import { minimizeFailingTrace } from "./failure-minimizer.js";

const personaId = "persona.player" as PersonaId;
const miriamId = "npc.miriam" as EntityId;
const officina = "aurea.officina" as LocationId;
const archivum = "aurea.archivum" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const forum = "aurea.forum" as LocationId;
const expectedContentVersion = "mutation-survival-gate-2";

const requiredDomains = [
  "knowledge",
  "event-ledger",
  "time",
  "location",
  "inventory",
  "testimony",
  "consequence",
  "persistence",
] as const;

type MutationDomain = (typeof requiredDomains)[number];

interface SemanticMutation {
  readonly id: string;
  readonly domain: MutationDomain;
  readonly apply: (chronicle: ChronicleSaveV2) => ChronicleSaveV2;
}

function freshChronicle(): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: "chronicle.mutation-survival" as ChronicleId,
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
    contentVersion: expectedContentVersion,
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

function buildCompletedCampaign(): ChronicleSaveV2 {
  let chronicle = freshChronicle();
  chronicle = applyProloguePath(chronicle, "litterae");
  chronicle = applyIgnisAction(chronicle, "add_oil");
  chronicle = applyIgnisAction(chronicle, "place_wick");
  chronicle = applyIgnisAction(chronicle, "wait_wick");
  chronicle = applyIgnisAction(chronicle, "strike");
  chronicle = applyIgnisAction(chronicle, "read_manuscript");

  chronicle = travel(chronicle, archivum, 15);
  chronicle = applyIgnisInvestigationAction(chronicle, "archivum_catalogue");
  chronicle = travel(chronicle, typographia, 12);
  chronicle = waitTo(chronicle, 9 * 60);
  chronicle = applyIgnisInvestigationAction(chronicle, "typographia_lamp_record");
  chronicle = integrateAnsweredIgnisQuaestio(chronicle);

  chronicle = travel(chronicle, archivum, 12);
  chronicle = askMiriamAboutIgnis(chronicle);
  chronicle = applyMissingFolioAction(chronicle, "inspect_transfer_ledger");
  chronicle = travel(chronicle, forum, 14);
  chronicle = applyMissingFolioAction(chronicle, "follow_forum_rumour");
  chronicle = travel(chronicle, archivum, 14);
  chronicle = askMiriamWhereFolioWasLastSeen(chronicle);
  chronicle = applyTransferBoxAction(chronicle, "locate_box_7");
  chronicle = applyTransferBoxAction(chronicle, "open_box_7");
  chronicle = readRecoveredFolio(chronicle);
  chronicle = applyThreeWitnessAction(chronicle, "inspect_matter");

  chronicle = travel(chronicle, typographia, 12);
  chronicle = applyThreeWitnessAction(chronicle, "compare_word");
  chronicle = travel(chronicle, forum, 10);
  chronicle = waitTo(chronicle, 13 * 60);
  chronicle = applyMemoryWitnessAction(chronicle, "hear_tomas");
  chronicle = applyMemoryWitnessAction(chronicle, "hear_beatrice");
  chronicle = applyMemoryWitnessAction(chronicle, "compare_memories");
  chronicle = applyThreeWitnessAction(chronicle, "hear_memory");
  return chronicle;
}

function semanticOracle(chronicle: ChronicleSaveV2): boolean {
  if (chronicle.schemaVersion !== 2 || chronicle.contentVersion !== expectedContentVersion) return false;
  if (chronicle.world.timestamp.day < 1) return false;
  if (chronicle.world.timestamp.minuteOfDay < 0 || chronicle.world.timestamp.minuteOfDay >= 24 * 60) return false;

  const persona = chronicle.personas[chronicle.activePersonaId];
  if (!persona || !chronicle.world.locations[persona.currentLocation]) return false;
  if (persona.inventory.length !== 0) return false;
  if (persona.capabilities.litterae < 2 || persona.capabilities.discernimentum < 1) return false;

  const knowledge = chronicle.knowledgeByPersona[chronicle.activePersonaId];
  if (!knowledge) return false;
  if (new Set(chronicle.eventLedger.map((event) => event.id)).size !== chronicle.eventLedger.length) return false;
  try { projectPlayableLoop(chronicle); } catch { return false; }

  const eventTypes = new Set(chronicle.eventLedger.map((event) => event.type));
  const firstQuestion = knowledge.questions["question.ignis.first-flame"];
  const missingFolio = knowledge.questions["question.ignis.missing-folio"];
  const finalQuestion = knowledge.questions["question.folio.three-witnesses"];

  return (
    eventTypes.has("IgnisQuaestioIntegrated") &&
    eventTypes.has("MiriamIgnisTestimonyReceived") &&
    eventTypes.has("MiriamFolioLocationTestimonyReceived") &&
    eventTypes.has("TransferBox7Opened") &&
    eventTypes.has("ThreeWitnessesUnderstood") &&
    firstQuestion?.derivedQuestions.includes("question.ignis.missing-folio" as never) === true &&
    missingFolio?.status === "answered" &&
    finalQuestion?.status === "answered" &&
    Boolean(knowledge.evidence["evidence.miriam.ignis-missing-folio"]) &&
    Boolean(knowledge.evidence["evidence.miriam.folio-last-seen"]) &&
    Boolean(knowledge.evidence["evidence.memory.source-comparison"])
  );
}

function withoutEvent(chronicle: ChronicleSaveV2, type: string): ChronicleSaveV2 {
  return { ...chronicle, eventLedger: chronicle.eventLedger.filter((event) => event.type !== type) };
}

const mutations: readonly SemanticMutation[] = [
  {
    id: "duplicate-event-id",
    domain: "event-ledger",
    apply: (chronicle) => {
      const last = chronicle.eventLedger[chronicle.eventLedger.length - 1]!;
      return { ...chronicle, eventLedger: [...chronicle.eventLedger, { ...last }] };
    },
  },
  {
    id: "suppress-completion-event",
    domain: "event-ledger",
    apply: (chronicle) => withoutEvent(chronicle, "ThreeWitnessesUnderstood"),
  },
  {
    id: "break-current-location",
    domain: "location",
    apply: (chronicle) => ({
      ...chronicle,
      personas: {
        ...chronicle.personas,
        [personaId]: { ...chronicle.personas[personaId]!, currentLocation: "aurea.missing" as LocationId },
      },
    }),
  },
  {
    id: "erase-active-knowledge",
    domain: "knowledge",
    apply: (chronicle) => {
      const { [personaId]: _removed, ...remaining } = chronicle.knowledgeByPersona;
      return { ...chronicle, knowledgeByPersona: remaining };
    },
  },
  {
    id: "reopen-final-question",
    domain: "knowledge",
    apply: (chronicle) => {
      const knowledge = chronicle.knowledgeByPersona[personaId]!;
      const question = knowledge.questions["question.folio.three-witnesses"]!;
      return {
        ...chronicle,
        knowledgeByPersona: {
          ...chronicle.knowledgeByPersona,
          [personaId]: {
            ...knowledge,
            questions: { ...knowledge.questions, [question.id]: { ...question, status: "open" } },
          },
        },
      };
    },
  },
  {
    id: "drop-memory-comparison-evidence",
    domain: "knowledge",
    apply: (chronicle) => {
      const knowledge = chronicle.knowledgeByPersona[personaId]!;
      const { ["evidence.memory.source-comparison"]: _removed, ...remainingEvidence } = knowledge.evidence;
      return {
        ...chronicle,
        knowledgeByPersona: {
          ...chronicle.knowledgeByPersona,
          [personaId]: { ...knowledge, evidence: remainingEvidence },
        },
      };
    },
  },
  {
    id: "day-zero",
    domain: "time",
    apply: (chronicle) => ({
      ...chronicle,
      world: { ...chronicle.world, timestamp: { ...chronicle.world.timestamp, day: 0 } },
    }),
  },
  {
    id: "minute-overflow",
    domain: "time",
    apply: (chronicle) => ({
      ...chronicle,
      world: { ...chronicle.world, timestamp: { ...chronicle.world.timestamp, minuteOfDay: 24 * 60 } },
    }),
  },
  {
    id: "inject-ghost-inventory-item",
    domain: "inventory",
    apply: (chronicle) => ({
      ...chronicle,
      personas: {
        ...chronicle.personas,
        [personaId]: {
          ...chronicle.personas[personaId]!,
          inventory: ["entity.ghost-item" as EntityId],
        },
      },
    }),
  },
  {
    id: "drop-first-miriam-testimony",
    domain: "testimony",
    apply: (chronicle) => withoutEvent(chronicle, "MiriamIgnisTestimonyReceived"),
  },
  {
    id: "drop-deep-miriam-testimony-evidence",
    domain: "testimony",
    apply: (chronicle) => {
      const knowledge = chronicle.knowledgeByPersona[personaId]!;
      const { ["evidence.miriam.folio-last-seen"]: _removed, ...remainingEvidence } = knowledge.evidence;
      return {
        ...chronicle,
        knowledgeByPersona: {
          ...chronicle.knowledgeByPersona,
          [personaId]: { ...knowledge, evidence: remainingEvidence },
        },
      };
    },
  },
  {
    id: "erase-ignis-integration-event",
    domain: "consequence",
    apply: (chronicle) => withoutEvent(chronicle, "IgnisQuaestioIntegrated"),
  },
  {
    id: "rollback-practiced-capabilities",
    domain: "consequence",
    apply: (chronicle) => ({
      ...chronicle,
      personas: {
        ...chronicle.personas,
        [personaId]: {
          ...chronicle.personas[personaId]!,
          capabilities: { ...chronicle.personas[personaId]!.capabilities, litterae: 0, discernimentum: 0 },
        },
      },
    }),
  },
  {
    id: "schema-version-downgrade",
    domain: "persistence",
    apply: (chronicle) => ({ ...chronicle, schemaVersion: 1 as never }),
  },
  {
    id: "content-version-drift",
    domain: "persistence",
    apply: (chronicle) => ({ ...chronicle, contentVersion: "stale-content-version" }),
  },
];

describe("MUTATION SURVIVAL GATE", () => {
  it("proves the baseline campaign is semantically healthy", () => {
    expect(semanticOracle(buildCompletedCampaign())).toBe(true);
  });

  it("keeps at least one deliberate mutant for every critical domain", () => {
    const covered = new Set(mutations.map((mutation) => mutation.domain));
    expect([...requiredDomains].filter((domain) => !covered.has(domain))).toEqual([]);
  });

  it("kills every deliberate semantic mutant in the coverage matrix", () => {
    const baseline = buildCompletedCampaign();
    for (const mutation of mutations) {
      expect(
        semanticOracle(mutation.apply(baseline)),
        `mutation survived: domain=${mutation.domain} id=${mutation.id}`,
      ).toBe(false);
    }
  });

  it("minimizes a noisy failing trace to its causal core", () => {
    const trace = ["setup", "noise-a", "mutation", "noise-b", "noise-c"] as const;
    const minimized = minimizeFailingTrace(trace, (candidate) => candidate.includes("mutation"));
    expect(minimized).toEqual(["mutation"]);
  });
});

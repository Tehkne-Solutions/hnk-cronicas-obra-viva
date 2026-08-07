import { describe, expect, it } from "vitest";
import {
  advanceWorldTimestamp,
  createEmptyKnowledgeState,
  type ChronicleId,
  type LocationId,
  type PersonaId,
} from "@hnk/domain";
import { travelChronicle } from "@hnk/aurea-navigation";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { applyProloguePath, type ProloguePath } from "./prologue.js";
import { applyIgnisAction, projectIgnis } from "./ignis.js";
import { applyIgnisInvestigationAction, projectIgnisInvestigation } from "./investigation.js";
import {
  askMiriamAboutIgnis,
  integrateAnsweredIgnisQuaestio,
  projectMiriamIgnisConversation,
} from "./consequence.js";
import { applyPlayableLoopAction, projectPlayableLoop, type PlayableLoopActionId } from "./playable-loop.js";

const personaId = "persona.player" as PersonaId;
const officina = "aurea.officina" as LocationId;
const archivum = "aurea.archivum" as LocationId;
const typographia = "aurea.typographia" as LocationId;
const forum = "aurea.forum" as LocationId;
const locations = [officina, archivum, typographia, forum] as const;
const keyMinutes = [8 * 60, 9 * 60, 12 * 60, 13 * 60, 15 * 60, 17 * 60] as const;

function freshChronicle(seed: number): ChronicleSaveV2 {
  return {
    schemaVersion: 2,
    chronicleId: `chronicle.autonomous.${seed}` as ChronicleId,
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
      entities: {},
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
    contentVersion: "autonomous-exploration-gate-1",
  };
}

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface Candidate {
  readonly id: string;
  readonly apply: (chronicle: ChronicleSaveV2) => ChronicleSaveV2;
}

function candidates(chronicle: ChronicleSaveV2): Candidate[] {
  const result: Candidate[] = [];
  const hasPrologue = chronicle.eventLedger.some((event) => event.type === "ProloguePathChosen");
  if (!hasPrologue) {
    for (const path of ["observatio", "litterae", "discernimentum"] as const satisfies readonly ProloguePath[]) {
      result.push({ id: `prologue:${path}`, apply: (current) => applyProloguePath(current, path) });
    }
    return result;
  }

  for (const action of projectIgnis(chronicle).availableActions) {
    result.push({ id: `ignis:${action}`, apply: (current) => applyIgnisAction(current, action) });
  }
  for (const action of projectIgnisInvestigation(chronicle).availableActions) {
    result.push({ id: `investigation:${action}`, apply: (current) => applyIgnisInvestigationAction(current, action) });
  }

  const integrated = integrateAnsweredIgnisQuaestio(chronicle);
  if (integrated !== chronicle) result.push({ id: "consequence:integrate", apply: integrateAnsweredIgnisQuaestio });

  if (projectMiriamIgnisConversation(chronicle).available) {
    result.push({ id: "miriam:first", apply: askMiriamAboutIgnis });
  }

  for (const action of projectPlayableLoop(chronicle).actions) {
    result.push({
      id: `loop:${action.id}`,
      apply: (current) => applyPlayableLoopAction(current, action.id as PlayableLoopActionId),
    });
  }

  const currentLocation = chronicle.personas[personaId]!.currentLocation;
  for (const target of locations) {
    if (target === currentLocation) continue;
    result.push({
      id: `travel:${target}`,
      apply: (current) => travelChronicle(current, personaId, {
        from: current.personas[personaId]!.currentLocation,
        to: target,
        travelMinutes: 10,
      }).chronicle,
    });
  }

  const now = chronicle.world.timestamp.minuteOfDay;
  for (const minute of keyMinutes) {
    if (minute <= now) continue;
    result.push({
      id: `wait:${minute}`,
      apply: (current) => ({
        ...current,
        world: {
          ...current.world,
          timestamp: advanceWorldTimestamp(current.world.timestamp, minute - current.world.timestamp.minuteOfDay),
        },
      }),
    });
  }

  return result;
}

function stateSignature(chronicle: ChronicleSaveV2): string[] {
  const knowledge = chronicle.knowledgeByPersona[personaId]!;
  const questions = Object.values(knowledge.questions).map((question) => `question:${question.id}:${question.status}`);
  const events = [...new Set(chronicle.eventLedger.map((event) => `event:${event.type}`))];
  const actions = projectPlayableLoop(chronicle).actions.map((action) => `action:${action.id}`);
  const ignis = projectIgnis(chronicle).availableActions.map((action) => `action:ignis:${action}`);
  const investigation = projectIgnisInvestigation(chronicle).availableActions.map((action) => `action:investigation:${action}`);
  return [
    ...events,
    ...questions,
    ...actions,
    ...ignis,
    ...investigation,
    `location:${chronicle.personas[personaId]!.currentLocation}`,
  ];
}

function healthy(chronicle: ChronicleSaveV2): boolean {
  const persona = chronicle.personas[chronicle.activePersonaId];
  if (!persona) return false;
  if (!chronicle.world.locations[persona.currentLocation]) return false;
  if (!chronicle.knowledgeByPersona[chronicle.activePersonaId]) return false;
  if (new Set(chronicle.eventLedger.map((event) => event.id)).size !== chronicle.eventLedger.length) return false;
  const minute = chronicle.world.timestamp.minuteOfDay;
  if (chronicle.world.timestamp.day < 1 || minute < 0 || minute >= 24 * 60) return false;
  try { projectPlayableLoop(chronicle); } catch { return false; }
  return true;
}

function isComplete(chronicle: ChronicleSaveV2): boolean {
  return chronicle.eventLedger.some((event) => event.type === "ThreeWitnessesUnderstood");
}

function runExplorer(seed: number) {
  let chronicle = freshChronicle(seed);
  const random = rng(seed);
  const visited = new Set<string>(stateSignature(chronicle));
  const trace: string[] = [];

  for (let step = 0; step < 120 && !isComplete(chronicle); step += 1) {
    const options = candidates(chronicle)
      .map((candidate) => {
        const next = candidate.apply(chronicle);
        if (next === chronicle || !healthy(next)) return null;
        const signatures = stateSignature(next);
        const novelty = signatures.filter((signature) => !visited.has(signature)).length;
        const terminalBonus = isComplete(next) ? 1000 : 0;
        const eventDelta = next.eventLedger.length - chronicle.eventLedger.length;
        return { candidate, next, score: terminalBonus + novelty * 20 + eventDelta * 3 + random() };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.score - a.score);

    if (options.length === 0) break;
    const selected = options[0]!;
    chronicle = selected.next;
    trace.push(selected.candidate.id);
    for (const signature of stateSignature(chronicle)) visited.add(signature);
  }

  return { chronicle, trace, visited };
}

describe("AUTONOMOUS EXPLORATION GATE", () => {
  for (const seed of [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212]) {
    it(`seed ${seed} reaches the campaign understanding while maximizing unseen state coverage`, () => {
      const result = runExplorer(seed);
      expect(healthy(result.chronicle)).toBe(true);
      expect(isComplete(result.chronicle), `seed=${seed}\ntrace=${result.trace.join(" -> ")}`).toBe(true);
      expect(result.visited.size).toBeGreaterThan(20);
      expect(result.trace.length).toBeLessThanOrEqual(120);
    });
  }
});

import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import type {
  ClaimId,
  EntityId,
  EvidenceId,
  EventId,
  KnowledgeNodeId,
  LocationId,
  Question,
  QuestionId,
} from "@hnk/domain";
import {
  advanceWickSaturation,
  resolveLampCombustion,
  resolveOperation,
  type LampCombustionState,
} from "@hnk/alchemy-engine";
import {
  observeScriptum,
  recordScriptumObservation,
  type ScriptumDocument,
} from "@hnk/scriptum-engine";
import { applyWorldLightEvents, deriveLightEvents } from "@hnk/world-engine";

export type IgnisAction = "add_oil" | "place_wick" | "wait_wick" | "strike" | "read_manuscript";

const lampId = "ignis.lamp" as EntityId;
const manuscriptId = "document.ardel.ignis" as EntityId;
const officina = "aurea.officina" as LocationId;
const ignisQuestionId = "question.ignis.first-flame" as QuestionId;

const manuscript: ScriptumDocument = Object.freeze({
  entityId: manuscriptId,
  materialKey: "scriptum.ardel.ignis",
  layers: Object.freeze([
    Object.freeze({
      id: "surface",
      kind: "surface" as const,
      textKey: "scriptum.ignis.surface",
      requires: Object.freeze({ illumination: "lit" as const }),
    }),
    Object.freeze({
      id: "first-line",
      kind: "text" as const,
      textKey: "scriptum.ignis.first_line",
      requires: Object.freeze({ illumination: "lit" as const }),
    }),
    Object.freeze({
      id: "scribe-mark",
      kind: "marginalia" as const,
      textKey: "scriptum.ignis.scribe_mark",
      requires: Object.freeze({ illumination: "lit" as const, litterae: 1 }),
    }),
    Object.freeze({
      id: "erased-trace",
      kind: "damage" as const,
      textKey: "scriptum.ignis.erased_trace",
      requires: Object.freeze({ illumination: "lit" as const, discernimentum: 1 }),
    }),
  ]),
  provenance: Object.freeze([]),
});

export interface IgnisView {
  readonly active: boolean;
  readonly completed: boolean;
  readonly manuscriptRead: boolean;
  readonly lamp: LampCombustionState;
  readonly availableActions: readonly IgnisAction[];
  readonly text: string;
}

function latestLampState(chronicle: ChronicleSaveV2): LampCombustionState {
  let state: LampCombustionState = { lampId, wickSaturation: "dry", ignitionState: "unlit" };
  for (const event of chronicle.eventLedger) {
    if (event.type === "IgnisOilAdded") state = { ...state, reservoirMaterialId: "oleum" };
    if (event.type === "IgnisWickPlaced") state = { ...state, wickMaterialId: "linum" };
    if (event.type === "IgnisWickSaturated") state = { ...state, wickSaturation: "saturated" };
    if (event.type === "CombustionStarted") state = { ...state, ignitionState: "burning" };
  }
  return state;
}

function prologuePath(chronicle: ChronicleSaveV2): string | undefined {
  const event = chronicle.eventLedger.find((item) => item.type === "ProloguePathChosen");
  if (!event || typeof event.payload !== "object" || event.payload === null) return undefined;
  const path = (event.payload as Readonly<Record<string, unknown>>).path;
  return typeof path === "string" ? path : undefined;
}

function hasReadManuscript(chronicle: ChronicleSaveV2): boolean {
  return chronicle.eventLedger.some((event) => event.type === "IgnisManuscriptRead");
}

export function projectIgnis(chronicle: ChronicleSaveV2): IgnisView {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  const active = persona?.currentLocation === officina && chronicle.eventLedger.some((event) => event.type === "ProloguePathChosen");
  const lamp = latestLampState(chronicle);
  const completed = lamp.ignitionState === "burning";
  const manuscriptRead = hasReadManuscript(chronicle);
  if (!active) return { active: false, completed, manuscriptRead, lamp, availableActions: [], text: "" };

  const path = prologuePath(chronicle);
  const opening = path === "observatio"
    ? "Na penumbra, seus olhos distinguem primeiro a lamparina, o reservatório vazio e o pavio separado."
    : path === "litterae"
      ? "À margem de uma folha, você consegue ler uma anotação curta: combustível, fibra, tempo, centelha."
      : "A mesa sugere uma relação: óleo e água ocupam recipientes semelhantes, mas apenas um deles parece adequado à chama.";

  if (completed && manuscriptRead) return {
    active: true,
    completed,
    manuscriptRead,
    lamp,
    availableActions: [],
    text: `${opening}\n\nA primeira chama se sustenta. Sob a luz, o manuscrito deixou de ser apenas objeto: tornou-se evidência. Uma nova questão permanece aberta no LIBER.`,
  };
  if (completed) return {
    active: true,
    completed,
    manuscriptRead,
    lamp,
    availableActions: ["read_manuscript"],
    text: `${opening}\n\nA primeira chama se sustenta. A luz alcança o manuscrito incompleto e revela traços que a penumbra escondia.`,
  };

  const availableActions: IgnisAction[] = [];
  if (!lamp.reservoirMaterialId) availableActions.push("add_oil");
  if (!lamp.wickMaterialId) availableActions.push("place_wick");
  if (lamp.reservoirMaterialId === "oleum" && lamp.wickMaterialId === "linum" && lamp.wickSaturation !== "saturated") availableActions.push("wait_wick");
  if (lamp.wickSaturation === "saturated") availableActions.push("strike");
  return { active: true, completed, manuscriptRead, lamp, availableActions, text: opening };
}

function append(chronicle: ChronicleSaveV2, type: string, payload: Record<string, unknown>): ChronicleSaveV2 {
  const event = {
    id: `event.ignis.${chronicle.eventLedger.length + 1}` as EventId,
    type,
    occurredAt: chronicle.world.timestamp,
    payload: Object.freeze(payload),
  };
  return Object.freeze({ ...chronicle, eventLedger: Object.freeze([...chronicle.eventLedger, Object.freeze(event)]) });
}

function readManuscript(chronicle: ChronicleSaveV2): ChronicleSaveV2 {
  if (latestLampState(chronicle).ignitionState !== "burning" || hasReadManuscript(chronicle)) return chronicle;
  const personaKey = chronicle.activePersonaId as string;
  const persona = chronicle.personas[personaKey];
  if (!persona) return chronicle;
  const illumination = chronicle.world.locations[officina as string]?.illumination ?? "dark";
  const observations = observeScriptum(manuscript, {
    illumination,
    litterae: persona.capabilities.litterae,
    discernimentum: persona.capabilities.discernimentum,
  });
  if (observations.length === 0) return chronicle;

  let knowledge = chronicle.knowledgeByPersona[personaKey]!;
  const claimIds: ClaimId[] = [];
  const evidenceIds: EvidenceId[] = [];
  for (const observation of observations) {
    const slug = observation.layerId.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const nodeId = `knowledge.ignis.${slug}` as KnowledgeNodeId;
    const claimId = `claim.ignis.${slug}` as ClaimId;
    const evidenceId = `evidence.ignis.${slug}` as EvidenceId;
    knowledge = recordScriptumObservation(knowledge, observation, chronicle.world.timestamp, { nodeId, claimId, evidenceId });
    claimIds.push(claimId);
    evidenceIds.push(evidenceId);
  }

  const question: Question = Object.freeze({
    id: ignisQuestionId,
    textKey: "quaestio.ignis.what_sustains_the_flame",
    status: "open",
    relatedClaims: Object.freeze(claimIds),
    relatedEvidence: Object.freeze(evidenceIds),
    derivedQuestions: Object.freeze([]),
    openedAt: chronicle.world.timestamp,
  });
  knowledge = Object.freeze({
    ...knowledge,
    questions: Object.freeze({ ...knowledge.questions, [ignisQuestionId as string]: question }),
  });

  const learned = Object.freeze({
    ...chronicle,
    knowledgeByPersona: Object.freeze({ ...chronicle.knowledgeByPersona, [personaKey]: knowledge }),
  });
  return append(learned, "IgnisManuscriptRead", {
    documentId: manuscriptId,
    layerIds: observations.map((observation) => observation.layerId),
    questionId: ignisQuestionId,
  });
}

export function applyIgnisAction(chronicle: ChronicleSaveV2, action: IgnisAction): ChronicleSaveV2 {
  if (action === "read_manuscript") return readManuscript(chronicle);
  const personaId = chronicle.activePersonaId as unknown as EntityId;
  let lamp = latestLampState(chronicle);

  if (action === "add_oil") {
    const result = resolveOperation({ at: chronicle.world.timestamp, operation: "add", actorId: personaId, targetId: lampId, material: { id: "ignis.oleum" as EntityId, materialId: "oleum", quantity: 1, state: {} } });
    return result.events.some((event) => event.type === "MaterialAdded") ? append(chronicle, "IgnisOilAdded", { material: "oleum" }) : chronicle;
  }
  if (action === "place_wick") return append(chronicle, "IgnisWickPlaced", { material: "linum" });
  if (action === "wait_wick") {
    lamp = advanceWickSaturation({ ...lamp, reservoirMaterialId: "oleum", wickMaterialId: "linum" }, 5);
    if (lamp.wickSaturation !== "saturated") return chronicle;
    return append(chronicle, "IgnisWickSaturated", { minutes: 5 });
  }

  const spark = resolveOperation({ at: chronicle.world.timestamp, operation: "strike", actorId: personaId, targetId: "ignis.silex" as EntityId, instrumentId: "ignis.ferrum" as EntityId, targetMaterialId: "silex", instrumentMaterialId: "ferrum" });
  if (!spark.events.some((event) => event.type === "SparkProduced")) return chronicle;
  const combustion = resolveLampCombustion({ sparkApplied: true, state: lamp });
  if (!combustion.events.some((event) => event.type === "CombustionStarted")) return append(chronicle, "CombustionNotSustained", { reason: combustion.events[0]?.type ?? "unknown" });
  const world = applyWorldLightEvents(chronicle.world, deriveLightEvents({ combustion, sourceId: lampId, locationId: officina }));
  return append(Object.freeze({ ...chronicle, world }), "CombustionStarted", { lampId });
}

export const IGNIS_ACTION_LABEL: Readonly<Record<IgnisAction, string>> = Object.freeze({
  add_oil: "Adicionar óleo à lamparina",
  place_wick: "Posicionar o pavio de linho",
  wait_wick: "Esperar o pavio absorver o óleo",
  strike: "Golpear sílex contra ferro",
  read_manuscript: "Examinar o manuscrito à luz da chama",
});

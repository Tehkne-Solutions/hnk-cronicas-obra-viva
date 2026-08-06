import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import type { EntityId, EventId, LocationId } from "@hnk/domain";
import {
  advanceWickSaturation,
  resolveLampCombustion,
  resolveOperation,
  type LampCombustionState,
} from "@hnk/alchemy-engine";
import { applyWorldLightEvents, deriveLightEvents } from "@hnk/world-engine";

export type IgnisAction = "add_oil" | "place_wick" | "wait_wick" | "strike";

const lampId = "ignis.lamp" as EntityId;
const officina = "aurea.officina" as LocationId;

export interface IgnisView {
  readonly active: boolean;
  readonly completed: boolean;
  readonly lamp: LampCombustionState;
  readonly availableActions: readonly IgnisAction[];
  readonly text: string;
}

function latestLampState(chronicle: ChronicleSaveV2): LampCombustionState {
  let state: LampCombustionState = {
    lampId,
    wickSaturation: "dry",
    ignitionState: "unlit",
  };
  for (const event of chronicle.eventLedger) {
    if (event.type === "IgnisOilAdded") state = { ...state, reservoirMaterialId: "oleum" };
    if (event.type === "IgnisWickPlaced") state = { ...state, wickMaterialId: "linum" };
    if (event.type === "IgnisWickSaturated") state = { ...state, wickSaturation: "saturated" };
    if (event.type === "CombustionStarted") state = { ...state, ignitionState: "burning" };
  }
  return state;
}

function prologuePath(chronicle: ChronicleSaveV2): string | undefined {
  return chronicle.eventLedger.find((event) => event.type === "ProloguePathChosen")?.payload.path as string | undefined;
}

export function projectIgnis(chronicle: ChronicleSaveV2): IgnisView {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  const active = persona?.currentLocation === officina && chronicle.eventLedger.some((event) => event.type === "ProloguePathChosen");
  const lamp = latestLampState(chronicle);
  const completed = lamp.ignitionState === "burning";
  if (!active) return { active: false, completed, lamp, availableActions: [], text: "" };

  const path = prologuePath(chronicle);
  const opening = path === "observatio"
    ? "Na penumbra, seus olhos distinguem primeiro a lamparina, o reservatório vazio e o pavio separado."
    : path === "litterae"
      ? "À margem de uma folha, você consegue ler uma anotação curta: combustível, fibra, tempo, centelha."
      : "A mesa sugere uma relação: óleo e água ocupam recipientes semelhantes, mas apenas um deles parece adequado à chama.";

  if (completed) return { active: true, completed, lamp, availableActions: [], text: `${opening}\n\nA primeira chama se sustenta. A Officina deixa de ser penumbra.` };

  const availableActions: IgnisAction[] = [];
  if (!lamp.reservoirMaterialId) availableActions.push("add_oil");
  if (!lamp.wickMaterialId) availableActions.push("place_wick");
  if (lamp.reservoirMaterialId === "oleum" && lamp.wickMaterialId === "linum" && lamp.wickSaturation !== "saturated") availableActions.push("wait_wick");
  if (lamp.wickSaturation === "saturated") availableActions.push("strike");
  return { active: true, completed, lamp, availableActions, text: opening };
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

export function applyIgnisAction(chronicle: ChronicleSaveV2, action: IgnisAction): ChronicleSaveV2 {
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
  const lit = Object.freeze({ ...chronicle, world });
  return append(lit, "CombustionStarted", { lampId });
}

export const IGNIS_ACTION_LABEL: Readonly<Record<IgnisAction, string>> = Object.freeze({
  add_oil: "Adicionar óleo à lamparina",
  place_wick: "Posicionar o pavio de linho",
  wait_wick: "Esperar o pavio absorver o óleo",
  strike: "Golpear sílex contra ferro",
});

import type { EntityId } from "@hnk/domain";
import type { MaterialId } from "./index.js";

export type WickSaturation = "dry" | "damp" | "saturated";
export type IgnitionState = "unlit" | "burning" | "extinguished";

export interface LampCombustionState {
  readonly lampId: EntityId;
  readonly reservoirMaterialId?: MaterialId;
  readonly wickMaterialId?: MaterialId;
  readonly wickSaturation: WickSaturation;
  readonly ignitionState: IgnitionState;
}

export interface CombustionAttempt {
  readonly sparkApplied: boolean;
  readonly state: LampCombustionState;
}

export type CombustionEvent =
  | Readonly<{ type: "CombustionStarted"; lampId: EntityId }>
  | Readonly<{ type: "CombustionNotSustained"; lampId: EntityId; reason: string }>;

export interface CombustionResolution {
  readonly events: readonly CombustionEvent[];
  readonly nextState: LampCombustionState;
}

function hasCombustibleFuel(materialId?: MaterialId): boolean {
  return materialId === "oleum" || materialId === "cera";
}

function hasFunctionalWick(state: LampCombustionState): boolean {
  return state.wickMaterialId === "linum" && state.wickSaturation === "saturated";
}

export function resolveLampCombustion(attempt: CombustionAttempt): CombustionResolution {
  const { state } = attempt;

  if (!attempt.sparkApplied) {
    return {
      events: [{ type: "CombustionNotSustained", lampId: state.lampId, reason: "no_ignition_source" }],
      nextState: state,
    };
  }

  if (!hasCombustibleFuel(state.reservoirMaterialId)) {
    return {
      events: [{ type: "CombustionNotSustained", lampId: state.lampId, reason: "fuel_not_combustible" }],
      nextState: { ...state, ignitionState: "unlit" },
    };
  }

  if (!hasFunctionalWick(state)) {
    return {
      events: [{ type: "CombustionNotSustained", lampId: state.lampId, reason: "wick_not_ready" }],
      nextState: { ...state, ignitionState: "unlit" },
    };
  }

  return {
    events: [{ type: "CombustionStarted", lampId: state.lampId }],
    nextState: { ...state, ignitionState: "burning" },
  };
}

export function advanceWickSaturation(
  state: LampCombustionState,
  elapsedMinutes: number,
): LampCombustionState {
  if (elapsedMinutes <= 0 || state.wickMaterialId !== "linum") return state;
  if (state.reservoirMaterialId !== "oleum" && state.reservoirMaterialId !== "aqua") return state;

  if (elapsedMinutes >= 5) {
    return { ...state, wickSaturation: "saturated" };
  }
  return { ...state, wickSaturation: "damp" };
}

import { describe, expect, it } from "vitest";
import type { EntityId } from "@hnk/domain";
import { advanceWickSaturation, resolveLampCombustion } from "./combustion.js";

const lampId = "lamp-01" as EntityId;

describe("lamp combustion", () => {
  it("sustains combustion only with fuel, saturated linen wick and spark", () => {
    const resolution = resolveLampCombustion({
      sparkApplied: true,
      state: {
        lampId,
        reservoirMaterialId: "oleum",
        wickMaterialId: "linum",
        wickSaturation: "saturated",
        ignitionState: "unlit",
      },
    });

    expect(resolution.events[0]?.type).toBe("CombustionStarted");
    expect(resolution.nextState.ignitionState).toBe("burning");
  });

  it("records water as a failed attempt instead of rejecting the operation", () => {
    const saturated = advanceWickSaturation({
      lampId,
      reservoirMaterialId: "aqua",
      wickMaterialId: "linum",
      wickSaturation: "dry",
      ignitionState: "unlit",
    }, 5);

    expect(saturated.wickSaturation).toBe("saturated");

    const resolution = resolveLampCombustion({ sparkApplied: true, state: saturated });
    expect(resolution.events).toEqual([
      { type: "CombustionNotSustained", lampId, reason: "fuel_not_combustible" },
    ]);
    expect(resolution.nextState.ignitionState).toBe("unlit");
  });

  it("does not sustain a dry wick", () => {
    const resolution = resolveLampCombustion({
      sparkApplied: true,
      state: {
        lampId,
        reservoirMaterialId: "oleum",
        wickMaterialId: "linum",
        wickSaturation: "dry",
        ignitionState: "unlit",
      },
    });

    expect(resolution.events[0]).toMatchObject({
      type: "CombustionNotSustained",
      reason: "wick_not_ready",
    });
  });
});

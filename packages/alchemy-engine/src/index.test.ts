import { describe, expect, it } from "vitest";
import type { EntityId, WorldTimestamp } from "@hnk/domain";
import { IGNIS_MATERIA, resolveOperation } from "./index.js";

const id = (value: string) => value as EntityId;
const at = { day: 1, minuteOfDay: 600 } as WorldTimestamp;

describe("IGNIS materia", () => {
  it("defines the eight approved initial materials", () => {
    expect(Object.keys(IGNIS_MATERIA).sort()).toEqual([
      "aqua",
      "cera",
      "ferrum",
      "lignum",
      "linum",
      "oleum",
      "sal",
      "silex",
    ]);
  });

  it("allows oil and water to be added without recipe validation", () => {
    for (const materialId of ["oleum", "aqua"] as const) {
      const result = resolveOperation({
        at,
        operation: "add",
        actorId: id("persona"),
        targetId: id("lamp-reservoir"),
        material: {
          id: id(`${materialId}-01`),
          materialId,
          quantity: 1,
          state: {},
        },
      });
      expect(result.events[0]?.type).toBe("MaterialAdded");
    }
  });

  it("produces a spark only for flint and iron", () => {
    const spark = resolveOperation({
      at,
      operation: "strike",
      actorId: id("persona"),
      targetId: id("flint"),
      instrumentId: id("iron"),
      targetMaterialId: "silex",
      instrumentMaterialId: "ferrum",
    });
    expect(spark.events[0]?.type).toBe("SparkProduced");

    const noSpark = resolveOperation({
      at,
      operation: "strike",
      actorId: id("persona"),
      targetId: id("salt"),
      instrumentId: id("wood"),
      targetMaterialId: "sal",
      instrumentMaterialId: "lignum",
    });
    expect(noSpark.events).toHaveLength(0);
    expect(noSpark.observations).toContain("operation.strike.no_spark");
  });

  it("advances only with valid integer wait durations", () => {
    const valid = resolveOperation({
      at,
      operation: "wait",
      actorId: id("persona"),
      params: { minutes: 15 },
    });
    expect(valid.events).toEqual([{ type: "TimeAdvanced", minutes: 15 }]);

    const invalid = resolveOperation({
      at,
      operation: "wait",
      actorId: id("persona"),
      params: { minutes: -1 },
    });
    expect(invalid.events).toHaveLength(0);
  });
});

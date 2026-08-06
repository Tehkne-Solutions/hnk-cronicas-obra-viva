import type { EntityId, WorldTimestamp } from "@hnk/domain";

export type MaterialId =
  | "oleum"
  | "aqua"
  | "linum"
  | "silex"
  | "ferrum"
  | "cera"
  | "sal"
  | "lignum";

export type MaterialPhase = "solid" | "liquid" | "fiber";

export interface MaterialDefinition {
  readonly id: MaterialId;
  readonly phase: MaterialPhase;
  readonly combustible: boolean;
  readonly supportsWick?: boolean;
  readonly conductiveToWick?: boolean;
}

export interface MaterialInstance {
  readonly id: EntityId;
  readonly materialId: MaterialId;
  readonly quantity: number;
  readonly containerId?: EntityId;
  readonly state: Readonly<Record<string, unknown>>;
}

export const IGNIS_MATERIA: Readonly<Record<MaterialId, MaterialDefinition>> = Object.freeze({
  oleum: Object.freeze({ id: "oleum", phase: "liquid", combustible: true, conductiveToWick: true }),
  aqua: Object.freeze({ id: "aqua", phase: "liquid", combustible: false, conductiveToWick: true }),
  linum: Object.freeze({ id: "linum", phase: "fiber", combustible: true, supportsWick: true }),
  silex: Object.freeze({ id: "silex", phase: "solid", combustible: false }),
  ferrum: Object.freeze({ id: "ferrum", phase: "solid", combustible: false }),
  cera: Object.freeze({ id: "cera", phase: "solid", combustible: true }),
  sal: Object.freeze({ id: "sal", phase: "solid", combustible: false }),
  lignum: Object.freeze({ id: "lignum", phase: "solid", combustible: true }),
});

export type OperationKind = "add" | "remove" | "wait" | "strike";

export interface OperationContext {
  readonly at: WorldTimestamp;
  readonly operation: OperationKind;
  readonly actorId: EntityId;
  readonly targetId?: EntityId;
  readonly instrumentId?: EntityId;
  readonly material?: MaterialInstance;
  readonly targetMaterialId?: MaterialId;
  readonly instrumentMaterialId?: MaterialId;
  readonly params?: Readonly<Record<string, unknown>>;
}

export type AlchemyEvent =
  | Readonly<{ type: "MaterialAdded"; material: MaterialInstance; targetId: EntityId }>
  | Readonly<{ type: "MaterialRemoved"; materialId: EntityId; targetId: EntityId }>
  | Readonly<{ type: "TimeAdvanced"; minutes: number }>
  | Readonly<{ type: "SparkProduced"; sourceA: EntityId; sourceB: EntityId }>;

export interface OperationResolution {
  readonly events: readonly AlchemyEvent[];
  readonly observations: readonly string[];
}

function isSparkPair(a?: MaterialId, b?: MaterialId): boolean {
  return (
    (a === "silex" && b === "ferrum") ||
    (a === "ferrum" && b === "silex")
  );
}

export function resolveOperation(context: OperationContext): OperationResolution {
  switch (context.operation) {
    case "add": {
      if (!context.targetId || !context.material) {
        return { events: [], observations: ["operation.add.missing_target_or_material"] };
      }
      return {
        events: [{ type: "MaterialAdded", material: context.material, targetId: context.targetId }],
        observations: ["operation.add.completed"],
      };
    }
    case "remove": {
      const materialId = context.params?.materialInstanceId;
      if (!context.targetId || typeof materialId !== "string") {
        return { events: [], observations: ["operation.remove.missing_target_or_material"] };
      }
      return {
        events: [{ type: "MaterialRemoved", materialId: materialId as EntityId, targetId: context.targetId }],
        observations: ["operation.remove.completed"],
      };
    }
    case "wait": {
      const minutes = context.params?.minutes;
      if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0) {
        return { events: [], observations: ["operation.wait.invalid_duration"] };
      }
      return {
        events: [{ type: "TimeAdvanced", minutes }],
        observations: ["operation.wait.completed"],
      };
    }
    case "strike": {
      if (!context.targetId || !context.instrumentId) {
        return { events: [], observations: ["operation.strike.missing_pair"] };
      }
      if (!isSparkPair(context.targetMaterialId, context.instrumentMaterialId)) {
        return { events: [], observations: ["operation.strike.no_spark"] };
      }
      return {
        events: [{ type: "SparkProduced", sourceA: context.targetId, sourceB: context.instrumentId }],
        observations: ["operation.strike.spark"] },
      };
    }
  }
}

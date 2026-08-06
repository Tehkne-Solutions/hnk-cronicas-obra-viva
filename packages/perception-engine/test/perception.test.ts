import { describe, expect, it } from "vitest";
import type {
  EntityId,
  KnowledgeState,
  LocationId,
  PersonaId,
  WorldState,
} from "@hnk/domain";
import { createEmptyKnowledgeState } from "@hnk/domain";
import { resolvePerception } from "../src/index.js";

const workshop = "workshop" as LocationId;
const lamp = "lamp" as EntityId;
const personaId = "persona" as PersonaId;

function world(illumination: "dark" | "dim" | "lit"): WorldState {
  return {
    worldId: "fixture",
    timestamp: { day: 1, minuteOfDay: 480 },
    locations: {
      [workshop]: { id: workshop, illumination, entityIds: [lamp] },
    },
    entities: {
      [lamp]: { id: lamp, kind: "object", locationId: workshop, state: {} },
    },
  };
}

const persona = {
  id: personaId,
  currentLocation: workshop,
  inventory: [],
  capabilities: { observatio: 0, litterae: 0, discernimentum: 0 },
} as const;

describe("resolvePerception", () => {
  it("does not leak a light-gated fact in darkness", () => {
    const perceived = resolvePerception({
      observer: persona,
      world: world("dark"),
      knowledge: createEmptyKnowledgeState(),
      candidates: [
        {
          subjectId: lamp,
          conceptId: "lamp.details",
          requirements: [{ minimumIllumination: "dim" }],
        },
      ],
    });

    expect(perceived).toEqual([]);
  });

  it("reveals the same fact when illumination satisfies the veil", () => {
    const perceived = resolvePerception({
      observer: persona,
      world: world("lit"),
      knowledge: createEmptyKnowledgeState(),
      candidates: [
        {
          subjectId: lamp,
          conceptId: "lamp.details",
          requirements: [{ minimumIllumination: "dim" }],
        },
      ],
    });

    expect(perceived.map((fact) => fact.conceptId)).toEqual(["lamp.details"]);
  });
});

import { describe, expect, it } from "vitest";
import { createEmptyKnowledgeState } from "@hnk/domain";
import { composeNarrative } from "../src/index.js";

const scene = {
  id: "workshop.dark",
  base: [{ id: "base", textKey: "scene.workshop.dark.base" }],
  layers: [
    {
      id: "lamp-visible",
      textKey: "scene.workshop.lamp.visible",
      when: [{ kind: "perceived", conceptId: "lamp.details" }],
    },
  ],
} as const;

describe("composeNarrative", () => {
  it("keeps hidden layers out when perception has not crossed the veil", () => {
    expect(
      composeNarrative({
        scene,
        perceived: [],
        knowledge: createEmptyKnowledgeState(),
      }).textKeys,
    ).toEqual(["scene.workshop.dark.base"]);
  });

  it("adds a layer only after the concept is perceived", () => {
    expect(
      composeNarrative({
        scene,
        perceived: [
          {
            subjectId: "lamp" as never,
            conceptId: "lamp.details",
            stage: "noticed",
          },
        ],
        knowledge: createEmptyKnowledgeState(),
      }).textKeys,
    ).toEqual(["scene.workshop.dark.base", "scene.workshop.lamp.visible"]);
  });
});

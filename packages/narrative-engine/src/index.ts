import type { KnowledgeState } from "@hnk/domain";
import type { PerceivedFact } from "@hnk/perception-engine";

export type NarrativeCondition =
  | { readonly kind: "perceived"; readonly conceptId: string }
  | { readonly kind: "knowledge"; readonly nodeId: string };

export interface NarrativeLayer {
  readonly id: string;
  readonly textKey: string;
  readonly when?: readonly NarrativeCondition[];
  readonly priority?: number;
}

export interface NarrativeScene {
  readonly id: string;
  readonly base: readonly NarrativeLayer[];
  readonly layers?: readonly NarrativeLayer[];
}

export interface NarrativeViewModel {
  readonly sceneId: string;
  readonly textKeys: readonly string[];
}

function conditionPasses(
  condition: NarrativeCondition,
  perceived: readonly PerceivedFact[],
  knowledge: KnowledgeState,
): boolean {
  if (condition.kind === "perceived") {
    return perceived.some((fact) => fact.conceptId === condition.conceptId);
  }

  return Boolean(knowledge.nodes[condition.nodeId]);
}

export function composeNarrative(input: {
  readonly scene: NarrativeScene;
  readonly perceived: readonly PerceivedFact[];
  readonly knowledge: KnowledgeState;
}): NarrativeViewModel {
  const layers = [...input.scene.base, ...(input.scene.layers ?? [])]
    .filter((layer) =>
      (layer.when ?? []).every((condition) =>
        conditionPasses(condition, input.perceived, input.knowledge),
      ),
    )
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  return Object.freeze({
    sceneId: input.scene.id,
    textKeys: Object.freeze(layers.map((layer) => layer.textKey)),
  });
}

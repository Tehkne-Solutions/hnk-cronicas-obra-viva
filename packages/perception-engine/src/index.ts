import type {
  EntityId,
  KnowledgeNodeId,
  KnowledgeState,
  PersonaState,
  WorldState,
} from "@hnk/domain";

export type PerceptionStage =
  | "available"
  | "noticed"
  | "recognized"
  | "interpreted";

export interface PerceptionRequirement {
  readonly minimumIllumination?: "dim" | "lit";
  readonly capability?: {
    readonly key: keyof PersonaState["capabilities"];
    readonly minimum: number;
  };
  readonly knowledgeNodeId?: KnowledgeNodeId;
}

export interface ObservationCandidate {
  readonly subjectId: EntityId;
  readonly conceptId: string;
  readonly requirements?: readonly PerceptionRequirement[];
  readonly stage?: PerceptionStage;
}

export interface PerceivedFact {
  readonly subjectId: EntityId;
  readonly conceptId: string;
  readonly stage: PerceptionStage;
}

const illuminationRank = {
  dark: 0,
  dim: 1,
  lit: 2,
} as const;

export function resolvePerception(input: {
  readonly observer: PersonaState;
  readonly world: WorldState;
  readonly knowledge: KnowledgeState;
  readonly candidates: readonly ObservationCandidate[];
}): readonly PerceivedFact[] {
  const location = input.world.locations[input.observer.currentLocation as string];
  if (!location) return [];

  return input.candidates.flatMap((candidate) => {
    const subject = input.world.entities[candidate.subjectId as string];
    if (!subject) return [];

    const physicallyPresent =
      subject.locationId === input.observer.currentLocation ||
      input.observer.inventory.includes(candidate.subjectId);
    if (!physicallyPresent) return [];

    const passes = (candidate.requirements ?? []).every((requirement) => {
      if (requirement.minimumIllumination) {
        if (
          illuminationRank[location.illumination] <
          illuminationRank[requirement.minimumIllumination]
        ) {
          return false;
        }
      }

      if (requirement.capability) {
        if (
          input.observer.capabilities[requirement.capability.key] <
          requirement.capability.minimum
        ) {
          return false;
        }
      }

      if (requirement.knowledgeNodeId) {
        if (!input.knowledge.nodes[requirement.knowledgeNodeId as string]) {
          return false;
        }
      }

      return true;
    });

    return passes
      ? [
          Object.freeze({
            subjectId: candidate.subjectId,
            conceptId: candidate.conceptId,
            stage: candidate.stage ?? "noticed",
          }),
        ]
      : [];
  });
}

export function hasPerceived(
  perceived: readonly PerceivedFact[],
  conceptId: string,
): boolean {
  return perceived.some((fact) => fact.conceptId === conceptId);
}

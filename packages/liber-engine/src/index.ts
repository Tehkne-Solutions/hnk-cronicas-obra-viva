import type { KnowledgeState, WorldTimestamp } from "@hnk/domain";

export type LiberSectionId = "diarium" | "materia" | "quaestiones" | "experimenta";

export interface DiariumEntry {
  readonly id: string;
  readonly at: WorldTimestamp;
  readonly titleKey: string;
  readonly eventRefs: readonly string[];
}

export interface ExperimentRecord {
  readonly id: string;
  readonly at: WorldTimestamp;
  readonly inputRefs: readonly string[];
  readonly actionRefs: readonly string[];
  readonly outcomeRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface LiberState {
  readonly sections: readonly LiberSectionId[];
  readonly diarium: readonly DiariumEntry[];
  readonly materiaNodeIds: readonly string[];
  readonly questionIds: readonly string[];
  readonly experiments: readonly ExperimentRecord[];
}

export function createLiberState(): LiberState {
  return Object.freeze({
    sections: Object.freeze(["diarium", "materia", "quaestiones", "experimenta"] as const),
    diarium: Object.freeze([]),
    materiaNodeIds: Object.freeze([]),
    questionIds: Object.freeze([]),
    experiments: Object.freeze([]),
  });
}

export function syncLiberKnowledge(liber: LiberState, knowledge: KnowledgeState): LiberState {
  const materiaNodeIds = Object.values(knowledge.nodes)
    .filter((node) => node.kind === "material")
    .map((node) => node.id as string);

  return Object.freeze({
    ...liber,
    materiaNodeIds: Object.freeze(materiaNodeIds),
    questionIds: Object.freeze(Object.keys(knowledge.questions)),
  });
}

export function recordDiariumEntry(liber: LiberState, entry: DiariumEntry): LiberState {
  if (liber.diarium.some((existing) => existing.id === entry.id)) return liber;
  return Object.freeze({ ...liber, diarium: Object.freeze([...liber.diarium, Object.freeze(entry)]) });
}

export function recordExperiment(liber: LiberState, experiment: ExperimentRecord): LiberState {
  if (liber.experiments.some((existing) => existing.id === experiment.id)) return liber;
  return Object.freeze({ ...liber, experiments: Object.freeze([...liber.experiments, Object.freeze(experiment)]) });
}
import type { EntityId } from "@hnk/domain";
import type { TestimonyTopic, WitnessMind } from "@hnk/testimonia-engine";

export interface RelationState {
  readonly subjectId: EntityId;
  readonly objectId: EntityId;
  readonly trust: number;
  readonly respect: number;
  readonly affection: number;
  readonly fear: number;
  readonly suspicion: number;
  readonly obligation: number;
}

export interface DisclosureRule {
  readonly topicId: string;
  readonly minimumTrust?: number;
  readonly minimumRespect?: number;
  readonly maximumSuspicion?: number;
  readonly maximumFear?: number;
  readonly minimumObligation?: number;
}

function meets(rule: DisclosureRule, relation: RelationState): boolean {
  if (rule.minimumTrust !== undefined && relation.trust < rule.minimumTrust) return false;
  if (rule.minimumRespect !== undefined && relation.respect < rule.minimumRespect) return false;
  if (rule.maximumSuspicion !== undefined && relation.suspicion > rule.maximumSuspicion) return false;
  if (rule.maximumFear !== undefined && relation.fear > rule.maximumFear) return false;
  if (rule.minimumObligation !== undefined && relation.obligation < rule.minimumObligation) return false;
  return true;
}

export function applyDisclosureRules(
  witness: WitnessMind,
  relation: RelationState,
  rules: readonly DisclosureRule[],
): WitnessMind {
  const unlocked = new Set(
    rules.filter((rule) => meets(rule, relation)).map((rule) => rule.topicId),
  );

  return Object.freeze({
    ...witness,
    willingToSay: Object.freeze(
      Object.fromEntries(
        Object.entries(witness.willingToSay).filter(([topicId]) => unlocked.has(topicId)),
      ),
    ),
  });
}

export function relationDelta(
  state: RelationState,
  delta: Partial<Omit<RelationState, "subjectId" | "objectId">>,
): RelationState {
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  return Object.freeze({
    ...state,
    trust: clamp(state.trust + (delta.trust ?? 0)),
    respect: clamp(state.respect + (delta.respect ?? 0)),
    affection: clamp(state.affection + (delta.affection ?? 0)),
    fear: clamp(state.fear + (delta.fear ?? 0)),
    suspicion: clamp(state.suspicion + (delta.suspicion ?? 0)),
    obligation: clamp(state.obligation + (delta.obligation ?? 0)),
  });
}

export type { TestimonyTopic };

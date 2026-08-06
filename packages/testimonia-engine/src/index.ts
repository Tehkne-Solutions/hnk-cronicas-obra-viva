import type {
  Claim,
  ClaimId,
  EntityId,
  Evidence,
  EvidenceId,
  KnowledgeState,
  WorldTimestamp,
} from "@hnk/domain";

export interface TestimonyProposition {
  readonly key: string;
  readonly value: unknown;
}

export interface TestimonyActorState {
  readonly actorId: EntityId;
  readonly knows: readonly TestimonyProposition[];
  readonly believes: readonly TestimonyProposition[];
  readonly willingToSay: readonly TestimonyProposition[];
}

export interface SpokenTestimony {
  readonly speakerId: EntityId;
  readonly proposition: TestimonyProposition;
  readonly relationToSpeakerState: "known" | "believed" | "withheld_truth" | "fabricated";
}

export function speakTestimony(
  actor: TestimonyActorState,
  propositionKey: string,
): SpokenTestimony | null {
  const spoken = actor.willingToSay.find((item) => item.key === propositionKey);
  if (!spoken) return null;

  const known = actor.knows.find((item) => item.key === propositionKey);
  const believed = actor.believes.find((item) => item.key === propositionKey);

  let relationToSpeakerState: SpokenTestimony["relationToSpeakerState"] = "fabricated";
  if (known && known.value === spoken.value) relationToSpeakerState = "known";
  else if (believed && believed.value === spoken.value) relationToSpeakerState = "believed";
  else if (known && known.value !== spoken.value) relationToSpeakerState = "withheld_truth";

  return Object.freeze({
    speakerId: actor.actorId,
    proposition: spoken,
    relationToSpeakerState,
  });
}

export function recordTestimony(
  state: KnowledgeState,
  spoken: SpokenTestimony,
  at: WorldTimestamp,
  claimId: ClaimId,
  evidenceId: EvidenceId,
): KnowledgeState {
  const claim: Claim = Object.freeze({
    id: claimId,
    subjectId: spoken.speakerId,
    predicate: spoken.proposition.key,
    value: spoken.proposition.value,
    status: "reported",
    createdAt: at,
    assertedBy: { id: spoken.speakerId, kind: "character" },
    sourceRefs: [evidenceId as string],
  });

  const evidence: Evidence = Object.freeze({
    id: evidenceId,
    kind: "testimony",
    producedAt: at,
    sourceRef: { id: spoken.speakerId, kind: "character" },
    supports: [claimId],
    contradicts: [],
    payload: Object.freeze({
      propositionKey: spoken.proposition.key,
      propositionValue: spoken.proposition.value,
    }),
  });

  return Object.freeze({
    ...state,
    claims: Object.freeze({ ...state.claims, [claimId as string]: claim }),
    evidence: Object.freeze({ ...state.evidence, [evidenceId as string]: evidence }),
  });
}

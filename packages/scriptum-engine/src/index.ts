import type { EntityId, WorldTimestamp } from "@hnk/domain";

export type ScriptumLayerKind = "surface" | "text" | "marginalia" | "damage" | "provenance";

export interface ScriptumLayer {
  readonly id: string;
  readonly kind: ScriptumLayerKind;
  readonly textKey?: string;
  readonly requires?: {
    readonly illumination?: "dim" | "lit";
    readonly litterae?: number;
    readonly discernimentum?: number;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ScriptumDocument {
  readonly entityId: EntityId;
  readonly materialKey: string;
  readonly layers: readonly ScriptumLayer[];
  readonly provenance: readonly ProvenanceClaim[];
}

export interface ProvenanceClaim {
  readonly id: string;
  readonly assertedAt?: WorldTimestamp;
  readonly sourceRef?: string;
  readonly claimKey: string;
  readonly confidence?: "low" | "medium" | "high";
}

export interface ScriptumObserver {
  readonly illumination: "dark" | "dim" | "lit";
  readonly litterae: number;
  readonly discernimentum: number;
}

export interface ScriptumObservation {
  readonly documentId: EntityId;
  readonly layerId: string;
  readonly kind: ScriptumLayerKind;
  readonly conceptId: string;
  readonly textKey?: string;
}

const lightRank = { dark: 0, dim: 1, lit: 2 } as const;

function canObserve(layer: ScriptumLayer, observer: ScriptumObserver): boolean {
  const required = layer.requires;
  if (!required) return true;
  if (required.illumination && lightRank[observer.illumination] < lightRank[required.illumination]) return false;
  if (required.litterae !== undefined && observer.litterae < required.litterae) return false;
  if (required.discernimentum !== undefined && observer.discernimentum < required.discernimentum) return false;
  return true;
}

export function observeScriptum(
  document: ScriptumDocument,
  observer: ScriptumObserver,
): readonly ScriptumObservation[] {
  return document.layers
    .filter((layer) => canObserve(layer, observer))
    .map((layer) => Object.freeze({
      documentId: document.entityId,
      layerId: layer.id,
      kind: layer.kind,
      conceptId: `scriptum.${document.entityId as string}.${layer.id}`,
      ...(layer.textKey ? { textKey: layer.textKey } : {}),
    }));
}

export function visibleProvenanceClaims(
  document: ScriptumDocument,
  knownSourceRefs: readonly string[],
): readonly ProvenanceClaim[] {
  const known = new Set(knownSourceRefs);
  return document.provenance.filter((claim) => !claim.sourceRef || known.has(claim.sourceRef));
}

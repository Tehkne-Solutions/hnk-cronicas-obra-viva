import type {
  Claim,
  ClaimId,
  EntityId,
  EntityWorldState,
  Evidence,
  EvidenceId,
  EventId,
  LocationId,
  QuestionId,
} from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";

export type TransferBoxAction = "locate_box_7" | "open_box_7";

const archivum = "aurea.archivum" as LocationId;
const boxId = "archivum.transfer-box.7" as EntityId;
const folioId = "document.ignis.missing-folio" as EntityId;
const questionId = "question.ignis.missing-folio" as QuestionId;

function hasEvent(chronicle: ChronicleSaveV2, type: string): boolean {
  return chronicle.eventLedger.some((event) => event.type === type);
}

function append(chronicle: ChronicleSaveV2, type: string, payload: Record<string, unknown>): ChronicleSaveV2 {
  const event = Object.freeze({
    id: `event.transfer-box.${chronicle.eventLedger.length + 1}` as EventId,
    type,
    occurredAt: chronicle.world.timestamp,
    payload: Object.freeze(payload),
  });
  return Object.freeze({ ...chronicle, eventLedger: Object.freeze([...chronicle.eventLedger, event]) });
}

function materializeBox(chronicle: ChronicleSaveV2, opened: boolean): ChronicleSaveV2 {
  const existing = chronicle.world.entities[boxId as string];
  const box: EntityWorldState = Object.freeze({
    id: boxId,
    kind: "object",
    locationId: archivum,
    state: Object.freeze({
      container: true,
      catalogLabel: "7",
      opened,
      sealed: !opened,
      contains: opened ? Object.freeze([folioId]) : Object.freeze([]),
    }),
  });
  const location = chronicle.world.locations[archivum as string];
  const entityIds = location
    ? Object.freeze([...new Set([...location.entityIds, boxId])])
    : Object.freeze([boxId]);
  return Object.freeze({
    ...chronicle,
    world: Object.freeze({
      ...chronicle.world,
      entities: Object.freeze({ ...chronicle.world.entities, [boxId as string]: existing ? { ...existing, ...box } : box }),
      locations: Object.freeze({
        ...chronicle.world.locations,
        [archivum as string]: Object.freeze({ id: archivum, illumination: location?.illumination ?? "lit", entityIds }),
      }),
    }),
  });
}

export interface TransferBoxView {
  readonly active: boolean;
  readonly located: boolean;
  readonly opened: boolean;
  readonly availableActions: readonly TransferBoxAction[];
  readonly text: string;
}

export function projectTransferBox(chronicle: ChronicleSaveV2): TransferBoxView {
  const persona = chronicle.personas[chronicle.activePersonaId as string];
  const question = chronicle.knowledgeByPersona[chronicle.activePersonaId as string]?.questions[questionId as string];
  const locationKnown = hasEvent(chronicle, "MiriamFolioLocationTestimonyReceived");
  const located = hasEvent(chronicle, "TransferBox7Located");
  const opened = hasEvent(chronicle, "TransferBox7Opened");
  const active = Boolean(persona?.currentLocation === archivum && question && locationKnown && question.status !== "answered");
  if (!active) return { active: false, located, opened, availableActions: [], text: "" };

  const actions: TransferBoxAction[] = [];
  if (!located) actions.push("locate_box_7");
  else if (!opened) actions.push("open_box_7");

  return {
    active: true,
    located,
    opened,
    availableActions: Object.freeze(actions),
    text: opened
      ? "A caixa 7 está aberta. Entre papéis de transferência, o fólio ausente está fisicamente presente."
      : located
        ? "A caixa de transferência 7 está diante de você, ainda lacrada. A inscrição confere com o ledger e com a informação de Miriam."
        : "Com a referência precisa de Miriam, você consegue procurar a caixa 7 no setor de transferências do Archivum.",
  };
}

function recordDirectObservation(chronicle: ChronicleSaveV2): ChronicleSaveV2 {
  const personaKey = chronicle.activePersonaId as string;
  const knowledge = chronicle.knowledgeByPersona[personaKey];
  const question = knowledge?.questions[questionId as string];
  if (!knowledge || !question) return chronicle;

  const claimId = "claim.folio.box-7-contains-folio" as ClaimId;
  const evidenceId = "evidence.folio.box-7-direct-observation" as EvidenceId;
  const ledgerClaim = "claim.folio.transfer-box-7" as ClaimId;
  const miriamClaim = "claim.miriam.folio-last-seen" as ClaimId;
  const rumourClaim = "claim.folio.rumour-box-3" as ClaimId;

  const claim: Claim = Object.freeze({
    id: claimId,
    subjectId: boxId,
    predicate: "contains",
    value: folioId,
    status: "observed",
    createdAt: chronicle.world.timestamp,
    sourceRefs: Object.freeze([evidenceId as string]),
  });
  const supports = [ledgerClaim, miriamClaim].filter((id) => Boolean(knowledge.claims[id as string]));
  const contradicts = [rumourClaim].filter((id) => Boolean(knowledge.claims[id as string]));
  const evidence: Evidence = Object.freeze({
    id: evidenceId,
    kind: "observation",
    producedAt: chronicle.world.timestamp,
    sourceRef: Object.freeze({ id: boxId, kind: "object" }),
    supports: Object.freeze([claimId, ...supports]),
    contradicts: Object.freeze(contradicts),
    payload: Object.freeze({ observedContainerId: boxId, observedDocumentId: folioId, direct: true }),
  });
  const answered = Object.freeze({
    ...question,
    status: "answered" as const,
    relatedClaims: Object.freeze([...new Set([...question.relatedClaims, claimId])]),
    relatedEvidence: Object.freeze([...new Set([...question.relatedEvidence, evidenceId])]),
  });
  const nextKnowledge = Object.freeze({
    ...knowledge,
    claims: Object.freeze({ ...knowledge.claims, [claimId as string]: claim }),
    evidence: Object.freeze({ ...knowledge.evidence, [evidenceId as string]: evidence }),
    questions: Object.freeze({ ...knowledge.questions, [questionId as string]: answered }),
  });
  return Object.freeze({
    ...chronicle,
    knowledgeByPersona: Object.freeze({ ...chronicle.knowledgeByPersona, [personaKey]: nextKnowledge }),
  });
}

export function applyTransferBoxAction(chronicle: ChronicleSaveV2, action: TransferBoxAction): ChronicleSaveV2 {
  const view = projectTransferBox(chronicle);
  if (!view.availableActions.includes(action)) return chronicle;

  if (action === "locate_box_7") {
    return append(materializeBox(chronicle, false), "TransferBox7Located", { boxId, locationId: archivum });
  }

  const opened = materializeBox(chronicle, true);
  const observed = recordDirectObservation(opened);
  return append(observed, "TransferBox7Opened", {
    boxId,
    folioId,
    outcome: "folio_present",
    questionId,
  });
}

export const TRANSFER_BOX_ACTION_LABEL: Readonly<Record<TransferBoxAction, string>> = Object.freeze({
  locate_box_7: "Localizar a caixa de transferência 7",
  open_box_7: "Abrir e inspecionar a caixa 7",
});

import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { askMiriamWhereFolioWasLastSeen, projectMiriamIgnisConversation } from "./consequence.js";
import { projectMemoryAssessments, type MemoryAssessmentView } from "./claim-assessment.js";
import {
  applyMemoryWitnessAction,
  MEMORY_WITNESS_ACTION_LABEL,
  projectMemoryWitnesses,
  type MemoryWitnessAction,
  type MemoryWitnessView,
} from "./memory-witnesses.js";
import {
  applyMissingFolioAction,
  MISSING_FOLIO_ACTION_LABEL,
  projectMissingFolioInvestigation,
  type MissingFolioAction,
  type MissingFolioView,
} from "./missing-folio.js";
import { projectRecoveredFolio, readRecoveredFolio, type RecoveredFolioView } from "./recovered-folio.js";
import {
  applyThreeWitnessAction,
  projectThreeWitnesses,
  THREE_WITNESS_ACTION_LABEL,
  type ThreeWitnessAction,
  type ThreeWitnessesView,
} from "./three-witnesses.js";
import {
  applyTransferBoxAction,
  projectTransferBox,
  TRANSFER_BOX_ACTION_LABEL,
  type TransferBoxAction,
  type TransferBoxView,
} from "./transfer-box.js";

export type PlayableLoopActionId =
  | `missing:${MissingFolioAction}`
  | "miriam:deeper"
  | `transfer:${TransferBoxAction}`
  | "folio:read"
  | `memory:${MemoryWitnessAction}`
  | `three:${ThreeWitnessAction}`;

export interface PlayableLoopAction {
  readonly id: PlayableLoopActionId;
  readonly label: string;
}

export interface PlayableLoopView {
  readonly missingFolio: MissingFolioView;
  readonly transferBox: TransferBoxView;
  readonly recoveredFolio: RecoveredFolioView;
  readonly memoryWitnesses: MemoryWitnessView;
  readonly threeWitnesses: ThreeWitnessesView;
  readonly memoryAssessments: MemoryAssessmentView;
  readonly actions: readonly PlayableLoopAction[];
  readonly narrativeFragments: readonly string[];
}

function hasEvent(chronicle: ChronicleSaveV2, type: string): boolean {
  return chronicle.eventLedger.some((event) => event.type === type);
}

export function projectPlayableLoop(chronicle: ChronicleSaveV2): PlayableLoopView {
  const missingFolio = projectMissingFolioInvestigation(chronicle);
  const transferBox = projectTransferBox(chronicle);
  const recoveredFolio = projectRecoveredFolio(chronicle);
  const memoryWitnesses = projectMemoryWitnesses(chronicle);
  const threeWitnesses = projectThreeWitnesses(chronicle);
  const miriam = projectMiriamIgnisConversation(chronicle);
  const knowledge = chronicle.knowledgeByPersona[chronicle.activePersonaId as string];
  const memoryAssessments = projectMemoryAssessments(knowledge ?? {
    nodes: {}, claims: {}, evidence: {}, questions: {},
  });

  const actions: PlayableLoopAction[] = [];
  for (const action of missingFolio.availableActions) {
    actions.push(Object.freeze({ id: `missing:${action}` as const, label: MISSING_FOLIO_ACTION_LABEL[action] }));
  }
  if (miriam.deeperAvailable) {
    actions.push(Object.freeze({ id: "miriam:deeper", label: "Perguntar a Miriam onde o fólio foi visto por último" }));
  }
  for (const action of transferBox.availableActions) {
    actions.push(Object.freeze({ id: `transfer:${action}` as const, label: TRANSFER_BOX_ACTION_LABEL[action] }));
  }
  if (recoveredFolio.active && !hasEvent(chronicle, "RecoveredFolioRead")) {
    actions.push(Object.freeze({ id: "folio:read", label: "Ler o fólio recuperado" }));
  }
  for (const action of memoryWitnesses.availableActions) {
    actions.push(Object.freeze({ id: `memory:${action}` as const, label: MEMORY_WITNESS_ACTION_LABEL[action] }));
  }
  for (const action of threeWitnesses.availableActions) {
    actions.push(Object.freeze({ id: `three:${action}` as const, label: THREE_WITNESS_ACTION_LABEL[action] }));
  }

  const narrativeFragments = [
    missingFolio.active ? missingFolio.text : "",
    miriam.deeperAvailable ? miriam.text : "",
    transferBox.active ? transferBox.text : "",
    recoveredFolio.active && recoveredFolio.textKeys.length > 0
      ? `O fólio revela ${recoveredFolio.textKeys.length} camada(s) legível(is); ${recoveredFolio.unreadLayerCount} permanecem fora do seu alcance atual.`
      : "",
    threeWitnesses.active ? threeWitnesses.text : "",
    memoryWitnesses.active ? memoryWitnesses.text : "",
  ].filter(Boolean);

  return Object.freeze({
    missingFolio,
    transferBox,
    recoveredFolio,
    memoryWitnesses,
    threeWitnesses,
    memoryAssessments,
    actions: Object.freeze(actions),
    narrativeFragments: Object.freeze(narrativeFragments),
  });
}

export function applyPlayableLoopAction(chronicle: ChronicleSaveV2, actionId: PlayableLoopActionId): ChronicleSaveV2 {
  if (actionId === "miriam:deeper") return askMiriamWhereFolioWasLastSeen(chronicle);
  if (actionId === "folio:read") return readRecoveredFolio(chronicle);
  if (actionId.startsWith("missing:")) return applyMissingFolioAction(chronicle, actionId.slice("missing:".length) as MissingFolioAction);
  if (actionId.startsWith("transfer:")) return applyTransferBoxAction(chronicle, actionId.slice("transfer:".length) as TransferBoxAction);
  if (actionId.startsWith("memory:")) return applyMemoryWitnessAction(chronicle, actionId.slice("memory:".length) as MemoryWitnessAction);
  return applyThreeWitnessAction(chronicle, actionId.slice("three:".length) as ThreeWitnessAction);
}

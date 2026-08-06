import {
  createLiberState,
  recordDiariumEntry,
  recordExperiment,
  syncLiberKnowledge,
  type LiberState,
} from "@hnk/liber-engine";
import { createEmptyKnowledgeState, type DomainEvent } from "@hnk/domain";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";

const ignisSequence = [
  "IgnisOilAdded",
  "IgnisWickPlaced",
  "IgnisWickSaturated",
  "CombustionStarted",
  "IgnisManuscriptRead",
] as const;

export function projectChronicleLiber(chronicle: ChronicleSaveV2): LiberState {
  const personaKey = chronicle.activePersonaId as string;
  const knowledge = chronicle.knowledgeByPersona[personaKey] ?? createEmptyKnowledgeState();
  let liber = syncLiberKnowledge(createLiberState(), knowledge);

  const sequenceEvents = ignisSequence
    .map((type) => chronicle.eventLedger.find((event) => event.type === type))
    .filter((event): event is DomainEvent => Boolean(event));
  const manuscriptRead = sequenceEvents.find((event) => event.type === "IgnisManuscriptRead");
  const combustion = sequenceEvents.find((event) => event.type === "CombustionStarted");
  const question = knowledge.questions["question.ignis.first-flame"];

  if (combustion && manuscriptRead) {
    liber = recordExperiment(liber, {
      id: "experiment.ignis.first-flame",
      at: manuscriptRead.occurredAt,
      inputRefs: Object.freeze(["material.oleum", "material.linum", "material.silex", "material.ferrum"]),
      actionRefs: Object.freeze(sequenceEvents.map((event) => event.id as string)),
      outcomeRefs: Object.freeze([combustion.id as string, manuscriptRead.id as string]),
      evidenceRefs: Object.freeze(question?.relatedEvidence.map((id) => id as string) ?? []),
    });
    liber = recordDiariumEntry(liber, {
      id: "diarium.ignis.first-flame",
      at: manuscriptRead.occurredAt,
      titleKey: "diarium.ignis.first_flame",
      eventRefs: Object.freeze(sequenceEvents.map((event) => event.id as string)),
    });
  }

  const integrated = chronicle.eventLedger.find((event) => event.type === "IgnisQuaestioIntegrated");
  if (integrated) {
    liber = recordDiariumEntry(liber, {
      id: "diarium.ignis.first-quaestio-answered",
      at: integrated.occurredAt,
      titleKey: "diarium.ignis.first_quaestio_answered",
      eventRefs: Object.freeze([integrated.id as string]),
    });
  }

  const testimony = chronicle.eventLedger.find((event) => event.type === "MiriamIgnisTestimonyReceived");
  if (testimony) {
    liber = recordDiariumEntry(liber, {
      id: "diarium.miriam.ignis-testimony",
      at: testimony.occurredAt,
      titleKey: "diarium.miriam.ignis_testimony",
      eventRefs: Object.freeze([testimony.id as string]),
    });
  }

  const folioRecovered = chronicle.eventLedger.find((event) => event.type === "TransferBox7Opened");
  if (folioRecovered) {
    liber = recordDiariumEntry(liber, {
      id: "diarium.ignis.missing-folio-recovered",
      at: folioRecovered.occurredAt,
      titleKey: "diarium.ignis.missing_folio_recovered",
      eventRefs: Object.freeze([folioRecovered.id as string]),
    });
  }

  return liber;
}

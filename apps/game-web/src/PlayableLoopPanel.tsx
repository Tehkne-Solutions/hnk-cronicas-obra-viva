import React, { useEffect, useRef } from "react";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { EvidenceAssessmentPanel } from "./EvidenceAssessmentPanel.js";
import { applyPlayableLoopAction, projectPlayableLoop } from "./playable-loop.js";
import { installGlobalObservability, observeChronicle, reportTelemetry } from "./telemetry.js";

export function PlayableLoopPanel({
  chronicle,
  onChange,
}: {
  chronicle: ChronicleSaveV2;
  onChange: (chronicle: ChronicleSaveV2) => void;
}) {
  const previous = useRef<ChronicleSaveV2 | null>(null);
  const view = projectPlayableLoop(chronicle);

  useEffect(() => installGlobalObservability(), []);
  useEffect(() => {
    observeChronicle(previous.current, chronicle);
    previous.current = chronicle;
    const persona = chronicle.personas[chronicle.activePersonaId as string];
    const knowledge = chronicle.knowledgeByPersona[chronicle.activePersonaId as string];
    const duplicateEventIds = chronicle.eventLedger
      .map((event) => String(event.id))
      .filter((id, index, ids) => ids.indexOf(id) !== index);
    if (!persona) reportTelemetry("active_persona_missing", { activePersonaId: chronicle.activePersonaId }, "error");
    if (persona?.currentLocation && !chronicle.world.locations[persona.currentLocation as string]) reportTelemetry("current_location_missing", { locationId: persona.currentLocation }, "error");
    if (!knowledge) reportTelemetry("knowledge_state_missing", { activePersonaId: chronicle.activePersonaId }, "error");
    if (duplicateEventIds.length > 0) reportTelemetry("duplicate_event_ids", { ids: [...new Set(duplicateEventIds)] }, "error");
    if (knowledge) {
      const unresolvedQuestionCount = Object.values(knowledge.questions).filter((question) => question.status !== "answered").length;
      reportTelemetry("gameplay_health_snapshot", {
        localActionCount: view.actions.length,
        unresolvedQuestionCount,
        eventCount: chronicle.eventLedger.length,
        scheduledConsequenceCount: chronicle.scheduledConsequences.length,
      });
    }
  }, [chronicle, view.actions.length]);

  const visible = view.actions.length > 0 || view.narrativeFragments.length > 0 || view.memoryAssessments.tomas || view.memoryAssessments.beatrice;
  if (!visible) return null;

  return <section className="playable-loop" aria-label="Percurso investigativo atual">
    {view.narrativeFragments.length > 0 && <div className="playable-loop-narrative">
      {view.narrativeFragments.map((fragment, index) => <p key={`${index}-${fragment.slice(0, 24)}`}>{fragment}</p>)}
    </div>}

    {view.threeWitnesses.active && <div className="witness-family-state" aria-label="Estado das Três Testemunhas">
      <span>Matéria: {view.threeWitnesses.families.matter ? "reunida" : "pendente"}</span>
      <span>Palavra: {view.threeWitnesses.families.word ? "reunida" : "pendente"}</span>
      <span>Memória: {view.threeWitnesses.families.memory ? "reunida" : "pendente"}</span>
    </div>}

    {view.actions.length > 0 && <div className="actions playable-loop-actions">
      {view.actions.map((action) => <button
        className="ignis-action"
        key={action.id}
        onClick={() => onChange(applyPlayableLoopAction(chronicle, action.id))}
      >{action.label}</button>)}
    </div>}

    <EvidenceAssessmentPanel view={view.memoryAssessments} />
  </section>;
}

import React from "react";
import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import { EvidenceAssessmentPanel } from "./EvidenceAssessmentPanel.js";
import { applyPlayableLoopAction, projectPlayableLoop } from "./playable-loop.js";

export function PlayableLoopPanel({
  chronicle,
  onChange,
}: {
  chronicle: ChronicleSaveV2;
  onChange: (chronicle: ChronicleSaveV2) => void;
}) {
  const view = projectPlayableLoop(chronicle);
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

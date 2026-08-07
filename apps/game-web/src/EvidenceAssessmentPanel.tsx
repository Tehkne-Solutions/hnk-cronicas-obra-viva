import React from "react";
import type { MemoryAssessmentView, ClaimAssessmentView } from "./claim-assessment.js";

function AssessmentRow({ title, assessment }: { title: string; assessment: ClaimAssessmentView }) {
  return <div className="evidence-assessment-row">
    <div>
      <strong>{title}</strong>
      <span>{assessment.label}</span>
    </div>
    <small>
      {assessment.supportingCount} apoia · {assessment.contradictingCount} contradiz
      {assessment.evidenceKinds.length > 0 ? ` · ${assessment.evidenceKinds.join(" / ")}` : ""}
    </small>
    {assessment.independence === "dependent" && <small>Fonte dependente</small>}
    {assessment.independence === "independent" && <small>Fonte independente</small>}
    {assessment.note && <p>{assessment.note}</p>}
  </div>;
}

export function EvidenceAssessmentPanel({ view }: { view: MemoryAssessmentView }) {
  const hasRows = view.tomas || view.beatrice || view.forumRumour || view.contamination;
  if (!hasRows) return null;

  return <section className="evidence-assessment" aria-label="Avaliação das evidências de memória">
    <p className="eyebrow">CORROBORATIO</p>
    <h3>Força e independência das fontes</h3>
    {view.tomas && <AssessmentRow title="Memória de Tomas" assessment={view.tomas} />}
    {view.beatrice && <AssessmentRow title="Memória de Beatrice" assessment={view.beatrice} />}
    {view.forumRumour && <AssessmentRow title="Rumor da caixa 3" assessment={view.forumRumour} />}
    {view.contamination && <AssessmentRow title="Contaminação por rumor" assessment={view.contamination} />}
    <p className="note">{view.summary}</p>
  </section>;
}

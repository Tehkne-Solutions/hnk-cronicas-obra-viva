import type { ControlCenterSnapshot } from "@hnk/telemetry-control-core";

function esc(value: unknown): string {
  return String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

function findingClass(level: string): string { return level === "fatal" || level === "error" ? "danger" : "warn"; }

export function renderDashboard(snapshot: ControlCenterSnapshot, meta: { mode: string; release: string; retentionDays: number }): string {
  const cards = [
    ["Eventos 24h", snapshot.totals.events], ["Sessões", snapshot.totals.sessions], ["Crônicas", snapshot.totals.chronicles],
    ["Erros", snapshot.totals.errors], ["Fatais", snapshot.totals.fatal], ["Warnings", snapshot.totals.warnings],
  ];
  const findings = snapshot.diagnostics.length === 0
    ? `<div class="empty">Nenhum diagnóstico preditivo ativo.</div>`
    : snapshot.diagnostics.slice(0, 30).map((item) => `<article class="finding ${findingClass(item.level)}"><strong>${esc(item.code)}</strong><span>${esc(item.summary)}</span><small>${esc(item.evidenceCount)} evidências · ${esc(item.sessionId ?? "sem sessão")}</small></article>`).join("");
  const errors = snapshot.topErrors.length === 0
    ? `<tr><td colspan="3">Nenhum erro no período.</td></tr>`
    : snapshot.topErrors.map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.source)}</td><td>${esc(item.count)}</td></tr>`).join("");
  const recent = snapshot.recentEvents.slice(0, 60).map((event) => `<tr class="level-${esc(event.level)}"><td>${esc(event.receivedAt.slice(11, 19))}</td><td>${esc(event.level)}</td><td>${esc(event.kind)}</td><td>${esc(event.name)}</td><td>${esc(event.locationId)}</td><td>${esc(event.sessionId.slice(0, 12))}</td></tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>HENUVOKODAN — Telemetry Control Center</title><style>
  :root{font-family:Inter,system-ui,sans-serif;color:#e8e4da;background:#10110f}*{box-sizing:border-box}body{margin:0;background:#10110f}main{width:min(1500px,calc(100% - 32px));margin:auto;padding:28px 0 60px}.top{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:22px}.eyebrow{letter-spacing:.2em;font-size:11px;color:#aaa28f}.meta{font-size:12px;color:#8d887c;text-align:right}h1{font-size:28px;margin:4px 0}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.card,.panel{border:1px solid #34362f;background:#171915;border-radius:8px}.card{padding:16px}.card span{display:block;color:#918b7f;font-size:12px}.card strong{display:block;font-size:25px;margin-top:5px}.sections{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.panel{padding:18px}.panel h2{font-size:15px;margin:0 0 14px;color:#d4ccb9}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.metric{padding:12px;border:1px solid #30332c}.metric span{font-size:11px;color:#918b7f}.metric strong{display:block;font-size:20px;margin-top:4px}.finding{display:grid;gap:4px;border-left:3px solid #c3994f;padding:9px 12px;background:#202018;margin-bottom:8px}.finding.danger{border-color:#c95c54}.finding span{font-size:13px}.finding small{color:#999284}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:8px;border-bottom:1px solid #2b2d28}th{color:#8f897d;font-weight:500}.wide{grid-column:1/-1}.empty{color:#888276;font-size:13px}.level-error td,.level-fatal td{color:#e68f87}.level-warn td{color:#d9bc78}@media(max-width:900px){.grid{grid-template-columns:repeat(3,1fr)}.sections{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.meta{text-align:left}}@media(max-width:520px){.grid{grid-template-columns:repeat(2,1fr)}.metrics{grid-template-columns:1fr}table{display:block;overflow:auto}}
  </style></head><body><main><header class="top"><div><div class="eyebrow">TEHKNÉ SOLUTIONS · OBSERVABILITY</div><h1>HENUVOKODAN — Telemetry Control Center</h1></div><div class="meta">storage: ${esc(meta.mode)} · release: ${esc(meta.release)} · retenção: ${meta.retentionDays} dias<br>gerado ${esc(snapshot.generatedAt)}</div></header>
  <section class="grid">${cards.map(([label, value]) => `<div class="card"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</section>
  <section class="sections"><div class="panel"><h2>Performance & Persistência</h2><div class="metrics"><div class="metric"><span>IndexedDB lento</span><strong>${snapshot.performance.slowPersistence}</strong></div><div class="metric"><span>P95 IndexedDB</span><strong>${snapshot.performance.p95PersistenceMs === null ? "—" : `${Math.round(snapshot.performance.p95PersistenceMs)} ms`}</strong></div><div class="metric"><span>Long tasks</span><strong>${snapshot.performance.longTasks}</strong></div></div></div>
  <div class="panel"><h2>Progresso da Crônica</h2><div class="metrics"><div class="metric"><span>Primeiras chamas</span><strong>${snapshot.progress.combustionStarted}</strong></div><div class="metric"><span>Fólios recuperados</span><strong>${snapshot.progress.foliosRecovered}</strong></div><div class="metric"><span>Três Testemunhas</span><strong>${snapshot.progress.threeWitnessesCompleted}</strong></div></div></div>
  <div class="panel"><h2>Diagnósticos preditivos</h2>${findings}</div><div class="panel"><h2>Top erros</h2><table><thead><tr><th>Erro</th><th>Origem</th><th>Qtd.</th></tr></thead><tbody>${errors}</tbody></table></div>
  <div class="panel wide"><h2>Timeline recente</h2><table><thead><tr><th>Hora</th><th>Nível</th><th>Tipo</th><th>Evento</th><th>Local</th><th>Sessão</th></tr></thead><tbody>${recent || `<tr><td colspan="6">Sem eventos.</td></tr>`}</tbody></table></div></section>
  </main></body></html>`;
}

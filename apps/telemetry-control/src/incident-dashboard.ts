import type { ControlCenterSnapshot, StoredTelemetryEvent } from "@hnk/telemetry-control-core";
import { deriveIncidentIntelligence, type IncidentIntelligence } from "./incident-intelligence.js";

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char));
}

function labelState(state: IncidentIntelligence["state"]): string {
  if (state === "new") return "Novo";
  if (state === "recurrent") return "Reincidente";
  return "Regressão conhecida";
}

function priority(incident: IncidentIntelligence): number {
  const severity = incident.severity === "fatal" ? 100 : 50;
  const recurrence = incident.state === "recurrent" ? 30 : incident.state === "known_regression" ? 20 : 10;
  return severity + recurrence + Math.min(incident.occurrences, 20);
}

function collectIncidents(events: readonly StoredTelemetryEvent[]): readonly IncidentIntelligence[] {
  const regressions = events.filter((event) => event.name === "promotion_rollback_required" || event.name === "post_release_sentinel_fail");
  const byFingerprint = new Map<string, IncidentIntelligence>();
  for (const event of regressions) {
    const incident = deriveIncidentIntelligence(event, regressions.filter((item) => item.id !== event.id));
    if (!incident) continue;
    const current = byFingerprint.get(incident.fingerprint);
    if (!current || incident.lastSeenAt > current.lastSeenAt) byFingerprint.set(incident.fingerprint, incident);
  }
  return Object.freeze([...byFingerprint.values()].sort((a, b) => priority(b) - priority(a) || b.lastSeenAt.localeCompare(a.lastSeenAt)));
}

export function renderIncidentDashboard(snapshot: ControlCenterSnapshot, meta: { readonly mode: string; readonly release: string }): string {
  const incidents = collectIncidents(snapshot.recentEvents);
  const totals = {
    all: incidents.length,
    fresh: incidents.filter((item) => item.state === "new").length,
    recurrent: incidents.filter((item) => item.state === "recurrent").length,
    known: incidents.filter((item) => item.state === "known_regression").length,
  };
  const domains = new Map<string, number>();
  for (const incident of incidents) domains.set(incident.domain, (domains.get(incident.domain) ?? 0) + 1);
  const rows = incidents.map((incident) => `<tr>
    <td>${esc(incident.lastSeenAt.slice(5, 16).replace("T", " "))}</td>
    <td><span class="badge ${incident.severity === "fatal" ? "danger" : "warn"}">${esc(labelState(incident.state))}</span></td>
    <td>${esc(incident.domain)}</td>
    <td><code>${esc(incident.fingerprint)}</code></td>
    <td>${incident.occurrences}</td>
    <td>${incident.affectedBuildShas.map((sha) => `<code>${esc(sha.slice(0, 8))}</code>`).join(" ") || "—"}</td>
    <td class="failure">${esc(incident.failures.join(" · ") || "none")}</td>
    <td>${esc(incident.recommendedAction)}</td>
  </tr>`).join("");
  const domainMetrics = [...domains.entries()].sort((a, b) => b[1] - a[1]).map(([domain, count]) => `<div class="metric"><span>${esc(domain)}</span><strong>${count}</strong></div>`).join("") || `<div class="empty">Nenhum domínio com incidente na janela.</div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>HENUVOKODAN — Incident Ledger</title><style>
  :root{font-family:Inter,system-ui,sans-serif;color:#e8e4da;background:#10110f}*{box-sizing:border-box}body{margin:0;background:#10110f}main{width:min(1500px,calc(100% - 32px));margin:auto;padding:28px 0 60px}a{color:#d5c397;text-decoration:none}.top{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:20px}.eyebrow{letter-spacing:.18em;font-size:11px;color:#aaa28f}h1{font-size:28px;margin:4px 0 0}.meta{font-size:12px;color:#8d887c;text-align:right}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}.card,.panel{border:1px solid #34362f;background:#171915;border-radius:8px}.card{padding:16px}.card span,.metric span{display:block;color:#918b7f;font-size:11px}.card strong,.metric strong{display:block;font-size:25px;margin-top:5px}.panel{padding:18px;margin-bottom:14px}.panel h2{font-size:15px;margin:0 0 14px;color:#d4ccb9}.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:9px}.metric{padding:12px;border:1px solid #30332c}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px;min-width:1200px}th,td{text-align:left;padding:9px;border-bottom:1px solid #2b2d28;vertical-align:top}th{color:#8f897d;font-weight:500}.badge{display:inline-block;border:1px solid #444;border-radius:999px;padding:3px 7px;white-space:nowrap}.badge.warn{border-color:#c3994f}.badge.danger{border-color:#c95c54}.failure{max-width:320px;color:#b9ad95}.empty{color:#888276;font-size:13px}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#c8bda4}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.metrics{grid-template-columns:repeat(2,1fr)}.top{align-items:flex-start;flex-direction:column}.meta{text-align:left}}@media(max-width:520px){.grid,.metrics{grid-template-columns:1fr}}
  </style></head><body><main><header class="top"><div><div class="eyebrow">TEHKNÉ SOLUTIONS · INCIDENT INTELLIGENCE</div><h1>Incident Ledger</h1></div><div class="meta"><a href="/control">← Control Center</a> · <a href="/promotions">Promotion Ledger</a><br>storage: ${esc(meta.mode)} · release: ${esc(meta.release)}<br>gerado ${esc(snapshot.generatedAt)}</div></header><section class="grid"><div class="card"><span>Incidentes agrupados</span><strong>${totals.all}</strong></div><div class="card"><span>Novos</span><strong>${totals.fresh}</strong></div><div class="card"><span>Reincidentes</span><strong>${totals.recurrent}</strong></div><div class="card"><span>Conhecidos</span><strong>${totals.known}</strong></div></section><section class="panel"><h2>Incidentes por domínio</h2><div class="metrics">${domainMetrics}</div></section><section class="panel"><h2>Ledger por fingerprint</h2>${rows ? `<div class="table-wrap"><table><thead><tr><th>Última ocorrência</th><th>Estado</th><th>Domínio</th><th>Fingerprint</th><th>Ocorrências</th><th>SHAs afetados</th><th>Falhas</th><th>Ação recomendada</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">Nenhum incidente pós-release detectado na janela.</div>`}</section></main></body></html>`;
}

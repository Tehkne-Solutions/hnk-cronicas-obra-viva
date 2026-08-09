import type { ControlCenterSnapshot } from "@hnk/telemetry-control-core";
import { derivePromotionLedger, type PromotionHealth, type RegressionDomain } from "./promotion-ledger.js";

function esc(value: unknown): string {
  return String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

function healthLabel(health: PromotionHealth): string {
  if (health === "healthy") return "Saudável";
  if (health === "degraded") return "Degradada";
  if (health === "rollback_required") return "Rollback requerido";
  return "Desconhecida";
}

function healthClass(health: PromotionHealth): string {
  if (health === "healthy") return "ok";
  if (health === "degraded") return "warn";
  if (health === "rollback_required") return "danger";
  return "neutral";
}

function domainLabel(domain: RegressionDomain): string {
  if (domain === "runtime") return "Runtime";
  if (domain === "persistence") return "Persistência";
  if (domain === "performance") return "Performance";
  if (domain === "progression") return "Progressão";
  if (domain === "release_infrastructure") return "Release / Infraestrutura";
  return "Indeterminado";
}

export function renderPromotionDashboard(snapshot: ControlCenterSnapshot, meta: { release: string; mode: string }): string {
  const ledger = derivePromotionLedger(snapshot.recentEvents);
  const latest = ledger[0] ?? null;
  const healthy = ledger.filter((item) => item.health === "healthy").length;
  const degraded = ledger.filter((item) => item.health === "degraded").length;
  const rollbackRequired = ledger.filter((item) => item.health === "rollback_required").length;
  const unknown = ledger.filter((item) => item.health === "unknown").length;
  const domainCounts = new Map<RegressionDomain, number>();
  for (const item of ledger) for (const domain of item.regressionDomains) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  const topDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const rows = ledger.length === 0
    ? `<tr><td colspan="8" class="empty">Nenhuma promoção observada no período.</td></tr>`
    : ledger.slice(0, 30).map((item) => `<tr>
      <td>${esc(item.promotedAt.slice(5, 16).replace("T", " "))}</td>
      <td><span class="badge ${healthClass(item.health)}">${esc(healthLabel(item.health))}</span></td>
      <td>${esc(item.candidateSha?.slice(0, 8) ?? "—")}</td>
      <td>${esc(item.sentinelStatus)}</td>
      <td>${esc(item.verifiedManifestSha?.slice(0, 8) ?? "—")}</td>
      <td>${item.regressionDomains.length ? item.regressionDomains.map((domain) => `<span class="domain">${esc(domainLabel(domain))}</span>`).join(" ") : "—"}</td>
      <td>${esc(item.authorizationId?.slice(0, 26) ?? "—")}</td>
      <td class="failures">${esc(item.failures.length ? item.failures.join(" · ") : "none")}</td>
    </tr>`).join("");
  const domainCards = topDomains.length === 0
    ? `<div class="empty">Nenhuma regressão classificada.</div>`
    : topDomains.map(([domain, count]) => `<div class="metric"><span>${esc(domainLabel(domain))}</span><strong>${count}</strong></div>`).join("");
  const latestPanel = latest
    ? `<section class="hero ${healthClass(latest.health)}"><div><div class="eyebrow">ÚLTIMA PROMOÇÃO</div><h2>${esc(healthLabel(latest.health))}</h2><p>${esc(latest.candidateSha?.slice(0, 12) ?? "sem SHA")} · sentinel ${esc(latest.sentinelStatus)}</p></div><div class="hero-meta"><span>Manifest</span><strong>${esc(latest.verifiedManifestSha?.slice(0, 12) ?? "—")}</strong><span>Domínios</span><strong>${esc(latest.regressionDomains.length ? latest.regressionDomains.map(domainLabel).join(", ") : "nenhum")}</strong></div></section>`
    : `<section class="hero neutral"><div><div class="eyebrow">ÚLTIMA PROMOÇÃO</div><h2>Sem dados</h2><p>Nenhuma promoção observada no período.</p></div></section>`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>HENUVOKODAN — Promotion Ledger</title><style>
  :root{font-family:Inter,system-ui,sans-serif;color:#e8e4da;background:#10110f}*{box-sizing:border-box}body{margin:0;background:#10110f}main{width:min(1500px,calc(100% - 32px));margin:auto;padding:28px 0 60px}a{color:#d5c397;text-decoration:none}.top{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:20px}.eyebrow{letter-spacing:.18em;font-size:11px;color:#aaa28f}h1{font-size:28px;margin:4px 0 0}.meta{font-size:12px;color:#8d887c;text-align:right}.hero,.panel,.card{border:1px solid #34362f;background:#171915;border-radius:8px}.hero{display:flex;justify-content:space-between;gap:24px;padding:20px;margin-bottom:14px;border-left:4px solid #5a5f55}.hero.ok{border-left-color:#71956a}.hero.warn{border-left-color:#c3994f}.hero.danger{border-left-color:#c95c54}.hero h2{margin:5px 0 3px;font-size:25px}.hero p{margin:0;color:#999284}.hero-meta{display:grid;grid-template-columns:auto auto;gap:6px 16px;align-content:center}.hero-meta span{font-size:11px;color:#8f897d}.hero-meta strong{font-size:12px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}.card{padding:16px}.card span,.metric span{display:block;color:#918b7f;font-size:11px}.card strong{display:block;font-size:25px;margin-top:5px}.panel{padding:18px;margin-bottom:14px}.panel h2{font-size:15px;margin:0 0 14px;color:#d4ccb9}.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:9px}.metric{padding:12px;border:1px solid #30332c}.metric strong{display:block;font-size:20px;margin-top:4px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px;min-width:1050px}th,td{text-align:left;padding:9px;border-bottom:1px solid #2b2d28;vertical-align:top}th{color:#8f897d;font-weight:500}.badge,.domain{display:inline-block;border:1px solid #444;border-radius:999px;padding:3px 7px;white-space:nowrap}.badge.ok{border-color:#71956a}.badge.warn{border-color:#c3994f}.badge.danger{border-color:#c95c54}.domain{margin:0 3px 3px 0;color:#c8bda4}.failures{max-width:340px;color:#b9ad95}.empty{color:#888276;font-size:13px}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.metrics{grid-template-columns:repeat(2,1fr)}.top,.hero{align-items:flex-start;flex-direction:column}.meta{text-align:left}}@media(max-width:520px){.grid,.metrics{grid-template-columns:1fr}}
  </style></head><body><main><header class="top"><div><div class="eyebrow">TEHKNÉ SOLUTIONS · OBSERVABILITY</div><h1>Promotion & Post-Release Ledger</h1></div><div class="meta"><a href="/control">← Control Center</a><br>storage: ${esc(meta.mode)} · release: ${esc(meta.release)}<br>gerado ${esc(snapshot.generatedAt)}</div></header>${latestPanel}<section class="grid"><div class="card"><span>Promoções observadas</span><strong>${ledger.length}</strong></div><div class="card"><span>Saudáveis</span><strong>${healthy}</strong></div><div class="card"><span>Degradadas</span><strong>${degraded}</strong></div><div class="card"><span>Rollback requerido</span><strong>${rollbackRequired}</strong></div></section><section class="panel"><h2>Regressões por domínio</h2><div class="metrics">${domainCards}${unknown ? `<div class="metric"><span>Saúde desconhecida</span><strong>${unknown}</strong></div>` : ""}</div></section><section class="panel"><h2>Histórico de promoções</h2><div class="table-wrap"><table><thead><tr><th>Quando</th><th>Saúde</th><th>SHA</th><th>Sentinela</th><th>Manifest</th><th>Domínios</th><th>Authorization</th><th>Falhas</th></tr></thead><tbody>${rows}</tbody></table></div></section></main></body></html>`;
}

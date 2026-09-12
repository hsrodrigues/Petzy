// ================= BI Avançado (plano Premium) =================
// Três painéis calculados a partir dos dados que já existem no Petzy: clientes ativos por mês
// (retenção simplificada), LTV (valor vitalício) dos tutores e previsão de ruptura de estoque com
// base no consumo médio recente. Tudo calculado no navegador a partir do que já é lido pelas outras
// telas — nenhuma coleção nova além do necessário, nenhuma promessa de "IA" que não existe de verdade.
import { list, loadTutoresPets } from '../store.js';
import { $, esc, pageHeader, empty, money, num, toISODate } from '../ui.js';

export async function render(view) {
  view.innerHTML = pageHeader('BI Avançado', 'Retenção, valor vitalício dos clientes e previsão de ruptura de estoque') + '<div class="loading"><div class="spinner-border"></div></div>';

  const [{ clientes, C }, vendas, ags, produtos] = await Promise.all([
    loadTutoresPets(), list('vendas'), list('agendamentos'), list('produtos')
  ]);
  const vOk = vendas.filter(v => v.status !== 'cancelada');
  const agsFaturados = ags.filter(a => a.faturado);

  view.innerHTML = `
    ${pageHeader('BI Avançado', 'Retenção, valor vitalício dos clientes e previsão de ruptura de estoque')}
    <div class="row g-3 mb-4">
      <div class="col-lg-6">
        <div class="card h-100"><div class="card-header">Clientes ativos por mês <span class="text-muted fw-normal fs-7">· últimos 6 meses</span></div>
        <div class="card-body"><canvas id="chRetencao" height="140"></canvas></div></div>
      </div>
      <div class="col-lg-6">
        <div class="card h-100"><div class="card-header d-flex justify-content-between"><span>Top 20 · valor vitalício (LTV)</span><span class="fs-7 text-muted">Total histórico, sem filtro de período</span></div>
        <div class="table-responsive" style="max-height:340px;overflow:auto"><table class="table table-sm mb-0"><thead><tr><th>Tutor</th><th class="text-end">LTV</th></tr></thead><tbody id="tbLtv"></tbody></table></div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="bi bi-graph-down-arrow text-danger me-1"></i>Previsão de ruptura de estoque</span>
        <span class="fs-7 text-muted">Consumo médio dos últimos 60 dias de vendas</span>
      </div>
      <div class="table-responsive"><table class="table"><thead><tr><th>Produto</th><th class="text-end">Estoque</th><th class="text-end">Consumo/dia</th><th class="text-end">Dias restantes</th></tr></thead>
      <tbody id="tbRuptura"></tbody></table></div>
    </div>`;

  // ---------- clientes ativos por mês ----------
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
    meses.push({ k: toISODate(d).slice(0, 7), l: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') });
  }
  const ativosPorMes = meses.map(m => {
    const s = new Set();
    vOk.forEach(v => v.clienteId && v.data?.startsWith(m.k) && s.add(v.clienteId));
    agsFaturados.forEach(a => a.clienteId && a.inicio?.startsWith(m.k) && s.add(a.clienteId));
    return s.size;
  });
  new Chart($('#chRetencao', view), {
    type: 'bar',
    data: { labels: meses.map(m => m.l), datasets: [{ label: 'Clientes ativos', data: ativosPorMes, backgroundColor: '#6c5ce7', borderRadius: 8, maxBarThickness: 40 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f0f0f6' } }, x: { grid: { display: false } } } }
  });

  // ---------- LTV ----------
  const ltv = {};
  vOk.forEach(v => v.clienteId && (ltv[v.clienteId] = (ltv[v.clienteId] || 0) + v.total));
  agsFaturados.forEach(a => a.clienteId && (ltv[a.clienteId] = (ltv[a.clienteId] || 0) + (a.valor || 0)));
  const topLtv = Object.entries(ltv).sort((a, b) => b[1] - a[1]).slice(0, 20);
  $('#tbLtv', view).innerHTML = topLtv.length ? topLtv.map(([id, v]) => `<tr><td class="fs-7">${esc(C[id]?.nome || '—')}</td><td class="text-end fw-semibold fs-7">${money(v)}</td></tr>`).join('')
    : `<tr><td colspan="2">${empty('cash-coin', 'Sem vendas/atendimentos faturados ainda.')}</td></tr>`;

  // ---------- previsão de ruptura de estoque ----------
  const dias60 = toISODate(new Date(Date.now() - 60 * 86400000));
  const consumo = {}; // produtoId -> unidades vendidas nos últimos 60 dias
  vOk.filter(v => v.data >= dias60).forEach(v => v.itens.forEach(i => { if (i.tipo !== 'servico') consumo[i.id] = (consumo[i.id] || 0) + i.qtd; }));
  const prods = produtos.filter(p => p.tipo !== 'servico' && (p.estoque ?? 0) > 0)
    .map(p => {
      const total60 = consumo[p.id] || 0;
      const porDia = total60 / 60;
      const dias = porDia > 0 ? (p.estoque || 0) / porDia : null;
      return { ...p, porDia, dias };
    })
    .filter(p => p.dias != null)
    .sort((a, b) => a.dias - b.dias);
  $('#tbRuptura', view).innerHTML = prods.length ? prods.slice(0, 30).map(p => `
    <tr class="${p.dias <= 7 ? 'table-danger' : p.dias <= 15 ? 'table-warning' : ''}">
      <td class="fs-7">${esc(p.nome)}</td><td class="text-end fs-7">${num(p.estoque || 0)} ${esc(p.unidade || 'un')}</td>
      <td class="text-end fs-7">${num(p.porDia, 2)}/dia</td>
      <td class="text-end fw-semibold fs-7">${Math.round(p.dias)} dia${Math.round(p.dias) === 1 ? '' : 's'}</td>
    </tr>`).join('') : `<tr><td colspan="4">${empty('box-seam', 'Sem histórico de vendas suficiente nos últimos 60 dias para estimar consumo.')}</td></tr>`;
}

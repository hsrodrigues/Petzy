import { list, loadTutoresPets, where } from '../store.js';
import { $, esc, pageHeader, money, num, kpi, today, toISODate, addDays, fmtDate, exportCSV, empty } from '../ui.js';

let charts = [];

export async function render(view) {
  const dados = await loadTutoresPets();
  const { C } = dados;

  view.innerHTML = `
    ${pageHeader('Relatórios', 'Indicadores de desempenho da clínica',
      `<div class="d-flex gap-2 align-items-center flex-wrap">
        <select class="form-select w-auto" id="preset">
          <option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option><option value="mes">Este mês</option><option value="ano">Este ano</option><option value="custom">Personalizado</option>
        </select>
        <input type="date" class="form-control w-auto" id="ini"><input type="date" class="form-control w-auto" id="fim">
        <button class="btn btn-light border" id="btnCsv"><i class="bi bi-download me-1"></i>CSV</button>
      </div>`)}
    <div id="conteudo"></div>`;

  let exportRows = [];

  function aplicarPreset() {
    const p = $('#preset', view).value, h = new Date();
    if (p === 'custom') return;
    $('#fim', view).value = today();
    $('#ini', view).value = p === 'mes' ? today().slice(0, 8) + '01' : p === 'ano' ? `${h.getFullYear()}-01-01` : toISODate(addDays(h, -Number(p) + 1));
  }

  async function carregar() {
    const ini = $('#ini', view).value, fim = $('#fim', view).value;
    const fimX = toISODate(addDays(new Date(fim + 'T00:00'), 1));
    $('#conteudo', view).innerHTML = '<div class="loading"><div class="spinner-border"></div></div>';

    const [vendas, fin, ags, atend] = await Promise.all([
      list('vendas', where('data', '>=', ini), where('data', '<', fimX)),
      list('financeiro', where('vencimento', '>=', ini), where('vencimento', '<', fimX)),
      list('agendamentos', where('inicio', '>=', ini), where('inicio', '<', fimX)),
      list('atendimentos', where('data', '>=', ini), where('data', '<', fimX))
    ]);
    const novosClientes = dados.clientes.filter(c => c.criadoEm >= ini && c.criadoEm < fimX).length;

    const vOk = vendas.filter(v => v.status !== 'cancelada');
    const receita = fin.filter(f => f.tipo === 'receita' && f.pago).reduce((s, f) => s + f.valor, 0);
    const despesa = fin.filter(f => f.tipo === 'despesa' && f.pago).reduce((s, f) => s + f.valor, 0);
    const ticket = vOk.length ? vOk.reduce((s, v) => s + v.total, 0) / vOk.length : 0;
    const concl = ags.filter(a => a.status === 'concluido').length;
    const faltas = ags.filter(a => a.status === 'faltou').length;
    const custoVendido = vOk.flatMap(v => v.itens).reduce((s, i) => s + (i.custo || 0) * i.qtd, 0);
    const brutoVendas = vOk.reduce((s, v) => s + v.total, 0);

    // ranking de itens vendidos
    const rank = {};
    vOk.forEach(v => v.itens.forEach(i => { rank[i.nome] ??= { qtd: 0, total: 0, tipo: i.tipo }; rank[i.nome].qtd += i.qtd; rank[i.nome].total += i.preco * i.qtd; }));
    const top = Object.entries(rank).sort((a, b) => b[1].total - a[1].total).slice(0, 10);

    // melhores clientes (vendas + agendamentos concluídos)
    const cli = {};
    vOk.forEach(v => v.clienteId && (cli[v.clienteId] = (cli[v.clienteId] || 0) + v.total));
    ags.filter(a => a.faturado).forEach(a => a.clienteId && (cli[a.clienteId] = (cli[a.clienteId] || 0) + (a.valor || 0)));
    const topCli = Object.entries(cli).sort((a, b) => b[1] - a[1]).slice(0, 8);

    exportRows = top.map(([nome, r]) => ({ Item: nome, Tipo: r.tipo, Quantidade: r.qtd, Total: r.total.toFixed(2).replace('.', ',') }));

    $('#conteudo', view).innerHTML = `
      <div class="row g-3 mb-3">
        <div class="col-6 col-xl-3">${kpi('cash-stack', 'Receita recebida', money(receita), 'success')}</div>
        <div class="col-6 col-xl-3">${kpi('graph-down-arrow', 'Despesas pagas', money(despesa), 'danger')}</div>
        <div class="col-6 col-xl-3">${kpi('piggy-bank', 'Lucro operacional', money(receita - despesa), 'primary')}</div>
        <div class="col-6 col-xl-3">${kpi('receipt', 'Ticket médio PDV', money(ticket), 'info')}</div>
        <div class="col-6 col-xl-3">${kpi('check2-circle', 'Atendimentos concluídos', concl, 'success')}</div>
        <div class="col-6 col-xl-3">${kpi('clipboard2-pulse', 'Consultas registradas', atend.length, 'primary')}</div>
        <div class="col-6 col-xl-3">${kpi('person-x', 'Taxa de faltas', ags.length ? num((faltas / ags.length) * 100, 1) + '%' : '0%', 'warning')}</div>
        <div class="col-6 col-xl-3">${kpi('person-plus', 'Novos tutores', novosClientes, 'info')}</div>
      </div>
      <div class="row g-3 mb-3">
        <div class="col-lg-8"><div class="card h-100"><div class="card-header">Receita por dia</div><div class="card-body"><canvas id="chDia" height="110"></canvas></div></div></div>
        <div class="col-lg-4"><div class="card h-100"><div class="card-header">Formas de pagamento (PDV)</div><div class="card-body d-flex align-items-center justify-content-center">${vOk.length ? '<canvas id="chPag"></canvas>' : empty('credit-card', 'Sem vendas no período')}</div></div></div>
      </div>
      <div class="row g-3">
        <div class="col-lg-7"><div class="card h-100"><div class="card-header d-flex justify-content-between"><span>Top produtos & serviços (PDV)</span>
          <span class="fs-7 text-muted">Margem bruta: <strong>${brutoVendas ? num(((brutoVendas - custoVendido) / brutoVendas) * 100, 1) : 0}%</strong></span></div>
          <div class="table-responsive"><table class="table"><thead><tr><th>#</th><th>Item</th><th class="text-end">Qtd</th><th class="text-end">Total</th></tr></thead><tbody>
          ${top.length ? top.map(([n, r], i) => `<tr><td class="text-muted">${i + 1}</td><td class="fs-7 fw-semibold">${esc(n)}</td><td class="text-end fs-7">${num(r.qtd)}</td><td class="text-end fw-semibold">${money(r.total)}</td></tr>`).join('') : `<tr><td colspan="4" class="text-center text-muted py-4">Sem vendas</td></tr>`}
          </tbody></table></div></div></div>
        <div class="col-lg-5"><div class="card h-100"><div class="card-header">Melhores clientes</div><div class="list-group list-group-flush">
          ${topCli.length ? topCli.map(([id, v], i) => `<div class="list-group-item d-flex justify-content-between align-items-center"><span class="fs-7"><span class="text-muted me-2">${i + 1}.</span>${esc(C[id]?.nome || '—')}</span><strong class="fs-7">${money(v)}</strong></div>`).join('') : '<div class="p-4 text-center text-muted fs-7">Sem dados</div>'}
        </div></div></div>
      </div>`;

    charts.forEach(c => c.destroy()); charts = [];
    const dias = []; for (let d = new Date(ini + 'T00:00'); toISODate(d) <= fim; d = addDays(d, 1)) dias.push(toISODate(d));
    const porDia = dias.map(d => fin.filter(f => f.tipo === 'receita' && f.pago && (f.pagoEm || f.vencimento) === d).reduce((s, f) => s + f.valor, 0));
    charts.push(new Chart($('#chDia', view), {
      type: 'line',
      data: { labels: dias.map(d => fmtDate(d).slice(0, 5)), datasets: [{ label: 'Receita', data: porDia, borderColor: '#6c5ce7', backgroundColor: 'rgba(108,92,231,.12)', fill: true, tension: .35, pointRadius: dias.length > 40 ? 0 : 3 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => money(c.raw) } } }, scales: { y: { beginAtZero: true, grid: { color: '#f0f0f6' } }, x: { grid: { display: false } } } }
    }));
    if (vOk.length) {
      const pag = {}; vOk.forEach(v => pag[v.pagamento] = (pag[v.pagamento] || 0) + v.total);
      charts.push(new Chart($('#chPag', view), {
        type: 'doughnut',
        data: { labels: Object.keys(pag), datasets: [{ data: Object.values(pag), backgroundColor: ['#6c5ce7', '#00b894', '#0ea5e9', '#f59e0b', '#ef4444'], borderWidth: 0 }] },
        options: { cutout: '65%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } }, tooltip: { callbacks: { label: c => `${c.label}: ${money(c.raw)}` } } } }
      }));
    }
  }

  $('#preset', view).onchange = () => { aplicarPreset(); carregar(); };
  $('#ini', view).onchange = $('#fim', view).onchange = () => { $('#preset', view).value = 'custom'; carregar(); };
  $('#btnCsv', view).onclick = () => exportCSV('relatorio-itens.csv', exportRows);

  aplicarPreset();
  await carregar();
}

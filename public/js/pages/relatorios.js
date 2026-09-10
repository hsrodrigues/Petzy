import { state, list, loadTutoresPets, where } from '../store.js';
import { $, esc, pageHeader, money, num, kpi, today, toISODate, addDays, fmtDate, exportCSV, empty, toast } from '../ui.js';

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
        <button class="btn btn-light border" id="limparFiltros" title="Limpar filtros"><i class="bi bi-x-circle me-1"></i>Limpar</button>
        <button class="btn btn-light border" id="btnCsv"><i class="bi bi-download me-1"></i>CSV</button>
        <button class="btn btn-outline-primary" id="btnGerencial"><i class="bi bi-file-earmark-pdf me-1"></i>Relatório PDF</button>
        <button class="btn btn-primary" id="btnDre"><i class="bi bi-file-earmark-bar-graph me-1"></i>DRE para contador</button>
      </div>`)}
    <div id="conteudo"></div>`;

  let exportRows = [];
  let relatorioAtual = null;

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
    const porCategoria = (tipo, somentePagos = true) => fin.filter(f => f.tipo === tipo && (!somentePagos || f.pago)).reduce((acc, f) => {
      const chave = f.categoria || 'Outros';
      acc[chave] = (acc[chave] || 0) + (Number(f.valor) || 0);
      return acc;
    }, {});
    relatorioAtual = {
      ini, fim, receita, despesa, resultado: receita - despesa, brutoVendas, custoVendido, ticket,
      concl, faltas, novosClientes, vendas: vOk.length, fiado: fin.filter(f => f.tipo === 'receita' && !f.pago && f.formaPagamento === 'Fiado (a receber)').reduce((s, f) => s + (f.valor || 0), 0),
      receitasCategoria: porCategoria('receita'), despesasCategoria: porCategoria('despesa'), top, topCli: topCli.map(([id, valor]) => ({ nome: C[id]?.nome || '—', valor })),
      clinica: state.clinica || {}
    };

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

  const linhas = (obj, negativo = false) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([nome, valor]) => `<tr><td>${esc(nome)}</td><td class="num ${negativo ? 'negativo' : ''}">${negativo ? '− ' : ''}${money(valor)}</td></tr>`).join('');
  const tabelaItens = (itens) => itens.length ? itens.map(([nome, r], i) => `<tr><td>${i + 1}</td><td>${esc(nome)}</td><td class="num">${num(r.qtd)}</td><td class="num">${money(r.total)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">Nenhum item no período.</td></tr>';

  function abrirRelatorio(tipo) {
    if (!relatorioAtual) return toast('Aguarde o carregamento dos dados.', 'warning');
    const r = relatorioAtual, c = r.clinica;
    const titulo = tipo === 'dre' ? 'DRE simplificada' : 'Relatório gerencial';
    const subtitulo = `Período de ${fmtDate(r.ini)} a ${fmtDate(r.fim)}`;
    const corpo = tipo === 'dre' ? `
      <div class="alerta"><strong>Documento gerencial:</strong> DRE simplificada em regime de caixa. Não substitui a escrituração contábil ou fiscal do contador.</div>
      <h2>Demonstração do resultado</h2>
      <table><thead><tr><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>
        <tr class="grupo"><td>Receita operacional recebida</td><td class="num">${money(r.receita)}</td></tr>
        ${linhas(r.receitasCategoria)}
        <tr class="grupo"><td>(−) Despesas pagas</td><td class="num negativo">− ${money(r.despesa)}</td></tr>
        ${linhas(r.despesasCategoria, true)}
        <tr class="total"><td>Resultado operacional do período</td><td class="num ${r.resultado < 0 ? 'negativo' : ''}">${money(r.resultado)}</td></tr>
      </tbody></table>
      <h2>Informações complementares</h2>
      <div class="metricas"><div><small>Vendas PDV</small><strong>${r.vendas}</strong></div><div><small>Vendas fiadas em aberto</small><strong>${money(r.fiado)}</strong></div><div><small>Margem bruta PDV</small><strong>${r.brutoVendas ? num(((r.brutoVendas - r.custoVendido) / r.brutoVendas) * 100, 1) : 0}%</strong></div></div>
      <p class="muted nota">Valores extraídos do módulo financeiro do Petzy. Confira classificações, impostos, custos e documentos fiscais com o responsável contábil.</p>` : `
      <div class="metricas"><div><small>Receita recebida</small><strong>${money(r.receita)}</strong></div><div><small>Despesas pagas</small><strong>${money(r.despesa)}</strong></div><div><small>Resultado</small><strong class="${r.resultado < 0 ? 'negativo' : ''}">${money(r.resultado)}</strong></div><div><small>Ticket médio</small><strong>${money(r.ticket)}</strong></div></div>
      <h2>Indicadores do período</h2><table><tbody><tr><td>Vendas concluídas</td><td class="num">${r.vendas}</td></tr><tr><td>Atendimentos concluídos</td><td class="num">${r.concl}</td></tr><tr><td>Faltas</td><td class="num">${r.faltas}</td></tr><tr><td>Novos tutores</td><td class="num">${r.novosClientes}</td></tr><tr><td>Vendas fiadas em aberto</td><td class="num">${money(r.fiado)}</td></tr></tbody></table>
      <h2>Itens mais vendidos</h2><table><thead><tr><th>#</th><th>Item</th><th class="num">Quantidade</th><th class="num">Total</th></tr></thead><tbody>${tabelaItens(r.top)}</tbody></table>
      <h2>Receitas e despesas por categoria</h2><div class="duas"><div><h3>Receitas</h3><table>${linhas(r.receitasCategoria)}</table></div><div><h3>Despesas</h3><table>${linhas(r.despesasCategoria, true)}</table></div></div>`;
    const w = window.open('', '_blank');
    if (!w) return toast('Permita pop-ups para gerar o relatório.', 'warning');
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)} - ${esc(c.nome || 'Petzy')}</title><style>
      @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#202335;margin:0}header{border-bottom:3px solid #6c5ce7;padding-bottom:12px;display:flex;justify-content:space-between;gap:20px}h1{font-size:22px;margin:0 0 4px;color:#3d2fb8}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#3d2fb8;border-bottom:1px solid #e5e6ef;padding-bottom:5px;margin:22px 0 8px}h3{font-size:11px;margin:0 0 6px;color:#555}p{line-height:1.5}.muted{color:#73788d}.num{text-align:right;white-space:nowrap}.negativo{color:#b42318}.alerta{background:#fff8e1;border-left:4px solid #f59e0b;padding:9px 12px;margin:18px 0;color:#684f00}.metricas{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.metricas div{border:1px solid #e3e4ee;border-radius:7px;padding:10px}.metricas small{display:block;color:#73788d;margin-bottom:4px}.metricas strong{font-size:16px}.duas{display:grid;grid-template-columns:1fr 1fr;gap:18px}table{width:100%;border-collapse:collapse;margin-bottom:10px}th,td{border-bottom:1px solid #e5e6ef;padding:6px 7px;text-align:left}th{font-size:10px;text-transform:uppercase;color:#73788d;background:#fafaff}.grupo td{font-weight:700;background:#fafaff}.total td{font-weight:700;border-top:2px solid #6c5ce7;font-size:13px}.nota{font-size:10px;margin-top:20px}footer{border-top:1px solid #e5e6ef;margin-top:28px;padding-top:8px;color:#73788d;font-size:10px;display:flex;justify-content:space-between}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><header><div><h1>${esc(c.nome || 'Petzy')}</h1><div class="muted">${esc([c.cnpj && 'CNPJ ' + c.cnpj, c.endereco, c.telefone, c.email].filter(Boolean).join(' · '))}</div></div><div class="num"><strong>${titulo}</strong><br>${subtitulo}</div></header>${corpo}<footer><span>Emitido pelo Petzy</span><span>${new Date().toLocaleString('pt-BR')}</span></footer><script>window.addEventListener('afterprint',()=>window.close());window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  $('#preset', view).onchange = () => { aplicarPreset(); carregar(); };
  $('#ini', view).onchange = $('#fim', view).onchange = () => { $('#preset', view).value = 'custom'; carregar(); };
  $('#limparFiltros', view).onclick = () => { $('#preset', view).value = '30'; aplicarPreset(); carregar(); };
  $('#btnCsv', view).onclick = () => exportCSV('relatorio-itens.csv', exportRows);
  $('#btnGerencial', view).onclick = () => abrirRelatorio('gerencial');
  $('#btnDre', view).onclick = () => abrirRelatorio('dre');

  aplicarPreset();
  await carregar();
}

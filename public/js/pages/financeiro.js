import { list, save, remove, update, loadTutoresPets, where } from '../store.js';
import { $, esc, pageHeader, empty, formModal, confirmar, toast, money, fmtDate, today, toISODate, addDays, badge, kpi, exportCSV, norm, debounce } from '../ui.js';
import { exigirLicenca } from '../app.js';

const CATEGORIAS = {
  receita: ['Serviços clínicos', 'Banho & Tosa', 'Vendas PDV', 'Serviços', 'Hospedagem', 'Outras receitas'],
  despesa: ['Fornecedores', 'Salários', 'Aluguel', 'Energia / Água', 'Internet / Telefone', 'Impostos', 'Marketing', 'Manutenção', 'Software', 'Outras despesas']
};
const FORMAS = ['PIX', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Boleto', 'Transferência', 'A definir'];
const ORIGENS = { venda: 'uma venda do PDV', movimentacao: 'uma compra (entrada de estoque)', agendamento: 'um atendimento da agenda' };

// soma meses sem "transbordar" o dia (31/01 + 1 mês = 28 ou 29/02, e não 03/03)
function somarMeses(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(a, m - 1 + n, 1);
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d, ultimoDia));
  return toISODate(alvo);
}
const proximoMes = (mes) => { const [a, m] = mes.split('-').map(Number); return `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`; };

export async function render(view) {
  let mes = today().slice(0, 7);
  let lancs = [];       // lançamentos exibidos na tabela
  let realizados = [];  // pagos/recebidos no mês (pela data do pagamento) para o fluxo de caixa
  const { C } = await loadTutoresPets();

  view.innerHTML = `
    ${pageHeader('Financeiro', 'Contas a pagar e a receber, fluxo de caixa',
      `<button class="btn btn-light border" id="btnCsv"><i class="bi bi-download me-1"></i>Exportar</button>
       <button class="btn btn-outline-danger" data-novo="despesa"><i class="bi bi-dash-lg me-1"></i>Despesa</button>
       <button class="btn btn-success" data-novo="receita"><i class="bi bi-plus-lg me-1"></i>Receita</button>`)}
    <div class="row g-3 mb-3" id="kpis"></div>
    <div class="card">
      <div class="card-header d-flex gap-2 flex-wrap align-items-center">
        <select class="form-select w-auto" id="fOrigem">
          <option value="">Lançamentos do mês</option>
          <option value="pagar">Contas a pagar em aberto (todos os meses)</option>
          <option value="receber">Contas a receber em aberto (todos os meses)</option>
          <option value="fiado">Fiado em aberto</option>
        </select>
        <input type="month" class="form-control w-auto" id="mes">
        <select class="form-select w-auto" id="fTipo"><option value="">Receitas e despesas</option><option value="receita">Só receitas</option><option value="despesa">Só despesas</option></select>
        <select class="form-select w-auto" id="fStatus"><option value="">Todos os status</option><option value="pago">Pagos</option><option value="aberto">Em aberto</option><option value="vencido">Vencidos</option></select>
        <input class="form-control ms-auto" style="max-width:240px" id="busca" placeholder="Buscar descrição...">
        <button class="btn btn-light border" id="limparFiltros" title="Limpar filtros"><i class="bi bi-x-circle me-1"></i>Limpar</button>
      </div>
      <div class="table-responsive"><table class="table table-hover">
        <thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Forma</th><th>Status</th><th class="text-end">Valor</th><th class="text-end">Ações</th></tr></thead>
        <tbody id="tbody"></tbody><tfoot id="tfoot"></tfoot>
      </table></div>
    </div>`;

  $('#mes', view).value = mes;
  const modo = () => $('#fOrigem', view).value;
  const telaAtiva = view.firstElementChild;

  async function carregar() {
    const m = modo();
    $('#mes', view).disabled = !!m; // as visões "em aberto" não dependem do mês
    if (m === 'fiado') {
      lancs = (await list('financeiro', where('origem', '==', 'venda')))
        .filter(l => l.tipo === 'receita' && l.formaPagamento === 'Fiado (a receber)' && !l.pago);
      realizados = [];
    } else if (m === 'pagar' || m === 'receber') {
      lancs = (await list('financeiro', where('pago', '==', false))).filter(l => l.tipo === (m === 'pagar' ? 'despesa' : 'receita'));
      realizados = [];
    } else {
      const ini = mes + '-01', fim = proximoMes(mes);
      [lancs, realizados] = await Promise.all([
        list('financeiro', where('vencimento', '>=', ini), where('vencimento', '<', fim)),
        list('financeiro', where('pagoEm', '>=', ini), where('pagoEm', '<', fim))
      ]);
    }
    if (telaAtiva.isConnected) desenhar();
  }

  const status = (l) => l.pago ? 'pago' : l.vencimento < today() ? 'vencido' : 'aberto';

  function desenharKpis() {
    const soma = (arr, fn) => arr.filter(fn).reduce((s, l) => s + (Number(l.valor) || 0), 0);
    if (!modo()) {
      const rec = soma(realizados, l => l.tipo === 'receita'), desp = soma(realizados, l => l.tipo === 'despesa');
      const aReceber = soma(lancs, l => l.tipo === 'receita' && !l.pago), aPagar = soma(lancs, l => l.tipo === 'despesa' && !l.pago);
      $('#kpis', view).innerHTML = `
        <div class="col-6 col-xl-3">${kpi('arrow-down-circle', 'Recebido no mês', money(rec), 'success')}</div>
        <div class="col-6 col-xl-3">${kpi('arrow-up-circle', 'Pago no mês', money(desp), 'danger')}</div>
        <div class="col-6 col-xl-3">${kpi('wallet2', 'Saldo realizado', `<span class="${rec - desp >= 0 ? 'text-success' : 'text-danger'}">${money(rec - desp)}</span>`, 'primary')}</div>
        <div class="col-6 col-xl-3">${kpi('hourglass-split', 'A receber / a pagar (vencem no mês)', `<span class="fs-6">${money(aReceber)} / ${money(aPagar)}</span>`, 'warning')}</div>`;
      return;
    }
    const hoje = today(), em7 = toISODate(addDays(new Date(), 7));
    const aberto = lancs.filter(l => !l.pago);
    $('#kpis', view).innerHTML = `
      <div class="col-6 col-xl-3">${kpi('cash-stack', 'Total em aberto', money(soma(aberto, () => true)), modo() === 'pagar' ? 'danger' : 'success')}</div>
      <div class="col-6 col-xl-3">${kpi('exclamation-octagon', 'Vencido', money(soma(aberto, l => l.vencimento < hoje)), 'danger')}</div>
      <div class="col-6 col-xl-3">${kpi('calendar-week', 'Vence nos próximos 7 dias', money(soma(aberto, l => l.vencimento >= hoje && l.vencimento <= em7)), 'warning')}</div>
      <div class="col-6 col-xl-3">${kpi('list-check', 'Lançamentos em aberto', aberto.length, 'info')}</div>`;
  }

  function desenhar() {
    desenharKpis();
    const t = $('#fTipo', view).value, st = $('#fStatus', view).value, q = norm($('#busca', view).value);
    const rows = lancs.filter(l => (!t || l.tipo === t) && (!st || status(l) === st) && (!q || norm([l.descricao, l.fornecedor, C[l.clienteId]?.nome].join(' ')).includes(q)))
      .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));
    const cores = { pago: 'success', aberto: 'warning', vencido: 'danger' };
    const vazio = { '': 'Nenhum lançamento neste mês.', pagar: 'Nenhuma conta a pagar em aberto. 🎉', receber: 'Nada a receber em aberto.', fiado: 'Nenhum fiado em aberto.' }[modo()];
    $('#tbody', view).innerHTML = rows.length ? rows.map(l => `<tr>
      <td class="fs-7 text-nowrap">${fmtDate(l.vencimento)}${l.pago && l.pagoEm && l.pagoEm !== l.vencimento ? `<div class="fs-8 text-muted">pago em ${fmtDate(l.pagoEm)}</div>` : ''}</td>
      <td><div class="fw-semibold fs-7">${esc(l.descricao)}</div>${l.clienteId && C[l.clienteId] ? `<div class="fs-8 text-muted">Cliente: ${esc(C[l.clienteId].nome)}</div>` : ''}${l.fornecedor ? `<div class="fs-8 text-muted">Fornecedor: ${esc(l.fornecedor)}${l.notaFiscal ? ' · NF ' + esc(l.notaFiscal) : ''}</div>` : ''}</td>
      <td class="fs-7">${esc(l.categoria || '—')}</td><td class="fs-7">${esc(l.formaPagamento || '—')}</td>
      <td>${badge(status(l), cores[status(l)])}</td>
      <td class="text-end fw-semibold ${l.tipo === 'receita' ? 'text-success' : 'text-danger'}">${l.tipo === 'receita' ? '+' : '−'} ${money(l.valor)}</td>
      <td class="text-end text-nowrap">
        ${l.pago ? '' : `<button class="btn btn-sm btn-soft" data-pagar="${l.id}">${l.tipo === 'receita' ? 'Receber' : 'Pagar'}</button>`}
        <button class="btn btn-icon btn-light" title="Editar" data-edit="${l.id}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-icon btn-light" title="Excluir" data-del="${l.id}"><i class="bi bi-trash text-danger"></i></button>
      </td></tr>`).join('') : `<tr><td colspan="7">${empty('cash-coin', vazio)}</td></tr>`;
    const saldo = rows.reduce((s, l) => s + (l.tipo === 'receita' ? 1 : -1) * (Number(l.valor) || 0), 0);
    $('#tfoot', view).innerHTML = rows.length ? `<tr><td colspan="5" class="text-end text-muted fs-7">Saldo dos lançamentos filtrados</td><td class="text-end fw-bold ${saldo >= 0 ? 'text-success' : 'text-danger'}">${money(saldo)}</td><td></td></tr>` : '';
  }

  function abrirForm(l) {
    if (!exigirLicenca()) return;
    const tipo = l.tipo;
    formModal({
      title: `${l.id ? 'Editar' : 'Nova'} ${tipo === 'receita' ? 'receita' : 'despesa'}`, size: 'md',
      values: { vencimento: today(), pago: false, ...l },
      fields: [
        { name: 'descricao', label: 'Descrição', required: true, col: 'col-12' },
        { name: 'valor', label: 'Valor', type: 'money', required: true, col: 'col-md-6', attrs: 'min="0.01"' },
        { name: 'categoria', label: 'Categoria', type: 'select', options: CATEGORIAS[tipo], col: 'col-md-6' },
        { name: 'vencimento', label: 'Vencimento', type: 'date', required: true, col: 'col-md-6' },
        { name: 'formaPagamento', label: 'Forma de pagamento', type: 'select', options: FORMAS, col: 'col-md-6' },
        { name: 'pago', label: tipo === 'receita' ? 'Já recebido' : 'Já pago', type: 'checkbox', col: 'col-md-6' },
        { name: 'pagoEm', label: tipo === 'receita' ? 'Recebido em' : 'Pago em', type: 'date', col: 'col-md-6' },
        { name: 'recorrente', label: 'Repetir nos próximos meses', type: 'select', options: [{ value: 0, label: 'Não repetir' }, ...[2, 3, 6, 12].map(n => ({ value: n, label: `${n} meses` }))], col: 'col-md-6', attrs: l.id ? 'disabled' : '' },
        { name: 'obs', label: 'Observações', type: 'textarea', rows: 2, col: 'col-12' }
      ],
      onShown: (el) => {
        const f = $('form', el);
        const alternarPago = () => {
          f.pagoEm.closest('[class*="col-"]').classList.toggle('d-none', !f.pago.checked);
          if (f.pago.checked && !f.pagoEm.value) f.pagoEm.value = today();
        };
        f.pago.addEventListener('change', alternarPago);
        alternarPago();
        // boleto: vencimento padrão em 30 dias (só em lançamento novo, para não mexer no que já existe)
        if (!l.id) f.formaPagamento.addEventListener('change', () => {
          if (f.formaPagamento.value === 'Boleto') { f.vencimento.value = toISODate(addDays(new Date(), 30)); f.pago.checked = false; alternarPago(); }
        });
      },
      onSubmit: async (d) => {
        if (!(Number(d.valor) > 0)) throw new Error('Informe um valor maior que zero.');
        const vezes = Number(d.recorrente) || 1; delete d.recorrente;
        d.tipo = tipo;
        d.pagoEm = d.pago ? (d.pagoEm || today()) : null;
        if (l.id) await save('financeiro', l.id, d);
        else for (let i = 0; i < vezes; i++) {
          await save('financeiro', null, {
            ...d, vencimento: somarMeses(d.vencimento, i),
            pago: i === 0 && d.pago, pagoEm: i === 0 ? d.pagoEm : null,
            descricao: vezes > 1 ? `${d.descricao} (${i + 1}/${vezes})` : d.descricao
          });
        }
        toast(vezes > 1 ? `${vezes} lançamentos criados` : 'Lançamento salvo');
        await carregar();
      }
    });
  }

  // baixa com data e forma reais (ex.: boleto pago via PIX em outro dia)
  function darBaixa(l) {
    if (!exigirLicenca()) return;
    const receita = l.tipo === 'receita';
    formModal({
      title: `${receita ? 'Receber' : 'Pagar'} · ${esc(l.descricao)}`, size: 'sm', submit: receita ? 'Confirmar recebimento' : 'Confirmar pagamento',
      values: { pagoEm: today(), formaPagamento: l.formaPagamento === 'A definir' ? '' : (l.formaPagamento || '') },
      fields: [
        { type: 'custom', col: 'col-12', html: `<div class="bg-light rounded-3 p-2 px-3 text-center"><div class="fs-8 text-muted">Valor</div><div class="fs-5 fw-bold">${money(l.valor)}</div><div class="fs-8 text-muted">vencimento ${fmtDate(l.vencimento)}</div></div>` },
        { name: 'pagoEm', label: receita ? 'Recebido em' : 'Pago em', type: 'date', required: true, col: 'col-12' },
        { name: 'formaPagamento', label: 'Forma de pagamento', type: 'select', options: FORMAS.filter(x => x !== 'A definir'), col: 'col-12' }
      ],
      onSubmit: async (d) => {
        if (d.pagoEm > today()) throw new Error('A data do pagamento não pode ser no futuro.');
        await update('financeiro', l.id, { pago: true, pagoEm: d.pagoEm, ...(d.formaPagamento ? { formaPagamento: d.formaPagamento } : {}) });
        toast('Baixa realizada ✔'); await carregar();
      }
    });
  }

  view.querySelectorAll('[data-novo]').forEach(b => b.onclick = () => abrirForm({ tipo: b.dataset.novo }));
  $('#mes', view).onchange = (e) => { mes = e.target.value || today().slice(0, 7); carregar(); };
  $('#fTipo', view).onchange = desenhar;
  $('#fStatus', view).onchange = desenhar;
  $('#fOrigem', view).onchange = () => {
    const m = modo();
    if (m === 'pagar') $('#fTipo', view).value = 'despesa';
    if (m === 'receber' || m === 'fiado') $('#fTipo', view).value = 'receita';
    if (!m) $('#fTipo', view).value = '';
    carregar();
  };
  $('#limparFiltros', view).onclick = () => { mes = today().slice(0, 7); $('#mes', view).value = mes; $('#fTipo', view).value = ''; $('#fStatus', view).value = ''; $('#fOrigem', view).value = ''; $('#busca', view).value = ''; carregar(); };
  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#btnCsv', view).onclick = () => exportCSV(`financeiro-${modo() || mes}.csv`, lancs.map(l => ({
    Vencimento: l.vencimento, Tipo: l.tipo, Descricao: l.descricao, Categoria: l.categoria, Forma: l.formaPagamento, Fornecedor: l.fornecedor || '',
    Valor: String(l.valor).replace('.', ','), Pago: l.pago ? 'Sim' : 'Não', PagoEm: l.pagoEm || ''
  })));
  $('#tbody', view).onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const l = lancs.find(x => x.id === (b.dataset.edit || b.dataset.del || b.dataset.pagar)); if (!l) return;
    if (b.dataset.edit) abrirForm(l);
    if (b.dataset.pagar) darBaixa(l);
    if (b.dataset.del && exigirLicenca()) {
      const aviso = ORIGENS[l.origem] ? `<div class="alert alert-warning fs-7 mt-2 mb-0">Este lançamento veio de ${ORIGENS[l.origem]}. Excluir aqui <strong>não</strong> desfaz a ${l.origem === 'venda' ? 'venda' : l.origem === 'movimentacao' ? 'entrada de estoque' : 'agenda'}.</div>` : '';
      if (await confirmar(`Excluir "${esc(l.descricao)}"?${aviso}`)) { await remove('financeiro', l.id); toast('Lançamento excluído'); carregar(); }
    }
  };

  await carregar();
}

import { list, save, remove, update, loadTutoresPets, where } from '../store.js';
import { $, esc, pageHeader, empty, formModal, confirmar, toast, money, fmtDate, today, badge, kpi, exportCSV, norm, debounce } from '../ui.js';
import { exigirLicenca } from '../app.js';

const CATEGORIAS = {
  receita: ['Serviços clínicos', 'Banho & Tosa', 'Vendas PDV', 'Serviços', 'Hospedagem', 'Outras receitas'],
  despesa: ['Fornecedores', 'Salários', 'Aluguel', 'Energia / Água', 'Internet / Telefone', 'Impostos', 'Marketing', 'Manutenção', 'Software', 'Outras despesas']
};
const FORMAS = ['PIX', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Boleto', 'Transferência', 'A definir'];

export async function render(view) {
  let mes = today().slice(0, 7);
  let lancs = [];
  const { C } = await loadTutoresPets();

  view.innerHTML = `
    ${pageHeader('Financeiro', 'Contas a pagar e a receber, fluxo de caixa',
      `<button class="btn btn-light border" id="btnCsv"><i class="bi bi-download me-1"></i>Exportar</button>
       <button class="btn btn-outline-danger" data-novo="despesa"><i class="bi bi-dash-lg me-1"></i>Despesa</button>
       <button class="btn btn-success" data-novo="receita"><i class="bi bi-plus-lg me-1"></i>Receita</button>`)}
    <div class="row g-3 mb-3" id="kpis"></div>
    <div class="card">
      <div class="card-header d-flex gap-2 flex-wrap align-items-center">
        <input type="month" class="form-control w-auto" id="mes">
        <select class="form-select w-auto" id="fTipo"><option value="">Receitas e despesas</option><option value="receita">Só receitas</option><option value="despesa">Só despesas</option></select>
        <select class="form-select w-auto" id="fStatus"><option value="">Todos</option><option value="pago">Pagos</option><option value="aberto">Em aberto</option><option value="vencido">Vencidos</option></select>
        <select class="form-select w-auto" id="fOrigem"><option value="">Todos os lançamentos</option><option value="fiado">Fiado em aberto</option></select>
        <input class="form-control ms-auto" style="max-width:240px" id="busca" placeholder="Buscar descrição...">
      </div>
      <div class="table-responsive"><table class="table table-hover">
        <thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Forma</th><th>Status</th><th class="text-end">Valor</th><th class="text-end">Ações</th></tr></thead>
        <tbody id="tbody"></tbody><tfoot id="tfoot"></tfoot>
      </table></div>
    </div>`;

  $('#mes', view).value = mes;

  async function carregar() {
    if ($('#fOrigem', view).value === 'fiado') {
      lancs = (await list('financeiro', where('origem', '==', 'venda')))
        .filter(l => l.tipo === 'receita' && l.formaPagamento === 'Fiado (a receber)' && !l.pago);
    } else {
      const [a, m] = mes.split('-').map(Number);
      const prox = `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
      lancs = await list('financeiro', where('vencimento', '>=', mes + '-01'), where('vencimento', '<', prox));
    }
    desenhar();
  }

  const status = (l) => l.pago ? 'pago' : l.vencimento < today() ? 'vencido' : 'aberto';

  function desenhar() {
    const soma = (fn) => lancs.filter(fn).reduce((s, l) => s + (l.valor || 0), 0);
    const rec = soma(l => l.tipo === 'receita' && l.pago), desp = soma(l => l.tipo === 'despesa' && l.pago);
    const aReceber = soma(l => l.tipo === 'receita' && !l.pago), aPagar = soma(l => l.tipo === 'despesa' && !l.pago);
    $('#kpis', view).innerHTML = `
      <div class="col-6 col-xl-3">${kpi('arrow-down-circle', 'Recebido no mês', money(rec), 'success')}</div>
      <div class="col-6 col-xl-3">${kpi('arrow-up-circle', 'Pago no mês', money(desp), 'danger')}</div>
      <div class="col-6 col-xl-3">${kpi('wallet2', 'Saldo realizado', `<span class="${rec - desp >= 0 ? 'text-success' : 'text-danger'}">${money(rec - desp)}</span>`, 'primary')}</div>
      <div class="col-6 col-xl-3">${kpi('hourglass-split', 'A receber / a pagar', `<span class="fs-6">${money(aReceber)} / ${money(aPagar)}</span>`, 'warning')}</div>`;

    const t = $('#fTipo', view).value, st = $('#fStatus', view).value, q = norm($('#busca', view).value);
    const rows = lancs.filter(l => (!t || l.tipo === t) && (!st || status(l) === st) && (!q || norm(l.descricao).includes(q)))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const cores = { pago: 'success', aberto: 'warning', vencido: 'danger' };
    $('#tbody', view).innerHTML = rows.length ? rows.map(l => `<tr>
      <td class="fs-7 text-nowrap">${fmtDate(l.vencimento)}</td>
      <td><div class="fw-semibold fs-7">${esc(l.descricao)}</div>${l.clienteId && C[l.clienteId] ? `<div class="fs-8 text-muted">Cliente: ${esc(C[l.clienteId].nome)}</div>` : ''}${l.fornecedor ? `<div class="fs-8 text-muted">Fornecedor: ${esc(l.fornecedor)}</div>` : ''}</td>
      <td class="fs-7">${esc(l.categoria || '—')}</td><td class="fs-7">${esc(l.formaPagamento || '—')}</td>
      <td>${badge(status(l), cores[status(l)])}</td>
      <td class="text-end fw-semibold ${l.tipo === 'receita' ? 'text-success' : 'text-danger'}">${l.tipo === 'receita' ? '+' : '−'} ${money(l.valor)}</td>
      <td class="text-end text-nowrap">
        ${l.pago ? '' : `<button class="btn btn-sm btn-soft" data-pagar="${l.id}">${l.tipo === 'receita' ? 'Receber' : 'Pagar'}</button>`}
        <button class="btn btn-icon btn-light" data-edit="${l.id}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-icon btn-light" data-del="${l.id}"><i class="bi bi-trash text-danger"></i></button>
      </td></tr>`).join('') : `<tr><td colspan="7">${empty('cash-coin', 'Nenhum lançamento neste período.')}</td></tr>`;
    const saldo = rows.reduce((s, l) => s + (l.tipo === 'receita' ? 1 : -1) * (l.valor || 0), 0);
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
        { name: 'valor', label: 'Valor', type: 'money', required: true, col: 'col-md-6' },
        { name: 'categoria', label: 'Categoria', type: 'select', options: CATEGORIAS[tipo], col: 'col-md-6' },
        { name: 'vencimento', label: 'Vencimento', type: 'date', required: true, col: 'col-md-6' },
        { name: 'formaPagamento', label: 'Forma de pagamento', type: 'select', options: FORMAS, col: 'col-md-6' },
        { name: 'pago', label: tipo === 'receita' ? 'Já recebido' : 'Já pago', type: 'checkbox', col: 'col-md-6' },
        { name: 'recorrente', label: 'Repetir nos próximos meses', type: 'select', options: [{ value: 0, label: 'Não repetir' }, ...[2, 3, 6, 12].map(n => ({ value: n, label: `${n} meses` }))], col: 'col-md-6', attrs: l.id ? 'disabled' : '' },
        { name: 'obs', label: 'Observações', type: 'textarea', rows: 2, col: 'col-12' }
      ],
      onSubmit: async (d) => {
        const vezes = Number(d.recorrente) || 1; delete d.recorrente;
        d.tipo = tipo; d.pagoEm = d.pago ? (l.pagoEm || today()) : null;
        if (l.id) await save('financeiro', l.id, d);
        else for (let i = 0; i < vezes; i++) {
          const v = new Date(d.vencimento + 'T00:00'); v.setMonth(v.getMonth() + i);
          await save('financeiro', null, { ...d, vencimento: v.toISOString().slice(0, 10), pago: i === 0 && d.pago, pagoEm: i === 0 ? d.pagoEm : null, descricao: vezes > 1 ? `${d.descricao} (${i + 1}/${vezes})` : d.descricao });
        }
        toast('Lançamento salvo'); await carregar();
      }
    });
  }

  view.querySelectorAll('[data-novo]').forEach(b => b.onclick = () => abrirForm({ tipo: b.dataset.novo }));
  $('#mes', view).onchange = (e) => { mes = e.target.value || today().slice(0, 7); carregar(); };
  $('#fTipo', view).onchange = desenhar;
  $('#fStatus', view).onchange = desenhar;
  $('#fOrigem', view).onchange = carregar;
  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#btnCsv', view).onclick = () => exportCSV(`financeiro-${mes}.csv`, lancs.map(l => ({
    Vencimento: l.vencimento, Tipo: l.tipo, Descricao: l.descricao, Categoria: l.categoria, Forma: l.formaPagamento,
    Valor: String(l.valor).replace('.', ','), Pago: l.pago ? 'Sim' : 'Não', PagoEm: l.pagoEm || ''
  })));
  $('#tbody', view).onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const l = lancs.find(x => x.id === (b.dataset.edit || b.dataset.del || b.dataset.pagar));
    if (b.dataset.edit) abrirForm(l);
    if (b.dataset.pagar && exigirLicenca()) { await update('financeiro', l.id, { pago: true, pagoEm: today() }); toast('Baixa realizada ✔'); carregar(); }
    if (b.dataset.del && exigirLicenca() && await confirmar(`Excluir "${esc(l.descricao)}"?`)) { await remove('financeiro', l.id); toast('Lançamento excluído'); carregar(); }
  };

  await carregar();
}

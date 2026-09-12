import { state, list, save, remove, create, update, bumpEstoque } from '../store.js';
import { $, esc, pageHeader, empty, formModal, confirmar, toast, money, num, badge, kpi, norm, debounce, exportCSV, today, toISODate, addDays } from '../ui.js';
import { chamarFuncao, mensagemErroFuncao } from '../firebase.js';
import { exigirLicenca } from '../app.js';
import { NCM_SUGERIDO, NCM_LISTA } from '../fiscalDados.js';
import { ligarBuscaNcm } from '../ncm.js';

const CATEGORIAS = {
  produto: ['Ração', 'Petiscos', 'Medicamentos', 'Higiene', 'Acessórios', 'Brinquedos', 'Farmácia', 'Outros'],
  servico: ['Consulta', 'Vacina', 'Exame', 'Cirurgia', 'Banho', 'Tosa', 'Hospedagem', 'Outros']
};

// ---------- dados fiscais (NF-e / NFC-e) ----------
const ORIGENS = [{ value: '0', label: '0 · Nacional' }, { value: '1', label: '1 · Estrangeira (importação direta)' }, { value: '2', label: '2 · Estrangeira (mercado interno)' }];
const CSOSN = [{ value: '102', label: '102 · Tributada no Simples, sem crédito' }, { value: '103', label: '103 · Isenta no Simples' }, { value: '300', label: '300 · Imune' }, { value: '400', label: '400 · Não tributada' }, { value: '500', label: '500 · ICMS já cobrado por ST' }];
const CST_ICMS = [{ value: '00', label: '00 · Tributada integralmente' }, { value: '40', label: '40 · Isenta' }, { value: '41', label: '41 · Não tributada' }, { value: '60', label: '60 · ICMS já cobrado por ST' }];
const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const fmtNcm = (s) => soDigitos(s).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
const semNcm = (p) => p.tipo !== 'servico' && soDigitos(p.ncm).length !== 8;
const emDias = (n) => toISODate(addDays(new Date(), n)); // data local

// ---------- controle de validade/lote ----------
const HOJE_ISO = today();
const LIMITE_VENC = emDias(30);
const venceEm = (p) => p.tipo !== 'servico' && p.validade; // só produtos com lote/validade informados
const vencida = (p) => venceEm(p) && p.validade < HOJE_ISO;
const vencendo = (p) => venceEm(p) && p.validade >= HOJE_ISO && p.validade <= LIMITE_VENC;
const badgeValidade = (p) => {
  if (!venceEm(p)) return '';
  if (vencida(p)) return ` <span class="badge badge-soft-danger" title="Lote ${esc(p.lote || 's/nº')}">venceu ${fmtDataBr(p.validade)}</span>`;
  if (vencendo(p)) return ` <span class="badge badge-soft-warning" title="Lote ${esc(p.lote || 's/nº')}">vence ${fmtDataBr(p.validade)}</span>`;
  return '';
};
const fmtDataBr = (s) => (s || '').split('-').reverse().join('/');

// ---------- busca de dados do produto pelo código de barras ----------
// Duas fontes no backend (nessa ordem): Open Food Facts (mundial, forte em alimentos/marcas grandes)
// e Cosmos Bluesoft (nacional, melhor cobertura de marca brasileira de petshop). Quando não encontra
// em nenhuma, só avisa — nunca bloqueia o cadastro manual.
async function buscarPorEan(f, info) {
  const codigo = soDigitos(f.codigo.value);
  if (codigo.length < 8) { info.textContent = 'Digite um código de barras válido (8 a 14 dígitos) antes de buscar.'; return; }
  info.textContent = 'Buscando...';
  try {
    const r = await chamarFuncao('buscarProdutoPorEan', { codigo });
    if (!r.encontrado) { info.textContent = 'Nada encontrado para este código — preencha manualmente.'; return; }
    f.nome.value = r.nome;
    info.textContent = `Encontrado (${r.fonte})! Confira o nome preenchido e ajuste se precisar.`;
  } catch (e) {
    info.textContent = mensagemErroFuncao(e);
  }
}

// ---------- código automático para serviços (sem código de barras real) ----------
// Olha os códigos já cadastrados nos serviços, acha o maior número no final de cada um e sugere o
// próximo da sequência, mantendo o mesmo prefixo e a mesma quantidade de dígitos (ex.: SERV007 -> SERV008).
function proximoCodigoServico(itens) {
  let max = 0, prefixo = '', digitosN = 3;
  itens.filter(x => x.tipo === 'servico' && x.codigo).forEach(x => {
    const m = String(x.codigo).match(/^(\D*)(\d+)$/);
    if (!m) return;
    const n = parseInt(m[2], 10);
    if (n > max) { max = n; prefixo = m[1]; digitosN = m[2].length; }
  });
  return prefixo + String(max + 1).padStart(digitosN, '0');
}

export async function render(view) {
  let itens = await list('produtos');
  let fornecedores = await list('fornecedores');
  let aba = 'produto';

  view.innerHTML = `
    ${pageHeader('Produtos & Serviços', 'Catálogo, preços e controle de estoque',
      `<button class="btn btn-light border" id="btnCsv"><i class="bi bi-download me-1"></i>Exportar</button>
       <a class="btn btn-light border" href="#/fornecedores"><i class="bi bi-truck me-1"></i>Fornecedores</a>
       <button class="btn btn-primary" id="btnNovo"><i class="bi bi-plus-lg me-1"></i>Novo item</button>`)}
    <div class="row g-3 mb-3" id="kpis"></div>
    <div class="card">
      <div class="card-header d-flex gap-2 flex-wrap align-items-center">
        <ul class="nav nav-pills gap-1" id="abas">
          <li class="nav-item"><button class="nav-link active" data-a="produto"><i class="bi bi-box-seam me-1"></i>Produtos</button></li>
          <li class="nav-item"><button class="nav-link" data-a="servico"><i class="bi bi-scissors me-1"></i>Serviços</button></li>
        </ul>
        <select class="form-select w-auto ms-auto" id="fCat"></select>
        <input class="form-control" style="max-width:260px" id="busca" placeholder="Nome ou código...">
        <div class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" id="fBaixo"><label class="form-check-label fs-7">Estoque baixo</label></div>
        <div class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" id="fVenc"><label class="form-check-label fs-7">Vencendo/vencido</label></div>
        <button class="btn btn-light border" id="limparFiltros" title="Limpar filtros"><i class="bi bi-x-circle me-1"></i>Limpar</button>
      </div>
      <div class="table-responsive"><table class="table table-hover">
        <thead id="thead"></thead><tbody id="tbody"></tbody>
      </table></div>
    </div>`;

  const baixo = (p) => p.tipo !== 'servico' && (p.estoque ?? 0) <= (p.estoqueMinimo ?? 0);

  function desenhar() {
    const prods = itens.filter(i => i.tipo !== 'servico');
    const valorEstoque = prods.reduce((s, p) => s + (p.estoque || 0) * (p.precoCusto || 0), 0);
    const vencendoOuVencido = prods.filter(p => vencida(p) || vencendo(p));
    $('#kpis', view).innerHTML = `
      <div class="col-6 col-lg-3">${kpi('box-seam', 'Produtos', prods.length)}</div>
      <div class="col-6 col-lg-3">${kpi('scissors', 'Serviços', itens.length - prods.length, 'info')}</div>
      <div class="col-6 col-lg-3">${kpi('safe', 'Valor em estoque (custo)', money(valorEstoque), 'success')}</div>
      <div class="col-6 col-lg-3">${kpi('exclamation-triangle', 'Estoque baixo', prods.filter(baixo).length, 'danger')}</div>
      <div class="col-6 col-lg-3">${kpi('calendar-x', 'Vencendo em 30 dias', vencendoOuVencido.length, vencendoOuVencido.some(vencida) ? 'danger' : 'warning')}</div>`;

    const cat = $('#fCat', view).value, q = norm($('#busca', view).value), sóBaixo = $('#fBaixo', view).checked, sóVenc = $('#fVenc', view).checked;
    const rows = itens.filter(i => (aba === 'servico' ? i.tipo === 'servico' : i.tipo !== 'servico') && (!cat || i.categoria === cat) &&
      (!q || norm([i.nome, i.codigo].join(' ')).includes(q)) && (!sóBaixo || baixo(i)) && (!sóVenc || vencida(i) || vencendo(i))).sort((a, b) => a.nome.localeCompare(b.nome));

    $('#thead', view).innerHTML = aba === 'produto'
      ? '<tr><th>Produto</th><th>Categoria</th><th class="text-end">Custo</th><th class="text-end">Venda</th><th class="text-end">Margem</th><th class="text-center">Estoque</th><th class="text-end">Ações</th></tr>'
      : '<tr><th>Serviço</th><th>Categoria</th><th class="text-end">Duração</th><th class="text-end">Preço</th><th class="text-end">Ações</th></tr>';

    $('#tbody', view).innerHTML = rows.length ? rows.map(i => {
      const margem = i.precoVenda && i.precoCusto ? ((i.precoVenda - i.precoCusto) / i.precoVenda) * 100 : null;
      const acoes = `<td class="text-end text-nowrap">
        ${aba === 'produto' ? `<button class="btn btn-icon btn-light" title="Movimentar estoque" data-mov="${i.id}"><i class="bi bi-arrow-down-up"></i></button>` : ''}
        <button class="btn btn-icon btn-light" data-edit="${i.id}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-icon btn-light" data-del="${i.id}"><i class="bi bi-trash text-danger"></i></button></td>`;
      const nome = `<td><div class="fw-semibold">${esc(i.nome)} ${i.ativo === false ? badge('inativo', 'secondary') : ''} ${semNcm(i) ? badge('sem NCM', 'warning') : ''}${badgeValidade(i)}</div>
        <div class="text-muted fs-8">${esc([i.codigo, i.ncm && i.tipo !== 'servico' ? 'NCM ' + fmtNcm(i.ncm) : ''].filter(Boolean).join(' · '))}</div></td>`;
      return aba === 'produto'
        ? `<tr>${nome}<td class="fs-7">${esc(i.categoria || '—')}</td><td class="text-end fs-7">${money(i.precoCusto)}</td>
            <td class="text-end fw-semibold">${money(i.precoVenda)}</td>
            <td class="text-end fs-7 ${margem != null && margem < 20 ? 'text-danger' : 'text-success'}">${margem != null ? num(margem, 0) + '%' : '—'}</td>
            <td class="text-center">${badge(`${num(i.estoque || 0)} ${i.unidade || 'un'}`, baixo(i) ? 'danger' : 'success')}</td>${acoes}</tr>`
        : `<tr>${nome}<td class="fs-7">${esc(i.categoria || '—')}</td><td class="text-end fs-7">${i.duracao ? i.duracao + ' min' : '—'}</td>
            <td class="text-end fw-semibold">${money(i.precoVenda)}</td>${acoes}</tr>`;
    }).join('') : `<tr><td colspan="7">${empty(aba === 'produto' ? 'box-seam' : 'scissors', 'Nenhum item encontrado.')}</td></tr>`;
  }

  function trocarAba(a) {
    aba = a;
    $('#abas', view).querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.a === a));
    $('#fCat', view).innerHTML = `<option value="">Todas as categorias</option>${CATEGORIAS[a].map(c => `<option>${c}</option>`).join('')}`;
    $('#fBaixo', view).closest('.form-check').classList.toggle('d-none', a === 'servico');
    $('#fVenc', view).closest('.form-check').classList.toggle('d-none', a === 'servico');
    desenhar();
  }

  const telaAtiva = view.firstElementChild; // some quando o usuário navega para outra tela
  async function recarregar() { itens = await list('produtos'); if (telaAtiva.isConnected) desenhar(); }

  function abrirForm(i = { tipo: aba, ativo: true, unidade: 'un' }) {
    if (!exigirLicenca()) return;
    const serv = i.tipo === 'servico';
    formModal({
      title: i.id ? `Editar ${serv ? 'serviço' : 'produto'}` : `Novo ${serv ? 'serviço' : 'produto'}`, values: i,
      fields: [
        { name: 'nome', label: 'Nome', required: true, col: 'col-md-8' },
        { name: 'codigo', label: serv ? 'Código' : 'Código / EAN', col: 'col-md-4' },
        ...(serv
          ? [{ type: 'custom', col: 'col-12', html: '<button type="button" class="btn btn-sm btn-light border mb-2" id="btnCodigoAuto"><i class="bi bi-magic me-1"></i>Gerar código automático</button><span class="fs-8 text-muted ms-2" id="codigoAutoInfo"></span>' }]
          : [{ type: 'custom', col: 'col-12', html: '<button type="button" class="btn btn-sm btn-light border mb-2" id="btnBuscarEan"><i class="bi bi-upc-scan me-1"></i>Buscar dados pelo código de barras</button><span class="fs-8 text-muted ms-2" id="eanInfo"></span>' }]),
        { name: 'categoria', label: 'Categoria', type: 'select', options: CATEGORIAS[i.tipo === 'servico' ? 'servico' : 'produto'], col: 'col-md-6' },
        serv ? { name: 'duracao', label: 'Duração (min)', type: 'number', col: 'col-md-6' }
             : { name: 'unidade', label: 'Unidade', type: 'select', options: ['un', 'kg', 'g', 'ml', 'L', 'cx', 'pct'], col: 'col-md-6' },
        ...(serv ? [] : [{ name: 'precoCusto', label: 'Preço de custo', type: 'money', col: 'col-md-6' }]),
        { name: 'precoVenda', label: serv ? 'Preço' : 'Preço de venda', type: 'money', required: true, col: 'col-md-6' },
        ...(serv ? [] : [
          { name: 'estoque', label: 'Estoque atual', type: 'number', step: '0.01', col: 'col-md-6', attrs: i.id ? 'readonly title="Use a movimentação de estoque"' : '' },
          { name: 'estoqueMinimo', label: 'Estoque mínimo', type: 'number', step: '0.01', col: 'col-md-6' },
          { name: 'validade', label: 'Validade (lote atual)', type: 'date', col: 'col-md-6' }
        ]),
        { name: 'ativo', label: 'Ativo (aparece no PDV)', type: 'checkbox', col: 'col-12' },
        ...(serv ? [] : (() => {
          const fiscal = state.clinica?.fiscal || {};
          const simples = ['simples', 'mei'].includes(fiscal.regimeTributario || 'simples');
          return [
            { type: 'section', label: 'Dados fiscais · NF-e e NFC-e' },
            { name: 'ncm', label: 'NCM', col: 'col-md-4', placeholder: '2309.10.00', attrs: 'maxlength="10" inputmode="numeric" autocomplete="off"' },
            { type: 'custom', col: 'col-md-8 d-flex align-items-end gap-2 flex-wrap', html: '<button type="button" class="btn btn-sm btn-light border mb-1" id="sugerirNcm"><i class="bi bi-magic me-1"></i>Sugerir pela categoria</button><span class="fs-8 text-muted mb-2" id="ncmInfo">Digite o código ou o nome do produto para buscar na tabela completa. Sugestão automática por categoria também disponível.</span>' },
            { name: 'cfop', label: 'CFOP', col: 'col-6 col-md-3', placeholder: `padrão ${fiscal.cfopPadrao || '5102'}`, attrs: 'maxlength="4" inputmode="numeric"' },
            { name: 'cest', label: 'CEST (se houver ST)', col: 'col-6 col-md-3', attrs: 'maxlength="9"' },
            { name: 'origem', label: 'Origem', type: 'select', options: ORIGENS, col: 'col-6 col-md-3', default: '0' },
            { name: 'icmsSituacao', label: simples ? 'CSOSN (padrão da clínica se vazio)' : 'CST do ICMS', type: 'select', options: simples ? CSOSN : CST_ICMS, col: 'col-6 col-md-3' }
          ];
        })())
      ],
      onShown: (el) => {
        const f = $('form', el);
        if (serv) {
          $('#btnCodigoAuto', el).onclick = () => {
            f.codigo.value = proximoCodigoServico(itens);
            $('#codigoAutoInfo', el).textContent = 'Código gerado a partir da sequência dos serviços já cadastrados.';
          };
          return;
        }
        ligarBuscaNcm(f.ncm);
        $('#sugerirNcm', el).onclick = () => {
          const sug = NCM_SUGERIDO[f.categoria.value];
          if (sug) { f.ncm.value = sug; $('#ncmInfo', el).textContent = `Sugerido para "${f.categoria.value}": ${NCM_LISTA.find(([c]) => c === sug)?.[1] || ''}. Confirme com o contador.`; }
          else $('#ncmInfo', el).textContent = 'Sem sugestão para esta categoria. Consulte o NCM na nota do fornecedor.';
        };
        $('#btnBuscarEan', el).onclick = () => buscarPorEan(f, $('#eanInfo', el));
      },
      onSubmit: async (d) => {
        d.tipo = i.tipo || aba;
        if (i.id) delete d.estoque; // estoque só muda via movimentação
        if (d.tipo !== 'servico') {
          d.ncm = soDigitos(d.ncm); d.cfop = soDigitos(d.cfop); d.cest = soDigitos(d.cest);
          if (d.ncm && d.ncm.length !== 8) throw new Error('O NCM deve ter 8 dígitos (ex.: 2309.10.00).');
          if (d.cfop && d.cfop.length !== 4) throw new Error('O CFOP deve ter 4 dígitos (ex.: 5102).');
          if (d.cest && d.cest.length !== 7) throw new Error('O CEST deve ter 7 dígitos.');
        }
        await save('produtos', i.id, d);
        toast(d.tipo !== 'servico' && !d.ncm ? 'Item salvo. Informe o NCM para poder emitir NF-e/NFC-e deste produto.' : 'Item salvo', d.tipo !== 'servico' && !d.ncm ? 'warning' : 'success');
        await recarregar();
      }
    });
  }

  function movimentar(p) {
    if (!exigirLicenca()) return;
    formModal({
      title: `Movimentar estoque · ${esc(p.nome)}`, size: 'md', values: { tipo: 'entrada', custoUnitario: p.precoCusto || 0, vencimento: today(), gerarFinanceiro: true, lote: p.lote || '', loteValidade: p.validade || '' },
      fields: [
        { type: 'custom', col: 'col-12', html: `<div class="bg-light rounded-3 p-3 text-center">Estoque atual: <strong class="fs-5">${num(p.estoque || 0)} ${p.unidade || 'un'}</strong></div>` },
        { name: 'tipo', label: 'Tipo', type: 'select', required: true, options: [{ value: 'entrada', label: 'Entrada (compra)' }, { value: 'saida', label: 'Saída (perda/uso interno)' }, { value: 'ajuste', label: 'Ajuste (definir quantidade)' }], col: 'col-md-6' },
        { name: 'quantidade', label: 'Quantidade', type: 'number', step: '0.01', required: true, col: 'col-md-6' },
        { name: 'custoUnitario', label: 'Custo unitário', type: 'money', col: 'col-md-6', attrs: 'data-compra' },
        { name: 'totalCompra', label: 'Total da compra', type: 'money', col: 'col-md-6', attrs: 'data-compra readonly' },
        { name: 'fornecedorId', label: 'Fornecedor', type: 'select', options: fornecedores.map(f => ({ value: f.id, label: f.nome })), col: 'col-md-6', attrs: 'data-compra' },
        { name: 'notaFiscal', label: 'NF / documento', col: 'col-md-6', attrs: 'data-compra' },
        { name: 'lote', label: 'Lote', col: 'col-md-6', attrs: 'data-compra', placeholder: 'ex.: L2024089' },
        { name: 'loteValidade', label: 'Validade do lote', type: 'date', col: 'col-md-6', attrs: 'data-compra' },
        { name: 'vencimento', label: 'Vencimento da compra', type: 'date', col: 'col-md-6', attrs: 'data-compra' },
        { name: 'formaPagamento', label: 'Forma de pagamento', type: 'select', options: ['Boleto', 'PIX', 'Transferência', 'Cartão', 'Dinheiro', 'A definir'], col: 'col-md-6', attrs: 'data-compra' },
        { name: 'pago', label: 'Compra já paga', type: 'checkbox', col: 'col-md-6', attrs: 'data-compra' },
        { name: 'gerarFinanceiro', label: 'Lançar compra no Financeiro', type: 'checkbox', col: 'col-md-6', attrs: 'data-compra' },
        { name: 'motivo', label: 'Observação', col: 'col-12' }
      ],
      onShown: (el) => {
        const f = $('form', el);
        const camposCompra = () => el.querySelectorAll('[data-compra]');
        const alternarCampos = () => {
          const entrada = f.tipo.value === 'entrada';
          camposCompra().forEach(c => c.closest('[class*="col-"]')?.classList.toggle('d-none', !entrada));
          if (entrada) atualizarTotal();
        };
        const atualizarTotal = () => { f.totalCompra.value = ((Number(f.quantidade.value) || 0) * (Number(f.custoUnitario.value) || 0)).toFixed(2); };
        f.tipo.onchange = alternarCampos;
        f.quantidade.oninput = f.custoUnitario.oninput = atualizarTotal;
        // boleto: vence em 30 dias e entra como conta a pagar
        f.formaPagamento.addEventListener('change', () => {
          const boleto = f.formaPagamento.value === 'Boleto';
          if (boleto) { f.vencimento.value = emDias(30); f.pago.checked = false; }
          f.pago.disabled = boleto;
        });
        alternarCampos();
      },
      onSubmit: async (d) => {
        if (d.formaPagamento === 'Boleto') { d.pago = false; d.vencimento = d.vencimento || emDias(30); }
        const atual = p.estoque || 0;
        const delta = d.tipo === 'entrada' ? d.quantidade : d.tipo === 'saida' ? -d.quantidade : d.quantidade - atual;
        await bumpEstoque(p.id, delta);
        const movimentoId = await create('movimentacoes', {
          produtoId: p.id, produto: p.nome, tipo: d.tipo, quantidade: delta, motivo: d.motivo,
          fornecedorId: d.fornecedorId || null, fornecedor: fornecedores.find(f => f.id === d.fornecedorId)?.nome || '', notaFiscal: d.notaFiscal, custoUnitario: Number(d.custoUnitario) || 0,
          totalCompra: Number(d.totalCompra) || 0, data: new Date().toISOString()
        });
        if (d.tipo === 'entrada' && Number(d.custoUnitario) > 0) await update('produtos', p.id, { precoCusto: Number(d.custoUnitario) });
        // lote/validade do último recebimento: controla vencimento próximo (ver badges e KPI da tela)
        if (d.tipo === 'entrada' && (d.lote || d.loteValidade)) { await update('produtos', p.id, { lote: d.lote || '', validade: d.loteValidade || '' }); p.lote = d.lote; p.validade = d.loteValidade; }
        if (d.tipo === 'entrada' && d.gerarFinanceiro && Number(d.totalCompra) > 0) {
          await create('financeiro', {
            tipo: 'despesa', categoria: 'Fornecedores', descricao: `Compra de ${p.nome}${d.fornecedor ? ' · ' + d.fornecedor : ''}`,
            valor: Number(d.totalCompra), vencimento: d.vencimento || today(),
            pago: Boolean(d.pago), pagoEm: d.pago ? today() : null,
            formaPagamento: d.formaPagamento || 'A definir', fornecedorId: d.fornecedorId || null,
            fornecedor: fornecedores.find(f => f.id === d.fornecedorId)?.nome || '', notaFiscal: d.notaFiscal || '',
            origem: 'movimentacao', origemId: movimentoId, produtoId: p.id
          });
        }
        const lancou = d.tipo === 'entrada' && d.gerarFinanceiro && Number(d.totalCompra) > 0;
        toast(!lancou ? (d.tipo === 'entrada' && d.gerarFinanceiro ? 'Entrada registrada. Informe o custo unitário para lançar a compra no Financeiro.' : 'Estoque atualizado')
          : d.pago ? 'Entrada registrada e compra lançada como paga no Financeiro'
            : `Entrada registrada. Conta de ${money(d.totalCompra)} a pagar em ${d.vencimento.split('-').reverse().join('/')} (Financeiro › Contas a pagar)`);
        await recarregar();
      }
    });
  }

  $('#abas', view).onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) trocarAba(b.dataset.a); };
  $('#fCat', view).onchange = desenhar;
  $('#fBaixo', view).onchange = desenhar;
  $('#fVenc', view).onchange = desenhar;
  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#limparFiltros', view).onclick = () => { $('#fCat', view).value = ''; $('#busca', view).value = ''; $('#fBaixo', view).checked = false; desenhar(); };
  $('#btnNovo', view).onclick = () => abrirForm();
  $('#btnCsv', view).onclick = () => exportCSV('produtos.csv', itens.map(i => ({
    Nome: i.nome, Tipo: i.tipo, Categoria: i.categoria, Codigo: i.codigo, NCM: i.ncm || '', CFOP: i.cfop || '', Custo: i.precoCusto, Venda: i.precoVenda, Estoque: i.estoque, Minimo: i.estoqueMinimo
  })));
  $('#tbody', view).onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const i = itens.find(x => x.id === (b.dataset.edit || b.dataset.del || b.dataset.mov));
    if (b.dataset.edit) abrirForm(i);
    if (b.dataset.mov) movimentar(i);
    if (b.dataset.del && exigirLicenca() && await confirmar(`Excluir <strong>${esc(i.nome)}</strong>?`)) { await remove('produtos', i.id); toast('Item excluído'); recarregar(); }
  };

  trocarAba('produto');
}

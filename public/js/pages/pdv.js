import { state, list, col, ref, db, writeBatch, loadTutoresPets, where } from '../store.js';
import { doc, increment } from '../firebase.js';
import { $, esc, pageHeader, empty, toast, money, num, norm, debounce, today, toISODate, addDays, fmtDateTime, fmtTime, modal, badge } from '../ui.js';
import { exigirLicenca } from '../app.js';
import { emoji } from './pets.js';

const PAGAMENTOS = ['PIX', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Fiado (a receber)'];

export async function render(view) {
  const [itens, dados] = await Promise.all([list('produtos'), loadTutoresPets()]);
  const catalogo = itens.filter(i => i.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome));
  const { clientes, pets, C, P } = dados;
  let carrinho = [];
  let vendasHoje = [];

  view.innerHTML = `
    ${pageHeader('PDV', 'Frente de caixa: venda de produtos e serviços')}
    <div class="row g-3">
      <div class="col-lg-7 col-xl-8">
        <div class="card mb-3"><div class="card-body py-3 d-flex gap-2 flex-wrap">
          <div class="position-relative flex-fill">
            <i class="bi bi-upc-scan position-absolute text-muted" style="left:.8rem;top:50%;transform:translateY(-50%)"></i>
            <input class="form-control form-control-lg ps-5" id="busca" placeholder="Buscar produto/serviço ou bipar código de barras..." autofocus>
          </div>
          <select class="form-select form-select-lg w-auto" id="fTipo"><option value="">Tudo</option><option value="produto">Produtos</option><option value="servico">Serviços</option></select>
        </div></div>
        <div class="row g-2" id="grid"></div>
      </div>

      <div class="col-lg-5 col-xl-4">
        <div class="card pdv-cart">
          <div class="card-header d-flex justify-content-between align-items-center"><span><i class="bi bi-cart3 me-1"></i>Carrinho</span>
            <button class="btn btn-sm btn-light" id="limpar">Limpar</button></div>
          <div class="card-body">
            <div class="row g-2 mb-3">
              <div class="col-12"><select class="form-select" id="cliente"><option value="">Consumidor final</option>${clientes.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></div>
              <div class="col-12"><select class="form-select" id="pet" disabled><option value="">Pet (opcional)</option></select></div>
            </div>
            <div id="itens" style="max-height:34vh;overflow:auto"></div>
            <hr>
            <div class="d-flex justify-content-between fs-7 mb-1"><span class="text-muted">Subtotal</span><span id="subtotal">R$ 0,00</span></div>
            <div class="d-flex justify-content-between align-items-center fs-7 mb-2"><span class="text-muted">Desconto</span>
              <div class="input-group input-group-sm" style="width:130px"><span class="input-group-text">R$</span><input type="number" min="0" step="0.01" class="form-control text-end" id="desconto" value="0"></div></div>
            <div class="d-flex justify-content-between align-items-end mb-3"><span class="fw-semibold">Total</span><span class="pdv-total text-primary" id="total">R$ 0,00</span></div>
            <div class="d-grid gap-2 mb-3" style="grid-template-columns:repeat(2,1fr)" id="pags">
              ${PAGAMENTOS.map((p, i) => `<button class="btn btn-sm ${i === 0 ? 'btn-primary' : 'btn-light border'} ${i === 4 ? 'grid-column-span' : ''}" data-pag="${p}" style="${i === 4 ? 'grid-column:span 2' : ''}">${p}</button>`).join('')}
            </div>
            <div id="troco" class="d-none mb-3"><div class="input-group"><span class="input-group-text">Recebido R$</span><input type="number" step="0.01" class="form-control" id="recebido"><span class="input-group-text" id="trocoVal">Troco R$ 0,00</span></div></div>
            <button class="btn btn-success btn-lg w-100" id="finalizar" disabled><i class="bi bi-check2-circle me-1"></i>Finalizar venda <kbd class="ms-1 bg-transparent border">F2</kbd></button>
          </div>
        </div>
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-header d-flex justify-content-between"><span>Vendas de hoje</span><span class="text-muted fs-7" id="resumoDia"></span></div>
      <div class="table-responsive"><table class="table"><thead><tr><th>Hora</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th class="text-end">Total</th><th></th></tr></thead><tbody id="vendas"></tbody></table></div>
    </div>`;

  let pagamento = PAGAMENTOS[0];

  function desenharCatalogo() {
    const q = norm($('#busca', view).value), t = $('#fTipo', view).value;
    const rows = catalogo.filter(i => (!t || (t === 'servico' ? i.tipo === 'servico' : i.tipo !== 'servico')) && (!q || norm([i.nome, i.codigo, i.categoria].join(' ')).includes(q)));
    $('#grid', view).innerHTML = rows.length ? rows.slice(0, 60).map(i => {
      const serv = i.tipo === 'servico', sem = !serv && (i.estoque ?? 0) <= 0;
      return `<div class="col-6 col-md-4 col-xl-3"><div class="pdv-product ${sem ? 'opacity-50' : ''}" data-add="${i.id}">
        <div class="d-flex justify-content-between mb-1"><i class="bi bi-${serv ? 'scissors text-info' : 'box-seam text-primary'}"></i>
        ${serv ? '' : `<span class="fs-8 ${sem ? 'text-danger' : 'text-muted'}">${num(i.estoque || 0)} ${i.unidade || 'un'}</span>`}</div>
        <div class="fw-semibold fs-7 lh-sm mb-1" style="min-height:2.4em">${esc(i.nome)}</div>
        <div class="fw-bold text-primary">${money(i.precoVenda)}</div></div></div>`;
    }).join('') : `<div class="col-12"><div class="card">${empty('search', catalogo.length ? 'Nada encontrado.' : 'Cadastre produtos e serviços para vender.', '<a href="#/produtos" class="btn btn-soft btn-sm">Cadastrar</a>')}</div></div>`;
  }

  const subtotal = () => carrinho.reduce((s, i) => s + i.preco * i.qtd, 0);
  const total = () => Math.max(0, subtotal() - (Number($('#desconto', view).value) || 0));

  function desenharCarrinho() {
    $('#itens', view).innerHTML = carrinho.length ? carrinho.map((i, idx) => `
      <div class="d-flex align-items-center gap-2 py-2 border-bottom">
        <div class="flex-fill"><div class="fs-7 fw-semibold lh-sm">${esc(i.nome)}</div><div class="fs-8 text-muted">${money(i.preco)} × ${num(i.qtd, i.qtd % 1 ? 2 : 0)}</div></div>
        <div class="btn-group btn-group-sm"><button class="btn btn-light border" data-menos="${idx}">−</button><button class="btn btn-light border" data-mais="${idx}">+</button></div>
        <div class="fw-semibold fs-7 text-end" style="width:80px">${money(i.preco * i.qtd)}</div>
      </div>`).join('') : '<div class="text-center text-muted py-4 fs-7"><i class="bi bi-cart fs-2 d-block mb-1 opacity-50"></i>Carrinho vazio</div>';
    $('#subtotal', view).textContent = money(subtotal());
    $('#total', view).textContent = money(total());
    $('#finalizar', view).disabled = !carrinho.length;
    atualizarTroco();
  }

  function atualizarTroco() {
    $('#troco', view).classList.toggle('d-none', pagamento !== 'Dinheiro');
    const rec = Number($('#recebido', view).value) || 0;
    $('#trocoVal', view).textContent = 'Troco ' + money(Math.max(0, rec - total()));
  }

  function adicionar(id) {
    const p = catalogo.find(i => i.id === id); if (!p) return;
    const noCarrinho = carrinho.find(i => i.id === id);
    if (p.tipo !== 'servico' && (noCarrinho?.qtd || 0) + 1 > (p.estoque ?? 0)) toast(`Estoque de ${p.nome} insuficiente (${num(p.estoque || 0)}).`, 'warning');
    if (noCarrinho) noCarrinho.qtd++;
    else carrinho.push({ id: p.id, nome: p.nome, tipo: p.tipo || 'produto', preco: p.precoVenda || 0, custo: p.precoCusto || 0, qtd: 1 });
    desenharCarrinho();
  }

  async function carregarVendas() {
    vendasHoje = await list('vendas', where('data', '>=', today()));
    vendasHoje.sort((a, b) => b.data.localeCompare(a.data));
    const tot = vendasHoje.filter(v => v.status !== 'cancelada').reduce((s, v) => s + v.total, 0);
    $('#resumoDia', view).textContent = `${vendasHoje.length} vendas · ${money(tot)}`;
    $('#vendas', view).innerHTML = vendasHoje.length ? vendasHoje.map(v => `<tr>
      <td class="fs-7">${fmtTime(v.data)}</td><td class="fs-7">${esc(C[v.clienteId]?.nome || 'Consumidor final')}</td>
      <td class="fs-8 text-muted">${esc(v.itens.map(i => `${i.qtd}× ${i.nome}`).join(', '))}</td>
      <td>${badge(v.pagamento, v.pagamento.startsWith('Fiado') ? 'warning' : 'secondary')}</td><td class="text-end fw-semibold">${money(v.total)}</td>
      <td class="text-end"><button class="btn btn-icon btn-light" data-cupom="${v.id}" title="Cupom"><i class="bi bi-receipt"></i></button></td></tr>`).join('')
      : `<tr><td colspan="6" class="text-center text-muted py-4 fs-7">Nenhuma venda hoje ainda.</td></tr>`;
  }

  async function finalizar() {
    if (!carrinho.length || !exigirLicenca()) return;
    const btn = $('#finalizar', view); btn.disabled = true;
    try {
      const fiado = pagamento.startsWith('Fiado');
      const clienteId = $('#cliente', view).value || null;
      if (fiado && !clienteId) throw new Error('Selecione o cliente para vender fiado.');
      const venda = {
        itens: carrinho, clienteId, petId: $('#pet', view).value || null,
        subtotal: subtotal(), desconto: Number($('#desconto', view).value) || 0, total: total(),
        pagamento, status: 'concluida', data: new Date().toISOString().slice(0, 19),
        vendedorId: state.user.uid, vendedor: state.perfil.nome, criadoEm: new Date().toISOString()
      };
      // venda + baixa de estoque + lançamento financeiro numa única transação
      const b = writeBatch(db);
      const vRef = doc(col('vendas'));
      b.set(vRef, venda);
      carrinho.filter(i => i.tipo !== 'servico').forEach(i => b.update(ref('produtos', i.id), { estoque: increment(-i.qtd) }));
      b.set(doc(col('financeiro')), {
        tipo: 'receita', categoria: carrinho.every(i => i.tipo === 'servico') ? 'Serviços' : 'Vendas PDV',
        descricao: `Venda PDV #${vRef.id.slice(0, 6).toUpperCase()}${clienteId ? ' - ' + C[clienteId].nome : ''}`,
        valor: venda.total, vencimento: fiado ? toISODate(addDays(new Date(), 30)) : today(),
        pago: !fiado, pagoEm: fiado ? null : today(), formaPagamento: pagamento,
        origem: 'venda', origemId: vRef.id, clienteId, criadoEm: new Date().toISOString()
      });
      await b.commit();
      catalogo.forEach(p => { const c = carrinho.find(i => i.id === p.id); if (c && p.tipo !== 'servico') p.estoque = (p.estoque || 0) - c.qtd; });
      toast(`Venda de ${money(venda.total)} finalizada! 🎉`);
      cupom({ id: vRef.id, ...venda });
      carrinho = []; $('#desconto', view).value = 0; $('#recebido', view).value = '';
      desenharCarrinho(); desenharCatalogo(); carregarVendas();
    } catch (e) { toast(e.message, 'danger'); }
    finally { btn.disabled = !carrinho.length; }
  }

  function cupom(v) {
    const c = state.clinica;
    const html = `<div id="cupom" style="font-family:monospace;font-size:13px;max-width:300px;margin:auto">
      <div class="text-center fw-bold">${esc(c.nome)}</div><div class="text-center fs-8">${esc(c.cnpj ? 'CNPJ ' + c.cnpj : '')} ${esc(c.telefone || '')}</div>
      <div class="text-center fs-8 mb-2">${fmtDateTime(v.data)} · #${v.id.slice(0, 6).toUpperCase()}</div><hr class="my-1">
      ${v.itens.map(i => `<div class="d-flex justify-content-between"><span>${i.qtd}× ${esc(i.nome)}</span><span>${money(i.preco * i.qtd)}</span></div>`).join('')}
      <hr class="my-1">${v.desconto ? `<div class="d-flex justify-content-between"><span>Desconto</span><span>-${money(v.desconto)}</span></div>` : ''}
      <div class="d-flex justify-content-between fw-bold fs-6"><span>TOTAL</span><span>${money(v.total)}</span></div>
      <div>Pagamento: ${esc(v.pagamento)}</div>${v.clienteId ? `<div>Cliente: ${esc(C[v.clienteId]?.nome || '')}</div>` : ''}
      <div class="text-center mt-2 fs-8">Obrigado pela preferência! 🐾<br>Documento sem valor fiscal</div></div>`;
    const { el } = modal({ title: 'Cupom da venda', size: 'sm', body: html, footer: '<button class="btn btn-primary w-100" data-print><i class="bi bi-printer me-1"></i>Imprimir</button>' });
    $('[data-print]', el).onclick = () => { const w = window.open('', '_blank', 'width=360,height=600'); w.document.write(`<html><body style="margin:10px">${$('#cupom', el).outerHTML.replace(/class="[^"]*"/g, '')}<script>window.print()<\/script></body></html>`); w.document.close(); };
  }

  // ---------- eventos ----------
  const busca = $('#busca', view);
  busca.addEventListener('input', debounce(desenharCatalogo, 120));
  busca.addEventListener('keydown', (e) => { // leitor de código de barras envia Enter
    if (e.key !== 'Enter') return;
    const p = catalogo.find(i => i.codigo && i.codigo === busca.value.trim());
    if (p) { adicionar(p.id); busca.value = ''; desenharCatalogo(); }
  });
  $('#fTipo', view).onchange = desenharCatalogo;
  $('#grid', view).onclick = (e) => { const c = e.target.closest('[data-add]'); if (c) adicionar(c.dataset.add); };
  $('#itens', view).onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const idx = Number(b.dataset.mais ?? b.dataset.menos);
    if (b.dataset.mais != null) carrinho[idx].qtd++;
    else if (--carrinho[idx].qtd <= 0) carrinho.splice(idx, 1);
    desenharCarrinho();
  };
  $('#desconto', view).oninput = desenharCarrinho;
  $('#recebido', view).oninput = atualizarTroco;
  $('#limpar', view).onclick = () => { carrinho = []; desenharCarrinho(); };
  $('#pags', view).onclick = (e) => {
    const b = e.target.closest('[data-pag]'); if (!b) return;
    pagamento = b.dataset.pag;
    $('#pags', view).querySelectorAll('button').forEach(x => x.className = `btn btn-sm ${x === b ? 'btn-primary' : 'btn-light border'}`);
    atualizarTroco();
  };
  $('#cliente', view).onchange = (e) => {
    const ps = pets.filter(p => p.clienteId === e.target.value);
    $('#pet', view).disabled = !ps.length;
    $('#pet', view).innerHTML = `<option value="">Pet (opcional)</option>${ps.map(p => `<option value="${p.id}">${emoji(p.especie)} ${esc(p.nome)}</option>`).join('')}`;
  };
  $('#finalizar', view).onclick = finalizar;
  $('#vendas', view).onclick = (e) => { const b = e.target.closest('[data-cupom]'); if (b) cupom(vendasHoje.find(v => v.id === b.dataset.cupom)); };
  const atalho = (e) => { if (!document.body.contains(view) || !$('#finalizar', view)) return document.removeEventListener('keydown', atalho); if (e.key === 'F2') { e.preventDefault(); finalizar(); } };
  document.addEventListener('keydown', atalho);

  desenharCatalogo(); desenharCarrinho(); carregarVendas();
}

import { state, list, get, update, create, col, ref, db, writeBatch, loadTutoresPets, where } from '../store.js';
import { doc, increment, chamarFuncao, mensagemErroFuncao } from '../firebase.js';
import { $, esc, pageHeader, empty, toast, money, num, norm, debounce, today, toISODate, addDays, fmtDateTime, fmtTime, modal, badge, selectBusca, agoraLocal } from '../ui.js';
import { exigirLicenca } from '../app.js';
import { emoji } from './pets.js';
import { NCM_SUGERIDO, NCM_LISTA, soDigitos, descricaoNcm } from '../fiscalDados.js';
import { ligarBuscaNcm } from '../ncm.js';

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
          <button class="btn btn-light border btn-lg" id="limparFiltros" title="Limpar filtros"><i class="bi bi-x-circle"></i></button>
        </div></div>
        <div class="row g-2" id="grid"></div>
      </div>

      <div class="col-lg-5 col-xl-4">
        <div class="card pdv-cart">
          <div class="card-header d-flex justify-content-between align-items-center"><span><i class="bi bi-cart3 me-1"></i>Carrinho</span>
            <button class="btn btn-sm btn-light" id="limpar">Limpar</button></div>
          <div class="card-body">
            <div class="row g-2 mb-3">
              <div class="col-12"><select class="form-select" id="cliente" data-placeholder="Consumidor final (buscar cliente...)"><option value="">Consumidor final</option>${clientes.map(c => `<option value="${c.id}" data-busca="${esc([c.telefone, c.cpf].filter(Boolean).join(' '))}">${esc(c.nome)}</option>`).join('')}</select></div>
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
      <div class="table-responsive"><table class="table"><thead><tr><th>Hora</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th class="text-end">Total</th><th>NFC-e</th><th></th></tr></thead><tbody id="vendas"></tbody></table></div>
    </div>`;

  selectBusca($('#cliente', view));
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

  // estado fiscal usado pela coluna/ações de NFC-e
  const fiscalCfg = state.clinica?.fiscal || {};
  const nfceIntegrada = ['tecnospeed', 'plugnotas'].includes(fiscalCfg.provedor);
  const PRODUTOS = Object.fromEntries(itens.map(p => [p.id, p]));
  const temProdutos = (v) => (v.itens || []).some(i => i.tipo !== 'servico');
  const EM_ANDAMENTO = ['enviando', 'processando', 'cancelando'];
  function nfceCelula(v) {
    if (!nfceIntegrada || !temProdutos(v)) return '<span class="text-muted fs-8">—</span>';
    const st = v.nfceStatus;
    if (st === 'emitida') return `<button class="btn btn-sm btn-light border text-nowrap" data-nfce-pdf="${v.nfceId}" title="Abrir DANFE"><i class="bi bi-file-earmark-pdf text-danger me-1"></i>nº ${esc(v.nfceNumero || '')}</button>`;
    if (EM_ANDAMENTO.includes(st)) return badge('processando', 'info');
    if (st === 'cancelada') return badge('cancelada', 'secondary');
    return `<button class="btn btn-sm btn-soft text-nowrap" data-nfce="${v.id}">${st === 'rejeitada' ? 'Reenviar NFC-e' : 'Emitir NFC-e'}</button>`;
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
      <td>${nfceCelula(v)}</td>
      <td class="text-end"><button class="btn btn-icon btn-light" data-cupom="${v.id}" title="Cupom"><i class="bi bi-receipt"></i></button></td></tr>`).join('')
      : `<tr><td colspan="7" class="text-center text-muted py-4 fs-7">Nenhuma venda hoje ainda.</td></tr>`;
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
        pagamento, status: 'concluida', data: agoraLocal(),
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
    const podeNfce = nfceIntegrada && temProdutos(v) && !['emitida', ...EM_ANDAMENTO].includes(v.nfceStatus);
    const { el, close } = modal({
      title: 'Cupom da venda', size: 'sm', body: html,
      footer: `${podeNfce ? `<button class="btn btn-success w-100" data-nfce-cupom><i class="bi bi-receipt-cutoff me-1"></i>Emitir NFC-e${fiscalCfg.ambiente === 'teste' ? ' (teste, sem valor fiscal)' : ''}</button>` : ''}
        <button class="btn btn-primary w-100" data-print><i class="bi bi-printer me-1"></i>Imprimir cupom</button>`
    });
    $('[data-nfce-cupom]', el)?.addEventListener('click', () => {
      el.addEventListener('hidden.bs.modal', () => emitirNfce(v), { once: true }); // abre o próximo passo só depois de fechar este modal
      close();
    });
    $('[data-print]', el).onclick = () => { const w = window.open('', '_blank', 'width=360,height=600'); w.document.write(`<html><body style="margin:10px">${$('#cupom', el).outerHTML.replace(/class="[^"]*"/g, '')}<script>window.print()<\/script></body></html>`); w.document.close(); };
  }

  // ---------- NFC-e (nota fiscal do balcão) ----------
  // Mostra o que vai ser emitido (igual ao padrão da tela Fiscal) antes de transmitir de verdade.
  function confirmarEmissaoNfce({ tomador, itensNfce, total, pagamento, cpfPadrao }) {
    return new Promise(resolve => {
      let feito = false;
      const aviso = fiscalCfg.ambiente === 'teste'
        ? 'A nota será gerada no <strong>modo teste</strong> e <strong>não terá valor fiscal</strong>.'
        : fiscalCfg.ambiente === 'producao'
          ? 'A NFC-e será enviada à SEFAZ <strong>com valor fiscal</strong>. Confira antes de emitir:'
          : 'A NFC-e será enviada em <strong>homologação</strong> (sem valor fiscal).';
      const { el, close } = modal({
        title: 'Emitir NFC-e', size: 'md',
        body: `<p class="fs-7">${aviso}</p>
          <div class="bg-light rounded-3 p-2 px-3 mb-3 fs-7">
            <div class="fw-semibold mb-1">${esc(tomador || 'Consumidor final')}</div>
            ${itensNfce.map(i => `<div class="d-flex justify-content-between"><span>${num(i.qtd, i.qtd % 1 ? 2 : 0)}× ${esc(i.nome)}</span><span>${money(i.preco * i.qtd)}</span></div>`).join('')}
            <div class="d-flex justify-content-between fw-semibold border-top mt-2 pt-2"><span>Total</span><span>${money(total)}</span></div>
            <div class="fs-8 text-muted mt-1">Pagamento: ${esc(pagamento)}</div>
          </div>
          <label class="form-label">CPF ou CNPJ do cliente <span class="text-muted fw-normal">(opcional)</span></label>
          <input class="form-control" id="cpfNota" value="${esc(cpfPadrao)}" inputmode="numeric" placeholder="000.000.000-00" autocomplete="off">`,
        footer: '<button class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-success" id="okCpf"><i class="bi bi-send me-1"></i>Emitir agora</button>'
      });
      $('#okCpf', el).onclick = () => {
        const d = $('#cpfNota', el).value.replace(/\D/g, '');
        if (d && ![11, 14].includes(d.length)) return toast('CPF (11 dígitos) ou CNPJ (14 dígitos) inválido.', 'warning');
        feito = true; resolve(d); close();
      };
      el.addEventListener('hidden.bs.modal', () => { if (!feito) resolve(null); });
    });
  }

  // Produto sem NCM: pede o NCM ali mesmo (com sugestão pela categoria), grava no cadastro e segue a emissão
  function completarNcm(itensSemNcm) {
    return new Promise(resolve => {
      let salvo = false;
      const linhas = itensSemNcm.map(i => {
        const p = PRODUTOS[i.id] || {};
        const sug = NCM_SUGERIDO[p.categoria] || '';
        return `<div class="mb-3">
          <label class="form-label">${esc(i.nome)} <span class="text-muted fw-normal">· ${esc(p.categoria || 'sem categoria')}</span></label>
          <input class="form-control" data-ncm="${i.id}" value="${sug}" inputmode="numeric" maxlength="10" placeholder="Ex.: 2309.10.00">
          <div class="fs-8 text-muted mt-1">${sug ? 'Sugerido pela categoria: ' + esc(descricaoNcm(sug)) : 'Sem sugestão para esta categoria: use o NCM da nota do fornecedor.'}</div>
        </div>`;
      }).join('');
      const { el, close } = modal({
        title: 'Complete o NCM para emitir', size: 'md',
        body: `<p class="fs-7 text-muted">A NFC-e exige o NCM (classificação fiscal) de cada produto. Digite o código ou o nome do produto para buscar. Fica salvo no cadastro para as próximas vendas.</p>${linhas}
          <div class="alert alert-info fs-8 mb-0">Sugestões comuns para petshop. Confirme com o seu contador.</div>`,
        footer: '<button class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary" id="okNcm"><i class="bi bi-check2 me-1"></i>Salvar e continuar</button>'
      });
      el.querySelectorAll('[data-ncm]').forEach(inp => ligarBuscaNcm(inp));
      $('#okNcm', el).onclick = async () => {
        const campos = [...el.querySelectorAll('[data-ncm]')];
        campos.forEach(c => c.classList.remove('is-invalid'));
        const invalido = campos.find(c => soDigitos(c.value).length !== 8);
        if (invalido) { invalido.classList.add('is-invalid'); invalido.focus(); return toast('Cada NCM precisa ter 8 dígitos (ex.: 2309.10.00).', 'warning'); }
        const btn = $('#okNcm', el); btn.disabled = true;
        try {
          for (const c of campos) {
            const ncm = soDigitos(c.value);
            await update('produtos', c.dataset.ncm, { ncm });
            if (PRODUTOS[c.dataset.ncm]) PRODUTOS[c.dataset.ncm].ncm = ncm;
          }
          salvo = true;
          toast('NCM salvo no cadastro dos produtos');
          close();
        } catch (e) { toast(e.message, 'danger'); btn.disabled = false; }
      };
      el.addEventListener('hidden.bs.modal', () => resolve(salvo)); // só continua depois de fechar (sem modais sobrepostos)
    });
  }

  async function acompanharNfce(id) {
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, i < 4 ? 3000 : 6000));
      try {
        const r = await chamarFuncao('consultarNotaFiscal', { documentoId: id });
        if (!EM_ANDAMENTO.includes(r.status)) return r;
      } catch { /* tenta de novo no próximo ciclo */ }
    }
    return null;
  }

  async function emitirNfce(v) {
    if (!v || !exigirLicenca()) return;
    const produtos = (v.itens || []).filter(i => i.tipo !== 'servico');
    if (!produtos.length) return toast('Esta venda só tem serviços: emita a NFS-e na tela Fiscal.', 'info');
    const faltaNcm = [...new Map(produtos.filter(i => soDigitos(PRODUTOS[i.id]?.ncm).length !== 8).map(i => [i.id, i])).values()];
    if (faltaNcm.length) { if (await completarNcm(faltaNcm)) emitirNfce(v); return; } // completa o NCM ali mesmo e segue a emissão

    // serviços ficam fora da NFC-e; o desconto da venda é rateado proporcionalmente aos produtos
    const bruto = v.itens.reduce((s, i) => s + i.preco * i.qtd, 0);
    const brutoProd = produtos.reduce((s, i) => s + i.preco * i.qtd, 0);
    const desconto = bruto ? Math.round((v.desconto || 0) * brutoProd / bruto * 100) / 100 : 0;
    const total = Math.round((brutoProd - desconto) * 100) / 100;

    const cpf = await confirmarEmissaoNfce({ tomador: C[v.clienteId]?.nome, itensNfce: produtos, total, pagamento: v.pagamento, cpfPadrao: C[v.clienteId]?.cpf || '' });
    if (cpf === null) return;

    const nota = {
      tipo: 'nfce', integracao: true, status: 'rascunho', vendaId: v.id, dataEmissao: today(),
      clienteId: v.clienteId || null, tomadorNome: C[v.clienteId]?.nome || '', tomadorCpf: cpf,
      descricao: `Venda PDV #${v.id.slice(0, 6).toUpperCase()}`, pagamento: v.pagamento, desconto, valor: total,
      itens: produtos.map(i => {
        const p = PRODUTOS[i.id] || {};
        return { produtoId: i.id, nome: i.nome, codigo: p.codigo || '', qtd: i.qtd, preco: i.preco, unidade: p.unidade || 'un',
          ncm: p.ncm || '', cfop: p.cfop || '', cest: p.cest || '', origem: p.origem ?? '0', icmsSituacao: p.icmsSituacao || '' };
      })
    };
    toast('Enviando NFC-e…', 'info');
    try {
      let id = null;
      if (v.nfceId) { // reaproveita a nota rejeitada/rascunho desta venda (com os dados fiscais atualizados)
        const atual = await get('fiscal', v.nfceId);
        if (atual && ['rascunho', 'rejeitada'].includes(atual.status)) { id = v.nfceId; await update('fiscal', id, { ...nota, status: atual.status }); }
        else if (atual && atual.status !== 'cancelada') return toast('Esta venda já possui NFC-e.', 'info');
      }
      if (!id) id = await create('fiscal', nota);
      await chamarFuncao('emitirNotaFiscal', { documentoId: id });
      await carregarVendas();
      const r = await acompanharNfce(id);
      await carregarVendas();
      if (!r) return toast('A SEFAZ ainda está processando. A situação aparece na lista de vendas em instantes.', 'info');
      if (r.status === 'emitida') toast('NFC-e autorizada ✔ Clique no número da nota para abrir o DANFE.');
      else toast(`NFC-e ${r.status}: ${r.mensagem || ''}`, 'warning');
    } catch (e) {
      toast(mensagemErroFuncao(e), 'danger');
      carregarVendas();
    }
  }

  async function abrirDanfe(id) {
    const janela = window.open('', '_blank'); // abre já no clique para o navegador não bloquear
    try {
      const { url } = await chamarFuncao('linkArquivoNotaFiscal', { documentoId: id, formato: 'pdf' });
      if (janela) janela.location.href = url; else location.href = url;
    } catch (e) { janela?.close(); toast(mensagemErroFuncao(e), 'warning'); }
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
  $('#limparFiltros', view).onclick = () => { busca.value = ''; $('#fTipo', view).value = ''; desenharCatalogo(); };
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
  $('#vendas', view).onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cupom) return cupom(vendasHoje.find(v => v.id === b.dataset.cupom));
    if (b.dataset.nfce) return emitirNfce(vendasHoje.find(v => v.id === b.dataset.nfce));
    if (b.dataset.nfcePdf) return abrirDanfe(b.dataset.nfcePdf);
  };
  const atalho = (e) => { if (!document.body.contains(view) || !$('#finalizar', view)) return document.removeEventListener('keydown', atalho); if (e.key === 'F2') { e.preventDefault(); finalizar(); } };
  document.addEventListener('keydown', atalho);

  desenharCatalogo(); desenharCarrinho(); carregarVendas();
}

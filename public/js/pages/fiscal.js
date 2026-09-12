import { state, list, save, remove, loadTutoresPets } from '../store.js';
import { chamarFuncao, mensagemErroFuncao as erroFuncao } from '../firebase.js';
import { $, esc, pageHeader, empty, formModal, confirmar, toast, money, num, fmtDate, today, badge, kpi, exportCSV, norm, debounce } from '../ui.js';
import { exigirLicenca } from '../app.js';
import { previsualizar } from '../documentos.js';
import * as D from '../docs.js';

const TIPOS = [
  { value: 'nfse', label: 'NFS-e · Serviço' },
  { value: 'nfce', label: 'NFC-e · Consumidor (balcão)' },
  { value: 'nfe', label: 'NF-e · Produto' }
];
const NOMES = { nfse: 'NFS-e', nfce: 'NFC-e', nfe: 'NF-e' };
const STATUS = {
  rascunho: { l: 'Rascunho', c: 'secondary' },
  pendente: { l: 'Pendente de emissão', c: 'warning' },
  enviando: { l: 'Enviando…', c: 'info' },
  processando: { l: 'Processando', c: 'info' },
  emitida: { l: 'Emitida', c: 'success' },
  rejeitada: { l: 'Rejeitada', c: 'danger' },
  cancelando: { l: 'Cancelando…', c: 'warning' },
  cancelada: { l: 'Cancelada', c: 'danger' }
};
const STATUS_MANUAL = ['rascunho', 'pendente', 'emitida', 'cancelada'];
const EM_ANDAMENTO = ['enviando', 'processando', 'cancelando'];
const MOTIVOS = [{ value: 1, label: 'Erro na emissão' }, { value: 2, label: 'Serviço não prestado' }, { value: 4, label: 'Duplicidade da nota' }];
const PAGAMENTOS = ['PIX', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Boleto', 'Transferência'];
const PRAZO_CANCELAMENTO = {
  nfse: 'O cancelamento vai para a prefeitura e não pode ser desfeito. Algumas prefeituras só aceitam cancelar dentro de um prazo.',
  nfce: 'A NFC-e só pode ser cancelada até 30 minutos após a autorização (na maioria dos estados). Depois disso, é preciso emitir nota de devolução.',
  nfe: 'A NF-e pode ser cancelada em até 24 horas após a autorização. Depois disso, é preciso emitir nota de devolução.'
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const soDig = (s) => String(s || '').replace(/\D/g, '');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtNcm = (s) => soDig(s).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
const ncmOk = (i) => soDig(i.ncm).length === 8;
const editavel = (n) => n.integracao !== true || ['rascunho', 'rejeitada'].includes(n.status);

export async function render(view) {
  let [notas, { clientes, C }, catalogo] = await Promise.all([list('fiscal'), loadTutoresPets(), list('produtos')]);
  const produtos = catalogo.filter(p => p.tipo !== 'servico').sort((a, b) => a.nome.localeCompare(b.nome));
  const fiscal = state.clinica?.fiscal || {};
  const integrada = ['tecnospeed', 'plugnotas'].includes(fiscal.provedor);
  const ambiente = fiscal.ambiente || 'homologacao';
  const teste = integrada && ambiente === 'teste';

  const banner = !integrada
    ? ['info', 'info-circle', '<strong>Emissão integrada desativada.</strong> Você pode registrar notas emitidas fora do Petzy e gerar recibos. Para emitir direto daqui, escolha <strong>TecnoSpeed / PlugNotas</strong> em Configurações › Dados › Integração fiscal.']
    : teste ? ['warning', 'cone-striped', '<strong>Modo teste: sem valor fiscal.</strong> NFS-e, NFC-e e NF-e são geradas no ambiente de testes da TecnoSpeed, com a empresa de demonstração. Use para conhecer o fluxo completo (número, PDF e XML).']
      : ambiente === 'producao' ? ['success', 'patch-check', '<strong>Produção.</strong> As notas emitidas aqui <strong>têm valor fiscal</strong>.']
        : ['info', 'hourglass-split', '<strong>Homologação.</strong> As notas vão para o ambiente de testes da prefeitura/SEFAZ e não têm valor fiscal.'];

  view.innerHTML = `
    ${pageHeader('Fiscal', 'NFS-e, NFC-e e NF-e da clínica',
      `<button class="btn btn-light border" id="btnCsv"><i class="bi bi-download me-1"></i>Exportar</button>
       <button class="btn btn-primary" id="btnNova"><i class="bi bi-plus-lg me-1"></i>Nova nota</button>`)}
    <div class="alert alert-${banner[0]} d-flex gap-2 align-items-start mb-3"><i class="bi bi-${banner[1]} mt-1"></i><div>${banner[2]}</div></div>
    <div class="row g-3 mb-3" id="kpis"></div>
    <div class="card">
      <div class="card-header d-flex gap-2 flex-wrap align-items-center">
        <select class="form-select w-auto" id="fTipo"><option value="">Todos os tipos</option>${TIPOS.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}</select>
        <select class="form-select w-auto" id="fStatus"><option value="">Todos os status</option>${Object.entries(STATUS).map(([v, s]) => `<option value="${v}">${s.l}</option>`).join('')}</select>
        <input class="form-control" style="max-width:280px" id="busca" placeholder="Número, tomador ou descrição...">
        <button class="btn btn-light border" id="limpar"><i class="bi bi-x-circle me-1"></i>Limpar</button>
      </div>
      <div class="table-responsive"><table class="table table-hover"><thead><tr><th>Data</th><th>Tipo</th><th>Número / série</th><th>Tomador</th><th>Status</th><th class="text-end">Valor</th><th class="text-end">Ações</th></tr></thead><tbody id="tbody"></tbody></table></div>
    </div>`;

  const tbody = $('#tbody', view);
  const tomadorDe = (n) => C[n.clienteId]?.nome || n.tomadorNome || 'Consumidor final';

  function acoes(n) {
    const integ = n.integracao === true;
    const principal = [];
    if (integ && ['rascunho', 'rejeitada'].includes(n.status)) principal.push(`<button class="btn btn-sm btn-primary" data-emitir="${n.id}"><i class="bi bi-send me-1"></i>${n.status === 'rejeitada' ? 'Reenviar' : 'Emitir'}</button>`);
    if (integ && EM_ANDAMENTO.includes(n.status)) principal.push(`<button class="btn btn-icon btn-light" title="Atualizar status" data-consultar="${n.id}"><i class="bi bi-arrow-clockwise"></i></button>`);
    const temArquivos = integ && n.idProvedor && ['emitida', 'cancelada'].includes(n.status);
    if (temArquivos) principal.push(`<button class="btn btn-icon btn-light" title="PDF da nota" data-arq="pdf" data-id="${n.id}"><i class="bi bi-file-earmark-pdf text-danger"></i></button>`);
    if (temArquivos) principal.push(`<button class="btn btn-icon btn-light" title="XML da nota" data-arq="xml" data-id="${n.id}"><i class="bi bi-filetype-xml text-primary"></i></button>`);
    if (!integ && n.pdfUrl) principal.push(`<a class="btn btn-icon btn-light" title="PDF" target="_blank" rel="noopener" href="${esc(n.pdfUrl)}"><i class="bi bi-file-earmark-pdf text-danger"></i></a>`);
    const menu = [
      `<li><button class="dropdown-item" data-recibo="${n.id}"><i class="bi bi-receipt me-2 text-primary"></i>Recibo (sem valor fiscal)</button></li>`,
      editavel(n) ? `<li><button class="dropdown-item" data-edit="${n.id}"><i class="bi bi-pencil me-2"></i>Editar</button></li>` : '',
      integ && n.status === 'emitida' ? `<li><button class="dropdown-item text-danger" data-cancelar="${n.id}"><i class="bi bi-x-octagon me-2"></i>Cancelar ${NOMES[n.tipo]}</button></li>` : '',
      editavel(n) ? `<li><hr class="dropdown-divider"></li><li><button class="dropdown-item text-danger" data-del="${n.id}"><i class="bi bi-trash me-2"></i>Excluir</button></li>` : ''
    ].join('');
    return `${principal.join(' ')}
      <div class="dropdown d-inline-block"><button class="btn btn-icon btn-light" data-bs-toggle="dropdown" data-bs-popper-config='{"strategy":"fixed"}' title="Mais ações"><i class="bi bi-three-dots-vertical"></i></button>
      <ul class="dropdown-menu dropdown-menu-end">${menu}</ul></div>`;
  }

  function desenhar() {
    const mes = today().slice(0, 7);
    const emitidasMes = notas.filter(n => n.status === 'emitida' && (n.dataEmissao || '').startsWith(mes));
    $('#kpis', view).innerHTML = `
      <div class="col-6 col-xl-3">${kpi('patch-check', 'Emitidas no mês', `${emitidasMes.length} · ${money(emitidasMes.reduce((s, n) => s + (Number(n.valor) || 0), 0))}`, 'success')}</div>
      <div class="col-6 col-xl-3">${kpi('hourglass-split', 'Em processamento', notas.filter(n => EM_ANDAMENTO.includes(n.status)).length, 'info')}</div>
      <div class="col-6 col-xl-3">${kpi('exclamation-octagon', 'Rejeitadas', notas.filter(n => n.status === 'rejeitada').length, 'danger')}</div>
      <div class="col-6 col-xl-3">${kpi('pencil-square', 'Rascunhos', notas.filter(n => n.status === 'rascunho').length, 'warning')}</div>`;

    const tipo = $('#fTipo', view).value, status = $('#fStatus', view).value, q = norm($('#busca', view).value);
    const rows = notas.filter(n => (!tipo || n.tipo === tipo) && (!status || n.status === status)
      && (!q || norm([n.numero, n.serie, n.chave, n.descricao, tomadorDe(n)].join(' ')).includes(q)))
      .sort((a, b) => (b.dataEmissao || '').localeCompare(a.dataEmissao || '') || String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));

    tbody.innerHTML = rows.length ? rows.map(n => {
      const st = STATUS[n.status] || { l: n.status || '—', c: 'secondary' };
      const origem = n.integracao ? `<i class="bi bi-lightning-charge"></i> via TecnoSpeed${n.vendaId ? ' · venda PDV' : ''}` : 'registro manual';
      return `<tr>
        <td class="fs-7 text-nowrap">${fmtDate(n.dataEmissao)}</td>
        <td class="fs-7">${esc(TIPOS.find(t => t.value === n.tipo)?.label || n.tipo)}<div class="fs-8 text-muted">${origem}</div></td>
        <td><div class="fw-semibold">${esc(n.numero || 'Sem número')}</div><div class="text-muted fs-8">${[n.serie && 'Série ' + esc(n.serie), n.codigoVerificacao && 'Cód. ' + esc(n.codigoVerificacao), n.chave && `<span class="font-monospace" title="${esc(n.chave)}">chave …${esc(String(n.chave).slice(-8))}</span>`].filter(Boolean).join(' · ')}</div></td>
        <td class="fs-7">${esc(tomadorDe(n))}${n.itens?.length ? `<div class="fs-8 text-muted">${n.itens.length} produto(s)</div>` : ''}</td>
        <td>${badge(st.l, st.c)} ${n.semValorFiscal && n.status === 'emitida' ? badge('sem valor fiscal', 'warning') : ''}
          ${n.mensagem && ['rejeitada', 'rascunho'].includes(n.status) ? `<div class="fs-8 text-danger mt-1" style="max-width:300px">${esc(n.mensagem)}</div>` : ''}</td>
        <td class="text-end fw-semibold">${money(n.valor)}</td>
        <td class="text-end text-nowrap">${acoes(n)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="7">${empty('receipt-cutoff', notas.length ? 'Nenhuma nota encontrada.' : 'Nenhum documento fiscal ainda. Clique em "Nova nota" ou emita a NFC-e direto no PDV.')}</td></tr>`;
  }

  async function recarregar() { notas = await list('fiscal'); if (tbody.isConnected) desenhar(); }

  // Acompanha a autorização (prefeitura/SEFAZ costuma responder em segundos)
  async function acompanhar(id) {
    for (let i = 0; i < 12; i++) {
      await sleep(i < 4 ? 3000 : 7000);
      if (!tbody.isConnected) return;
      try {
        const r = await chamarFuncao('consultarNotaFiscal', { documentoId: id });
        if (!EM_ANDAMENTO.includes(r.status)) {
          await recarregar();
          const n = notas.find(x => x.id === id);
          if (r.status === 'emitida') toast(`${NOMES[n?.tipo] || 'Nota'} autorizada ✔`);
          else if (r.status === 'cancelada') toast(`${NOMES[n?.tipo] || 'Nota'} cancelada`);
          else toast(`Nota ${STATUS[r.status]?.l.toLowerCase() || r.status}: ${r.mensagem || ''}`, 'warning');
          return;
        }
      } catch { /* tenta de novo no próximo ciclo */ }
    }
    await recarregar();
    toast('Ainda em processamento. Use "Atualizar status" em alguns minutos.', 'info');
  }

  const ocupado = (btn, on) => {
    if (!btn) return;
    btn.disabled = on;
    if (on) { btn.dataset.html = btn.innerHTML; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }
    else if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
  };

  async function emitir(n, btn) {
    if (!exigirLicenca()) return;
    const nome = NOMES[n.tipo];
    const aviso = teste ? `A ${nome} será gerada no <strong>modo teste</strong> e <strong>não terá valor fiscal</strong>.`
      : ambiente === 'producao' ? `A ${nome} será emitida <strong>com valor fiscal</strong>. Confira antes de emitir:`
        : `A ${nome} será enviada em <strong>homologação</strong> (sem valor fiscal).`;
    const detalhe = n.tipo === 'nfse'
      ? `<div><strong>Serviço:</strong> ${esc(n.descricao)}</div>`
      : `<div><strong>Produtos:</strong> ${esc((n.itens || []).map(i => `${num(i.qtd, i.qtd % 1 ? 3 : 0)}× ${i.nome}`).join(', '))}</div>${n.desconto ? `<div><strong>Desconto:</strong> ${money(n.desconto)}</div>` : ''}<div><strong>Pagamento:</strong> ${esc(n.pagamento || 'PIX')}</div>`;
    const ok = await confirmar(`${aviso}
      <div class="bg-light rounded-3 p-2 px-3 mt-2 fs-7">
        <div><strong>${n.tipo === 'nfse' ? 'Tomador' : 'Destinatário'}:</strong> ${esc(tomadorDe(n))}${C[n.clienteId]?.cpf || n.tomadorCpf ? ' · ' + esc(C[n.clienteId]?.cpf || n.tomadorCpf) : ''}</div>
        ${detalhe}
        <div><strong>Valor:</strong> ${money(n.valor)}</div>
      </div>`, { title: `Emitir ${nome}`, ok: 'Emitir agora', danger: false });
    if (!ok) return;
    ocupado(btn, true);
    try {
      await chamarFuncao('emitirNotaFiscal', { documentoId: n.id });
      toast('Nota enviada. Aguardando autorização…', 'info');
      await recarregar();
      acompanhar(n.id);
    } catch (e) {
      toast(erroFuncao(e), 'danger');
      await recarregar();
    }
  }

  async function consultar(n, btn) {
    ocupado(btn, true);
    try {
      const r = await chamarFuncao('consultarNotaFiscal', { documentoId: n.id });
      await recarregar();
      toast(EM_ANDAMENTO.includes(r.status) ? 'Ainda em processamento.' : `Status: ${STATUS[r.status]?.l || r.status}`, EM_ANDAMENTO.includes(r.status) ? 'info' : 'success');
    } catch (e) { toast(erroFuncao(e), 'danger'); ocupado(btn, false); }
  }

  function cancelar(n) {
    const servico = n.tipo === 'nfse';
    formModal({
      title: `Cancelar ${NOMES[n.tipo]} ${esc(n.numero || '')}`, size: 'md', submit: 'Solicitar cancelamento', values: { codigo: 1 },
      fields: [
        { type: 'custom', col: 'col-12', html: `<div class="alert alert-warning fs-7 mb-0">${PRAZO_CANCELAMENTO[n.tipo]}</div>` },
        ...(servico ? [{ name: 'codigo', label: 'Motivo', type: 'select', required: true, options: MOTIVOS, col: 'col-12' }] : []),
        { name: 'motivo', label: 'Justificativa', type: 'textarea', rows: 3, required: true, col: 'col-12', attrs: 'minlength="15" maxlength="255"', placeholder: 'Mínimo de 15 caracteres. Ex.: Valor lançado incorretamente.' }
      ],
      onSubmit: async (d) => {
        try { await chamarFuncao('cancelarNotaFiscal', { documentoId: n.id, motivo: d.motivo, ...(servico ? { codigo: Number(d.codigo) } : {}) }); }
        catch (e) { throw new Error(erroFuncao(e)); }
        toast('Cancelamento enviado. Aguardando confirmação…', 'info');
        await recarregar();
        acompanhar(n.id);
      }
    });
  }

  // link gerado pelo backend, que confere se o usuário é da clínica
  async function abrirArquivo(n, fmt, btn) {
    const janela = window.open('', '_blank'); // abre já no clique para o navegador não bloquear
    ocupado(btn, true);
    try {
      const { url } = await chamarFuncao('linkArquivoNotaFiscal', { documentoId: n.id, formato: fmt });
      if (janela) janela.location.href = url; else location.href = url;
      if (!n[`${fmt}Path`]) recarregar();
    } catch (e) {
      janela?.close();
      toast(erroFuncao(e), 'warning');
    } finally { ocupado(btn, false); }
  }

  const reciboDe = (n) => previsualizar(D.recibo({
    clinica: state.clinica, nota: n,
    tomador: C[n.clienteId] ? { nome: C[n.clienteId].nome, cpf: C[n.clienteId].cpf } : { nome: n.tomadorNome, cpf: n.tomadorCpf },
    emissor: { nome: state.clinica.responsavel || state.perfil.nome, crmv: state.clinica.responsavelCrmv || state.perfil.crmv },
    data: n.dataEmissao
  }), 'Recibo · sem valor fiscal');

  // ================= Formulário =================
  function abrirForm(nota = {}) {
    if (!exigirLicenca()) return;
    const modoIni = nota.id ? (nota.integracao ? 'integracao' : 'manual') : (integrada ? 'integracao' : 'manual');
    let itensNota = (nota.itens || []).map(i => ({ ...i }));
    const P = Object.fromEntries(produtos.map(p => [p.id, p]));

    const editorItens = `
      <div data-produto>
        <label class="form-label">Produtos da nota</label>
        <div class="row g-2 align-items-end mb-2">
          <div class="col-md-6"><select class="form-select" id="itProduto" data-busca-select data-placeholder="Buscar produto..."><option value=""></option>
            ${produtos.map(p => `<option value="${p.id}" data-busca="${esc([p.codigo, p.categoria].filter(Boolean).join(' '))}">${esc(p.nome)} — ${money(p.precoVenda)}${ncmOk(p) ? '' : ' · sem NCM'}</option>`).join('')}</select></div>
          <div class="col-4 col-md-2"><input type="number" class="form-control" id="itQtd" value="1" min="0.001" step="any" aria-label="Quantidade"></div>
          <div class="col-5 col-md-2"><input type="number" class="form-control" id="itPreco" min="0.01" step="0.01" placeholder="Preço" aria-label="Preço unitário"></div>
          <div class="col-3 col-md-2"><button type="button" class="btn btn-soft w-100" id="itAdd" title="Adicionar"><i class="bi bi-plus-lg"></i></button></div>
        </div>
        <div id="itLista"></div>
      </div>`;

    formModal({
      title: nota.id ? 'Editar nota' : 'Nova nota', size: 'lg',
      values: { tipo: 'nfse', status: 'rascunho', dataEmissao: today(), serie: '1', modo: modoIni, pagamento: 'PIX', ...nota },
      fields: [
        { name: 'modo', label: 'Como esta nota será gerada?', type: 'select', required: true, col: 'col-12', attrs: nota.id ? 'disabled' : '', options: [
          { value: 'integracao', label: integrada ? `Emitir pelo Petzy (TecnoSpeed${teste ? ' · modo teste, sem valor fiscal' : ''})` : 'Emitir pelo Petzy (configure a TecnoSpeed primeiro)' },
          { value: 'manual', label: 'Registrar nota emitida fora do Petzy (site da prefeitura, outro sistema)' }
        ] },
        { name: 'tipo', label: 'Tipo de documento', type: 'select', required: true, options: TIPOS, col: 'col-md-4', attrs: nota.id && nota.integracao ? 'disabled' : '' },
        { name: 'dataEmissao', label: 'Data / competência', type: 'date', required: true, col: 'col-md-4' },
        { name: 'status', label: 'Status', type: 'select', required: true, options: STATUS_MANUAL.map(v => ({ value: v, label: STATUS[v].l })), col: 'col-md-4', attrs: 'data-manual' },
        { name: 'clienteId', label: 'Tutor / tomador', type: 'select', search: true, col: 'col-md-6',
          options: clientes.map(c => ({ value: c.id, label: c.nome, busca: [c.cpf, c.telefone].filter(Boolean).join(' ') })) },
        { name: 'tomadorNome', label: 'Nome (se não cadastrado)', col: 'col-md-3' },
        { name: 'tomadorCpf', label: 'CPF/CNPJ', col: 'col-md-3' },
        { type: 'custom', col: 'col-12', html: editorItens },
        { name: 'pagamento', label: 'Forma de pagamento', type: 'select', options: PAGAMENTOS, col: 'col-md-4', attrs: 'data-produto' },
        { name: 'desconto', label: 'Desconto', type: 'money', col: 'col-md-4', attrs: 'data-produto' },
        { name: 'descricao', label: 'Discriminação dos serviços / descrição', type: 'textarea', rows: 3, col: 'col-md-8', attrs: 'data-descricao maxlength="2000"', placeholder: 'Ex.: Consulta clínica veterinária e aplicação de vacina V10 no paciente Thor.' },
        { name: 'valor', label: 'Valor total', type: 'money', col: 'col-md-4', attrs: 'min="0.01"' },
        { type: 'custom', col: 'col-12', html: '<h6 class="fw-bold text-primary mt-2 mb-0" data-manual>Dados da nota emitida fora do Petzy</h6>' },
        { name: 'numero', label: 'Número', col: 'col-md-4', attrs: 'data-manual' },
        { name: 'serie', label: 'Série', col: 'col-md-4', attrs: 'data-manual' },
        { name: 'chave', label: 'Chave de acesso / protocolo', col: 'col-md-4', attrs: 'data-manual' },
        { name: 'xmlUrl', label: 'Link do XML', type: 'url', col: 'col-md-6', attrs: 'data-manual' },
        { name: 'pdfUrl', label: 'Link do PDF', type: 'url', col: 'col-md-6', attrs: 'data-manual' },
        { name: 'observacoes', label: 'Observações internas', type: 'textarea', rows: 2, col: 'col-12' }
      ],
      onShown: (el) => {
        const f = $('form', el);
        if (!integrada) f.modo.querySelector('option[value=integracao]').disabled = true;
        const colDe = (x) => x.closest('[class*="col-"]');

        function desenharItens() {
          $('#itLista', el).innerHTML = itensNota.length ? `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
            <thead><tr><th>Produto</th><th class="text-end">Qtd</th><th class="text-end">Preço</th><th class="text-end">Total</th><th></th></tr></thead><tbody>
            ${itensNota.map((i, k) => `<tr>
              <td class="fs-7">${esc(i.nome)} ${ncmOk(i) ? `<span class="text-muted fs-8">NCM ${esc(fmtNcm(i.ncm))}</span>` : badge('sem NCM', 'warning')}</td>
              <td class="text-end fs-7">${num(i.qtd, i.qtd % 1 ? 3 : 0)}</td><td class="text-end fs-7">${money(i.preco)}</td>
              <td class="text-end fs-7 fw-semibold">${money(i.qtd * i.preco)}</td>
              <td class="text-end"><button type="button" class="btn-close" style="font-size:.6rem" data-rm-item="${k}" aria-label="Remover"></button></td></tr>`).join('')}
            </tbody></table></div>`
            : '<div class="text-muted fs-7 border rounded-3 p-3 text-center">Nenhum produto adicionado.</div>';
          recalcular();
        }
        function recalcular() {
          const integProduto = f.modo.value === 'integracao' && f.tipo.value !== 'nfse';
          if (!integProduto) return;
          const bruto = itensNota.reduce((s, i) => s + i.qtd * i.preco, 0);
          f.valor.value = itensNota.length ? Math.max(0, r2(bruto - (Number(f.desconto.value) || 0))).toFixed(2) : '';
        }
        function alternar() {
          const manual = f.modo.value === 'manual';
          const produto = f.tipo.value !== 'nfse';
          el.querySelectorAll('[data-manual]').forEach(x => colDe(x).classList.toggle('d-none', !manual));
          el.querySelectorAll('[data-produto]').forEach(x => colDe(x).classList.toggle('d-none', manual || !produto));
          colDe(f.descricao).classList.toggle('d-none', !manual && produto);
          f.valor.readOnly = !manual && produto;
          recalcular();
        }

        f.modo.addEventListener('change', alternar);
        f.tipo.addEventListener('change', alternar);
        f.desconto.addEventListener('input', recalcular);
        f.clienteId.addEventListener('change', () => {
          const c = C[f.clienteId.value];
          if (c) { f.tomadorNome.value = ''; f.tomadorCpf.value = c.cpf || ''; }
        });
        $('#itProduto', el).addEventListener('change', (e) => { const p = P[e.target.value]; if (p) $('#itPreco', el).value = p.precoVenda || ''; });
        $('#itAdd', el).onclick = () => {
          const p = P[$('#itProduto', el).value];
          const qtd = Number($('#itQtd', el).value), preco = r2($('#itPreco', el).value);
          if (!p) return toast('Escolha um produto.', 'warning');
          if (!(qtd > 0) || !(preco > 0)) return toast('Informe quantidade e preço maiores que zero.', 'warning');
          const existente = itensNota.find(i => i.produtoId === p.id && i.preco === preco);
          if (existente) existente.qtd = r2(existente.qtd + qtd);
          else itensNota.push({ produtoId: p.id, nome: p.nome, codigo: p.codigo || '', qtd, preco, unidade: p.unidade || 'un',
            ncm: p.ncm || '', cfop: p.cfop || '', cest: p.cest || '', origem: p.origem ?? '0', icmsSituacao: p.icmsSituacao || '' });
          $('#itQtd', el).value = 1;
          desenharItens();
        };
        $('#itLista', el).onclick = (e) => { const b = e.target.closest('[data-rm-item]'); if (b) { itensNota.splice(Number(b.dataset.rmItem), 1); desenharItens(); } };
        desenharItens();
        alternar();
      },
      onSubmit: async (d) => {
        const integ = nota.id ? nota.integracao === true : d.modo === 'integracao';
        delete d.modo;
        const produto = d.tipo !== 'nfse';
        if (integ) {
          ['numero', 'serie', 'chave', 'xmlUrl', 'pdfUrl'].forEach(k => delete d[k]);
          if (!d.clienteId && !d.tomadorNome && d.tipo !== 'nfce') throw new Error('Informe o tomador: escolha um tutor cadastrado ou digite o nome.');
          if (produto) {
            if (!itensNota.length) throw new Error('Adicione ao menos um produto.');
            const sem = itensNota.filter(i => !ncmOk(i));
            if (sem.length) throw new Error(`Informe o NCM em Produtos & Serviços: ${sem.map(i => i.nome).join(', ')}.`);
            const bruto = r2(itensNota.reduce((s, i) => s + i.qtd * i.preco, 0));
            d.desconto = r2(d.desconto);
            if (d.desconto < 0 || d.desconto >= bruto) throw new Error('O desconto deve ser menor que o total dos produtos.');
            if (d.tipo === 'nfe') {
              const c = C[d.clienteId];
              if (!c) throw new Error('Para NF-e, escolha um tutor cadastrado (o endereço completo é obrigatório).');
              if (!(c.ibge && c.cep && c.endereco)) throw new Error(`Complete o endereço de ${c.nome} (CEP, rua e número) no cadastro de tutores para emitir NF-e.`);
              if (![11, 14].includes(soDig(d.tomadorCpf || c.cpf).length)) throw new Error('Informe o CPF ou CNPJ do destinatário.');
            }
            d.itens = itensNota;
            d.valor = r2(bruto - d.desconto);
            d.descricao = d.descricao || `Venda de ${itensNota.length} produto(s)`;
          } else {
            delete d.pagamento; delete d.desconto;
            if (String(d.descricao || '').trim().length < 3) throw new Error('Descreva os serviços prestados.');
            if (!(Number(d.valor) > 0)) throw new Error('Informe um valor maior que zero.');
          }
          Object.assign(d, { integracao: true, status: nota.id ? nota.status : 'rascunho' });
        } else {
          delete d.pagamento; delete d.desconto;
          if (String(d.descricao || '').trim().length < 3) throw new Error('Informe a descrição da nota.');
          if (!(Number(d.valor) > 0)) throw new Error('Informe um valor maior que zero.');
          d.integracao = false;
          d.emitidaEm = d.status === 'emitida' ? (nota.emitidaEm || new Date().toISOString()) : null;
        }
        await save('fiscal', nota.id, d);
        toast(integ ? `Rascunho salvo. Clique em "Emitir" para enviar a ${NOMES[d.tipo]}.` : 'Nota registrada');
        await recarregar();
      }
    });
  }

  $('#btnNova', view).onclick = () => abrirForm();
  $('#fTipo', view).onchange = desenhar;
  $('#fStatus', view).onchange = desenhar;
  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#limpar', view).onclick = () => { $('#fTipo', view).value = ''; $('#fStatus', view).value = ''; $('#busca', view).value = ''; desenhar(); };
  $('#btnCsv', view).onclick = () => exportCSV('documentos-fiscais.csv', notas.map(n => ({
    Tipo: NOMES[n.tipo] || n.tipo, Status: STATUS[n.status]?.l || n.status, Data: n.dataEmissao, Numero: n.numero, Serie: n.serie, Chave: n.chave || '',
    Tomador: tomadorDe(n), Descricao: n.descricao, Valor: String(n.valor ?? '').replace('.', ','), Origem: n.integracao ? 'TecnoSpeed' : 'Manual', SemValorFiscal: n.semValorFiscal ? 'Sim' : ''
  })));

  tbody.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.dataset.emitir || b.dataset.consultar || b.dataset.id || b.dataset.edit || b.dataset.del || b.dataset.cancelar || b.dataset.recibo;
    const n = notas.find(x => x.id === id); if (!n) return;
    if (b.dataset.emitir) return emitir(n, b);
    if (b.dataset.consultar) return consultar(n, b);
    if (b.dataset.arq) return abrirArquivo(n, b.dataset.arq, b);
    if (b.dataset.recibo) return reciboDe(n);
    if (b.dataset.edit) return abrirForm(n);
    if (b.dataset.cancelar) return cancelar(n);
    if (b.dataset.del && exigirLicenca() && await confirmar(`Excluir a nota <strong>${esc(n.numero || n.descricao)}</strong>?`)) {
      try { await remove('fiscal', n.id); toast('Nota excluída'); }
      catch (err) { toast(err.code === 'permission-denied' ? 'Notas transmitidas não podem ser excluídas.' : err.message, 'danger'); }
      await recarregar();
    }
  };

  desenhar();
  // notas que ficaram em processamento: atualiza em segundo plano ao abrir a tela
  notas.filter(n => n.integracao && EM_ANDAMENTO.includes(n.status) && n.status !== 'enviando').slice(0, 5).forEach(n => acompanhar(n.id));
}

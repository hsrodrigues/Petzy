import { list, save, remove, loadTutoresPets } from '../store.js';
import { $, esc, pageHeader, empty, formModal, confirmar, toast, money, fmtDate, today, badge, exportCSV, norm, debounce } from '../ui.js';
import { exigirLicenca } from '../app.js';

const TIPOS = [
  { value: 'nfse', label: 'NFS-e · Serviço' },
  { value: 'nfe', label: 'NF-e · Produto' },
  { value: 'nfce', label: 'NFC-e · Consumidor' }
];
const STATUS = [
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'pendente', label: 'Pendente de emissão' },
  { value: 'emitida', label: 'Emitida' },
  { value: 'cancelada', label: 'Cancelada' }
];
const statusCor = { rascunho: 'secondary', pendente: 'warning', emitida: 'success', cancelada: 'danger' };

export async function render(view) {
  let notas = await list('fiscal');
  const { clientes: clientes } = await loadTutoresPets();
  const C = Object.fromEntries(clientes.map(c => [c.id, c]));

  view.innerHTML = `
    ${pageHeader('Fiscal', 'Controle de NF-e, NFC-e e NFS-e da clínica',
      `<button class="btn btn-light border" id="btnCsv"><i class="bi bi-download me-1"></i>Exportar</button>
       <button class="btn btn-primary" id="btnNova"><i class="bi bi-plus-lg me-1"></i>Nova nota</button>`)}
    <div class="alert alert-info d-flex gap-2 align-items-start mb-3"><i class="bi bi-info-circle mt-1"></i><div><strong>Emissão fiscal:</strong> este módulo organiza os documentos e está pronto para integração com SEFAZ, prefeitura ou provedor fiscal. A emissão válida depende do certificado e da autorização do órgão competente.</div></div>
    <div class="card">
      <div class="card-header d-flex gap-2 flex-wrap align-items-center">
        <select class="form-select w-auto" id="fTipo"><option value="">Todos os tipos</option>${TIPOS.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}</select>
        <select class="form-select w-auto" id="fStatus"><option value="">Todos os status</option>${STATUS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}</select>
        <input class="form-control" style="max-width:280px" id="busca" placeholder="Número, cliente ou descrição...">
        <button class="btn btn-light border" id="limpar"><i class="bi bi-x-circle me-1"></i>Limpar</button>
      </div>
      <div class="table-responsive"><table class="table table-hover"><thead><tr><th>Emissão</th><th>Tipo</th><th>Número / série</th><th>Tomador</th><th>Status</th><th class="text-end">Valor</th><th class="text-end">Ações</th></tr></thead><tbody id="tbody"></tbody></table></div>
    </div>`;

  const desenhar = () => {
    const tipo = $('#fTipo', view).value, status = $('#fStatus', view).value, q = norm($('#busca', view).value);
    const rows = notas.filter(n => (!tipo || n.tipo === tipo) && (!status || n.status === status) && (!q || norm([n.numero, n.serie, n.descricao, C[n.clienteId]?.nome].join(' ')).includes(q)))
      .sort((a, b) => (b.dataEmissao || '').localeCompare(a.dataEmissao || ''));
    $('#tbody', view).innerHTML = rows.length ? rows.map(n => `<tr>
      <td class="fs-7">${fmtDate(n.dataEmissao)}</td><td class="fs-7">${esc(TIPOS.find(t => t.value === n.tipo)?.label || n.tipo)}</td>
      <td><div class="fw-semibold">${esc(n.numero || 'Sem número')}</div><div class="text-muted fs-8">Série ${esc(n.serie || '1')}</div></td>
      <td class="fs-7">${esc(C[n.clienteId]?.nome || n.tomadorNome || 'Consumidor final')}</td>
      <td>${badge(STATUS.find(s => s.value === n.status)?.label || n.status, statusCor[n.status] || 'secondary')}</td>
      <td class="text-end fw-semibold">${money(n.valor)}</td>
      <td class="text-end text-nowrap"><button class="btn btn-icon btn-light" title="Editar" data-edit="${n.id}"><i class="bi bi-pencil"></i></button><button class="btn btn-icon btn-light" title="Excluir" data-del="${n.id}"><i class="bi bi-trash text-danger"></i></button></td>
    </tr>`).join('') : `<tr><td colspan="7">${empty('receipt-cutoff', 'Nenhum documento fiscal cadastrado.')}</td></tr>`;
  };

  const abrirForm = (nota = {}) => {
    if (!exigirLicenca()) return;
    formModal({
      title: nota.id ? 'Editar documento fiscal' : 'Novo documento fiscal', size: 'lg', values: { tipo: 'nfse', status: 'rascunho', dataEmissao: today(), serie: '1', ...nota },
      fields: [
        { name: 'tipo', label: 'Tipo de documento', type: 'select', required: true, options: TIPOS, col: 'col-md-4' },
        { name: 'status', label: 'Status', type: 'select', required: true, options: STATUS, col: 'col-md-4' },
        { name: 'dataEmissao', label: 'Data', type: 'date', required: true, col: 'col-md-4' },
        { name: 'numero', label: 'Número', col: 'col-md-4' },
        { name: 'serie', label: 'Série', col: 'col-md-4' },
        { name: 'chave', label: 'Chave de acesso / protocolo', col: 'col-md-4' },
        { name: 'clienteId', label: 'Cliente / tomador', type: 'select', options: clientes.map(c => ({ value: c.id, label: c.nome })), col: 'col-md-6' },
        { name: 'tomadorNome', label: 'Nome do tomador (se não cadastrado)', col: 'col-md-6' },
        { name: 'descricao', label: 'Descrição dos serviços/produtos', required: true, col: 'col-md-8' },
        { name: 'valor', label: 'Valor total', type: 'money', required: true, col: 'col-md-4' },
        { name: 'xmlUrl', label: 'URL do XML', type: 'url', col: 'col-md-6' },
        { name: 'pdfUrl', label: 'URL do DANFE / PDF', type: 'url', col: 'col-md-6' },
        { name: 'observacoes', label: 'Observações fiscais', type: 'textarea', rows: 2, col: 'col-12' }
      ],
      onSubmit: async (d) => { d.valor = Number(d.valor) || 0; d.emitidaEm = d.status === 'emitida' ? (nota.emitidaEm || new Date().toISOString()) : null; await save('fiscal', nota.id, d); toast('Documento fiscal salvo'); notas = await list('fiscal'); desenhar(); }
    });
  };

  $('#btnNova', view).onclick = () => abrirForm();
  $('#fTipo', view).onchange = desenhar; $('#fStatus', view).onchange = desenhar;
  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#limpar', view).onclick = () => { $('#fTipo', view).value = ''; $('#fStatus', view).value = ''; $('#busca', view).value = ''; desenhar(); };
  $('#btnCsv', view).onclick = () => exportCSV('documentos-fiscais.csv', notas.map(n => ({ Tipo: n.tipo, Status: n.status, Data: n.dataEmissao, Numero: n.numero, Serie: n.serie, Tomador: C[n.clienteId]?.nome || n.tomadorNome, Descricao: n.descricao, Valor: n.valor, Chave: n.chave })));
  $('#tbody', view).onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const n = notas.find(x => x.id === (b.dataset.edit || b.dataset.del));
    if (b.dataset.edit) abrirForm(n);
    if (b.dataset.del && await confirmar(`Excluir o documento <strong>${esc(n.numero || n.descricao)}</strong>?`)) { await remove('fiscal', n.id); toast('Documento excluído'); notas = await list('fiscal'); desenhar(); }
  };
  desenhar();
}

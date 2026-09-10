import { list, save, remove } from '../store.js';
import { $, esc, pageHeader, empty, formModal, confirmar, toast, norm, debounce, exportCSV } from '../ui.js';
import { exigirLicenca } from '../app.js';

export async function render(view) {
  let fornecedores = await list('fornecedores');

  view.innerHTML = `
    ${pageHeader('Fornecedores', 'Cadastro de parceiros e histórico de compras',
      `<button class="btn btn-light border" id="btnCsv"><i class="bi bi-download me-1"></i>Exportar</button>
       <button class="btn btn-primary" id="btnNovo"><i class="bi bi-plus-lg me-1"></i>Novo fornecedor</button>`)}
    <div class="card">
      <div class="card-header"><input class="form-control" style="max-width:360px" id="busca" placeholder="Buscar por nome, documento ou contato..."></div>
      <div class="table-responsive"><table class="table table-hover"><thead><tr><th>Fornecedor</th><th>Documento</th><th>Contato</th><th>Telefone</th><th class="text-end">Ações</th></tr></thead><tbody id="tbody"></tbody></table></div>
    </div>`;

  const desenhar = () => {
    const q = norm($('#busca', view).value);
    const rows = fornecedores.filter(f => !q || norm([f.nome, f.documento, f.contato, f.telefone, f.email].join(' ')).includes(q));
    $('#tbody', view).innerHTML = rows.length ? rows.map(f => `<tr>
      <td><div class="fw-semibold">${esc(f.nome)}</div>${f.email ? `<div class="text-muted fs-8">${esc(f.email)}</div>` : ''}</td>
      <td class="fs-7">${esc(f.documento || '—')}</td><td class="fs-7">${esc(f.contato || '—')}</td><td class="fs-7">${esc(f.telefone || '—')}</td>
      <td class="text-end text-nowrap"><button class="btn btn-icon btn-light" data-edit="${f.id}"><i class="bi bi-pencil"></i></button><button class="btn btn-icon btn-light" data-del="${f.id}"><i class="bi bi-trash text-danger"></i></button></td>
    </tr>`).join('') : `<tr><td colspan="5">${empty('truck', 'Nenhum fornecedor cadastrado.', '<button class="btn btn-soft btn-sm" data-vazio-novo>Cadastrar fornecedor</button>')}</td></tr>`;
  };

  const abrirForm = (fornecedor = {}) => {
    if (!exigirLicenca()) return;
    formModal({
      title: fornecedor.id ? 'Editar fornecedor' : 'Novo fornecedor', values: fornecedor,
      fields: [
        { name: 'nome', label: 'Razão social / nome', required: true, col: 'col-md-8' },
        { name: 'documento', label: 'CNPJ / CPF', col: 'col-md-4' },
        { name: 'contato', label: 'Pessoa de contato', col: 'col-md-6' },
        { name: 'telefone', label: 'Telefone / WhatsApp', col: 'col-md-6' },
        { name: 'email', label: 'E-mail', type: 'email', col: 'col-md-6' },
        { name: 'endereco', label: 'Endereço', col: 'col-md-6' },
        { name: 'observacoes', label: 'Observações', type: 'textarea', rows: 2, col: 'col-12' }
      ],
      onSubmit: async (d) => { await save('fornecedores', fornecedor.id, d); toast('Fornecedor salvo'); fornecedores = await list('fornecedores'); desenhar(); }
    });
  };

  $('#btnNovo', view).onclick = () => abrirForm();
  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#btnCsv', view).onclick = () => exportCSV('fornecedores.csv', fornecedores.map(f => ({ Nome: f.nome, Documento: f.documento, Contato: f.contato, Telefone: f.telefone, Email: f.email, Endereco: f.endereco })));
  $('#tbody', view).onclick = async (e) => {
    if (e.target.closest('[data-vazio-novo]')) return abrirForm();
    const b = e.target.closest('button'); if (!b) return;
    const fornecedor = fornecedores.find(f => f.id === (b.dataset.edit || b.dataset.del));
    if (b.dataset.edit) abrirForm(fornecedor);
    if (b.dataset.del && exigirLicenca() && await confirmar(`Excluir <strong>${esc(fornecedor.nome)}</strong>?`)) { await remove('fornecedores', fornecedor.id); toast('Fornecedor excluído'); fornecedores = await list('fornecedores'); desenhar(); }
  };

  desenhar();
}

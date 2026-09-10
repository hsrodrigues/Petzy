import { list, save, remove, loadTutoresPets } from '../store.js';
import { $, esc, pageHeader, empty, formModal, confirmar, toast, initials, debounce, norm, mask, exportCSV, fmtDate } from '../ui.js';
import { exigirLicenca } from '../app.js';

const CAMPOS = [
  { type: 'section', label: 'Dados do tutor' },
  { name: 'nome', label: 'Nome completo', required: true, col: 'col-md-8' },
  { name: 'cpf', label: 'CPF', col: 'col-md-4', placeholder: '000.000.000-00' },
  { name: 'telefone', label: 'WhatsApp / Telefone', required: true, col: 'col-md-4', placeholder: '(00) 00000-0000' },
  { name: 'email', label: 'E-mail', type: 'email', col: 'col-md-5' },
  { name: 'nascimento', label: 'Nascimento', type: 'date', col: 'col-md-3' },
  { type: 'section', label: 'Endereço' },
  { name: 'cep', label: 'CEP', col: 'col-md-3', placeholder: '00000-000' },
  { name: 'endereco', label: 'Endereço', col: 'col-md-6' },
  { name: 'numero', label: 'Número', col: 'col-md-3' },
  { name: 'bairro', label: 'Bairro', col: 'col-md-5' },
  { name: 'cidade', label: 'Cidade', col: 'col-md-5' },
  { name: 'uf', label: 'UF', col: 'col-md-2', attrs: 'maxlength="2"' },
  { name: 'obs', label: 'Observações', type: 'textarea', col: 'col-12', rows: 2 }
];

export function abrirFormCliente(cliente = {}, onSaved) {
  if (!exigirLicenca()) return;
  formModal({
    title: cliente.id ? 'Editar tutor' : 'Novo tutor',
    fields: CAMPOS,
    values: cliente,
    onShown: (el) => {
      const f = $('form', el);
      mask(f.cpf, 'cpf'); mask(f.telefone, 'tel'); mask(f.cep, 'cep');
      // autocompleta endereço pelo CEP (ViaCEP)
      f.cep.addEventListener('blur', async () => {
        const cep = f.cep.value.replace(/\D/g, '');
        if (cep.length !== 8) return;
        try {
          const r = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json();
          if (r.erro) return;
          f.endereco.value = r.logradouro || f.endereco.value;
          f.bairro.value = r.bairro || f.bairro.value;
          f.cidade.value = r.localidade || f.cidade.value;
          f.uf.value = r.uf || f.uf.value;
          f.numero.focus();
        } catch { /* sem internet: ignora */ }
      });
    },
    onSubmit: async (data) => {
      data.uf = (data.uf || '').toUpperCase();
      const id = await save('clientes', cliente.id, data);
      toast(cliente.id ? 'Tutor atualizado' : 'Tutor cadastrado');
      onSaved?.({ id, ...data });
    }
  });
}

export async function render(view, { params }) {
  let { clientes, pets } = await loadTutoresPets();
  const petsPor = (cid) => pets.filter(p => p.clienteId === cid);

  view.innerHTML = `
    ${pageHeader('Tutores', 'Cadastro de clientes e seus pets',
      `<button class="btn btn-light border" id="btnCsv"><i class="bi bi-download me-1"></i>Exportar</button>
       <button class="btn btn-primary" id="btnNovo"><i class="bi bi-plus-lg me-1"></i>Novo tutor</button>`)}
    <div class="card">
      <div class="card-header d-flex gap-2 align-items-center flex-wrap">
        <div class="position-relative flex-fill" style="max-width:360px">
          <i class="bi bi-search position-absolute text-muted" style="left:.8rem;top:50%;transform:translateY(-50%)"></i>
          <input class="form-control ps-5" id="busca" placeholder="Buscar por nome, telefone, CPF ou pet...">
        </div>
        <span class="text-muted fs-7 ms-auto" id="contador"></span>
      </div>
      <div class="table-responsive"><table class="table table-hover">
        <thead><tr><th>Tutor</th><th>Contato</th><th>Pets</th><th>Cidade</th><th class="text-end">Ações</th></tr></thead>
        <tbody id="tbody"></tbody>
      </table></div>
    </div>`;

  const busca = $('#busca', view);
  busca.value = params.get('q') || '';

  function desenhar() {
    const q = norm(busca.value);
    const rows = clientes.filter(c => !q || norm([c.nome, c.telefone, c.cpf, c.email, ...petsPor(c.id).map(p => p.nome)].join(' ')).includes(q));
    $('#contador', view).textContent = `${rows.length} de ${clientes.length} tutores`;
    $('#tbody', view).innerHTML = rows.length ? rows.map(c => {
      const ps = petsPor(c.id);
      const whats = (c.telefone || '').replace(/\D/g, '');
      return `<tr>
        <td><div class="d-flex align-items-center gap-2"><span class="avatar">${initials(c.nome)}</span>
          <div><div class="fw-semibold">${esc(c.nome)}</div><div class="text-muted fs-8">${esc(c.cpf || '')}</div></div></div></td>
        <td><div class="fs-7">${esc(c.telefone || '—')}</div><div class="text-muted fs-8">${esc(c.email || '')}</div></td>
        <td>${ps.length ? ps.map(p => `<a href="#/pets/${p.id}" class="badge badge-soft-primary text-decoration-none me-1">${esc(p.nome)}</a>`).join('') : '<span class="text-muted fs-7">—</span>'}</td>
        <td class="fs-7">${esc([c.cidade, c.uf].filter(Boolean).join(' / ') || '—')}</td>
        <td class="text-end text-nowrap">
          ${whats ? `<a class="btn btn-icon btn-light" title="WhatsApp" target="_blank" href="https://wa.me/55${whats}"><i class="bi bi-whatsapp text-success"></i></a>` : ''}
          <a class="btn btn-icon btn-light" title="Adicionar pet" href="#/pets?novo=${c.id}"><i class="bi bi-plus-circle"></i></a>
          <button class="btn btn-icon btn-light" title="Editar" data-edit="${c.id}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-icon btn-light" title="Excluir" data-del="${c.id}"><i class="bi bi-trash text-danger"></i></button>
        </td></tr>`;
    }).join('') : `<tr><td colspan="5">${empty('people', clientes.length ? 'Nenhum tutor encontrado.' : 'Cadastre seu primeiro tutor.')}</td></tr>`;
  }

  async function recarregar() { ({ clientes, pets } = await loadTutoresPets()); desenhar(); }

  busca.addEventListener('input', debounce(desenhar, 150));
  $('#btnNovo', view).onclick = () => abrirFormCliente({}, recarregar);
  $('#btnCsv', view).onclick = () => exportCSV('tutores.csv', clientes.map(c => ({
    Nome: c.nome, CPF: c.cpf, Telefone: c.telefone, Email: c.email, Cidade: c.cidade, UF: c.uf,
    Pets: petsPor(c.id).map(p => p.nome).join(', '), Cadastro: fmtDate(c.criadoEm?.slice(0, 10))
  })));

  $('#tbody', view).onclick = async (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) abrirFormCliente(clientes.find(c => c.id === ed.dataset.edit), recarregar);
    if (del) {
      if (!exigirLicenca()) return;
      const c = clientes.find(x => x.id === del.dataset.del);
      if (petsPor(c.id).length) return toast('Remova ou transfira os pets deste tutor antes de excluí-lo.', 'warning');
      if (await confirmar(`Excluir o tutor <strong>${esc(c.nome)}</strong>?`)) {
        await remove('clientes', c.id); toast('Tutor excluído'); recarregar();
      }
    }
  };

  desenhar();
}

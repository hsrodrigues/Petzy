import { list, save, remove, loadTutoresPets, where } from '../store.js';
import { $, esc, pageHeader, empty, formModal, modal, confirmar, toast, initials, debounce, norm, mask, exportCSV, fmtDate, addDays, toISODate } from '../ui.js';
import { exigirLicenca } from '../app.js';

const DIAS_INATIVO = 90; // sem nenhuma visita (venda, agendamento concluído ou atendimento) neste período

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
  { name: 'ibge', type: 'hidden', col: 'd-none' }, // código do município (exigido no endereço da NFS-e)
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
        f.ibge.value = '';
        try {
          const r = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json();
          if (r.erro) return;
          f.ibge.value = r.ibge || '';
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
       <button class="btn btn-light border" id="btnInativos"><i class="bi bi-arrow-repeat me-1"></i>Reativação</button>
       <button class="btn btn-primary" id="btnNovo"><i class="bi bi-plus-lg me-1"></i>Novo tutor</button>`)}
    <div class="card">
      <div class="card-header d-flex gap-2 align-items-center flex-wrap">
        <div class="position-relative flex-fill" style="max-width:360px">
          <i class="bi bi-search position-absolute text-muted" style="left:.8rem;top:50%;transform:translateY(-50%)"></i>
          <input class="form-control ps-5" id="busca" placeholder="Buscar por nome, telefone, CPF ou pet...">
        </div>
        <span class="text-muted fs-7 ms-auto" id="contador"></span>
          <button class="btn btn-light border" id="limparFiltros" title="Limpar filtros"><i class="bi bi-x-circle me-1"></i>Limpar</button>
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

  const telaAtiva = view.firstElementChild; // some quando o usuário navega para outra tela
  async function recarregar() { ({ clientes, pets } = await loadTutoresPets()); if (telaAtiva.isConnected) desenhar(); }

  // ---------- reativação de clientes inativos ----------
  // "Visita" = venda no PDV, agendamento concluído ou atendimento registrado. Sem nenhuma delas nos
  // últimos DIAS_INATIVO dias, o tutor entra na lista — ajuda a puxar de volta receita esquecida.
  async function abrirInativos() {
    const limite = toISODate(addDays(new Date(), -DIAS_INATIVO));
    const [vendas, ags, atend] = await Promise.all([
      list('vendas'), list('agendamentos', where('status', '==', 'concluido')), list('atendimentos')
    ]);
    const ultimaVisita = {};
    const marca = (clienteId, data) => { if (clienteId && data && (!ultimaVisita[clienteId] || data > ultimaVisita[clienteId])) ultimaVisita[clienteId] = data; };
    vendas.forEach(v => marca(v.clienteId, v.data));
    ags.forEach(a => marca(a.clienteId, a.inicio));
    atend.forEach(a => marca(a.clienteId, a.data));

    const inativos = clientes
      .filter(c => petsPor(c.id).length && (!ultimaVisita[c.id] || ultimaVisita[c.id] < limite))
      .map(c => ({ ...c, ultimaVisita: ultimaVisita[c.id] || null }))
      .sort((a, b) => (a.ultimaVisita || '').localeCompare(b.ultimaVisita || ''));

    const linha = (c) => {
      const whats = (c.telefone || '').replace(/\D/g, '');
      const msg = encodeURIComponent(`Olá ${c.nome?.split(' ')[0] || ''}! Faz um tempinho que a gente não vê o(a) ${petsPor(c.id).map(p => p.nome).join(' e ') || 'seu pet'} por aqui 🐾 Que tal agendar um check-up ou um banho? Responda essa mensagem que a gente já vê um horário pra você!`);
      return `<div class="list-group-item d-flex align-items-center gap-2 flex-wrap">
        <div class="flex-fill">
          <div class="fw-semibold fs-7">${esc(c.nome)}</div>
          <div class="fs-8 text-muted">${c.ultimaVisita ? `Última visita: ${fmtDate(c.ultimaVisita.slice(0, 10))}` : 'Nenhuma visita registrada'} · ${esc(petsPor(c.id).map(p => p.nome).join(', '))}</div>
        </div>
        ${whats ? `<a class="btn btn-sm btn-success" target="_blank" href="https://wa.me/55${whats}?text=${msg}"><i class="bi bi-whatsapp me-1"></i>Chamar no WhatsApp</a>` : '<span class="text-muted fs-8">Sem telefone</span>'}
      </div>`;
    };
    modal({
      title: `Clientes inativos há mais de ${DIAS_INATIVO} dias (${inativos.length})`, size: 'lg',
      body: inativos.length
        ? `<div class="list-group list-group-flush">${inativos.map(linha).join('')}</div>`
        : empty('emoji-smile', 'Nenhum tutor inativo — ótimo sinal! 🎉')
    });
  }

  busca.addEventListener('input', debounce(desenhar, 150));
  $('#limparFiltros', view).onclick = () => { busca.value = ''; desenhar(); };
  $('#btnInativos', view).onclick = async (e) => {
    const b = e.currentTarget, html = b.innerHTML;
    b.disabled = true; b.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Analisando...';
    try { await abrirInativos(); } catch (err) { toast(err.message, 'danger'); } finally { b.disabled = false; b.innerHTML = html; }
  };
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
  if (params.get('novo')) abrirFormCliente({}, recarregar);
}

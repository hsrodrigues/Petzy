import { state, list, save, remove, loadTutoresPets } from '../store.js';
import { $, esc, pageHeader, empty, formModal, confirmar, toast, fmtDate, today, toISODate, addDays, badge, kpi, norm, debounce } from '../ui.js';
import { exigirLicenca } from '../app.js';
import { petOptions, emoji } from './pets.js';

const VACINAS = ['V8 (Polivalente)', 'V10 (Polivalente)', 'Antirrábica', 'Gripe canina (Tosse dos canis)', 'Giárdia', 'Leishmaniose',
  'V3 Felina', 'V4 Felina', 'V5 Felina (FeLV)', 'Vermífugo', 'Antipulgas / Carrapaticida'];

// dias até o reforço padrão de cada vacina
const REFORCO = { 'Vermífugo': 90, 'Antipulgas / Carrapaticida': 30 };

export async function render(view, { params }) {
  let [dados, vacinas] = await Promise.all([loadTutoresPets(), list('vacinas')]);
  const { P, C } = dados;
  const hoje = today(), em30 = toISODate(addDays(new Date(), 30));
  let filtro = 'todas';

  view.innerHTML = `
    ${pageHeader('Vacinas & Vermífugos', 'Carteira de vacinação e lembretes de reforço',
      `<button class="btn btn-primary" id="btnNovo"><i class="bi bi-plus-lg me-1"></i>Registrar aplicação</button>`)}
    <div class="row g-3 mb-3" id="kpis"></div>
    <div class="card">
      <div class="card-header d-flex gap-2 flex-wrap align-items-center">
        <div class="btn-group" id="filtros">
          <button class="btn btn-light border active" data-f="todas">Todas</button>
          <button class="btn btn-light border" data-f="proximas">Próximos 30 dias</button>
          <button class="btn btn-light border" data-f="atrasadas">Atrasadas</button>
        </div>
        <input class="form-control ms-auto" style="max-width:280px" id="busca" placeholder="Buscar pet, tutor ou vacina...">
      </div>
      <div class="table-responsive"><table class="table table-hover">
        <thead><tr><th>Pet</th><th>Vacina</th><th>Aplicação</th><th>Próxima dose</th><th>Lote / fabricante</th><th class="text-end">Ações</th></tr></thead>
        <tbody id="tbody"></tbody>
      </table></div>
    </div>`;

  // só a dose mais recente de cada (pet, vacina) conta para "atrasada"
  const ultimas = () => {
    const m = {};
    vacinas.forEach(v => { const k = v.petId + '|' + v.nome; if (!m[k] || m[k].dataAplicacao < v.dataAplicacao) m[k] = v; });
    return new Set(Object.values(m).map(v => v.id));
  };

  function desenhar() {
    const ult = ultimas();
    const atrasadas = vacinas.filter(v => ult.has(v.id) && v.proximaDose && v.proximaDose < hoje);
    const proximas = vacinas.filter(v => ult.has(v.id) && v.proximaDose >= hoje && v.proximaDose <= em30);
    $('#kpis', view).innerHTML = `
      <div class="col-md-4">${kpi('shield-check', 'Aplicações registradas', vacinas.length, 'primary')}</div>
      <div class="col-md-4">${kpi('calendar-event', 'Reforços nos próximos 30 dias', proximas.length, 'warning')}</div>
      <div class="col-md-4">${kpi('exclamation-octagon', 'Reforços atrasados', atrasadas.length, 'danger')}</div>`;

    const q = norm($('#busca', view).value);
    let rows = filtro === 'proximas' ? proximas : filtro === 'atrasadas' ? atrasadas : vacinas;
    rows = rows.filter(v => !q || norm([P[v.petId]?.nome, C[P[v.petId]?.clienteId]?.nome, v.nome].join(' ')).includes(q))
      .sort((a, b) => filtro === 'todas' ? b.dataAplicacao.localeCompare(a.dataAplicacao) : (a.proximaDose || '').localeCompare(b.proximaDose || ''));

    $('#tbody', view).innerHTML = rows.length ? rows.map(v => {
      const p = P[v.petId] || {}, t = C[p.clienteId] || {};
      const whats = (t.telefone || '').replace(/\D/g, '');
      const msg = encodeURIComponent(`Olá ${t.nome?.split(' ')[0] || ''}! Aqui é da ${state.clinica.nome} 🐾 O reforço da vacina ${v.nome} do(a) ${p.nome} ${v.proximaDose < hoje ? 'está atrasado' : 'vence em ' + fmtDate(v.proximaDose)}. Vamos agendar?`);
      const cor = !v.proximaDose ? 'secondary' : v.proximaDose < hoje ? 'danger' : v.proximaDose <= em30 ? 'warning' : 'success';
      return `<tr>
        <td><a href="#/pets/${v.petId}" class="fw-semibold text-decoration-none">${emoji(p.especie)} ${esc(p.nome || '—')}</a><div class="text-muted fs-8">${esc(t.nome || '')}</div></td>
        <td class="fw-semibold fs-7">${esc(v.nome)}</td>
        <td class="fs-7">${fmtDate(v.dataAplicacao)}</td>
        <td>${v.proximaDose ? badge(fmtDate(v.proximaDose), cor) : '—'}</td>
        <td class="fs-8 text-muted">${esc([v.lote, v.fabricante].filter(Boolean).join(' · '))}</td>
        <td class="text-end text-nowrap">
          ${whats && v.proximaDose ? `<a class="btn btn-icon btn-light" title="Lembrar pelo WhatsApp" target="_blank" href="https://wa.me/55${whats}?text=${msg}"><i class="bi bi-whatsapp text-success"></i></a>` : ''}
          <button class="btn btn-icon btn-light" data-edit="${v.id}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-icon btn-light" data-del="${v.id}"><i class="bi bi-trash text-danger"></i></button>
        </td></tr>`;
    }).join('') : `<tr><td colspan="6">${empty('shield', 'Nada por aqui.')}</td></tr>`;
  }

  async function recarregar() { vacinas = await list('vacinas'); desenhar(); }

  function abrirForm(v = {}) {
    if (!exigirLicenca()) return;
    if (!dados.pets.length) return toast('Cadastre um pet primeiro.', 'warning');
    formModal({
      title: v.id ? 'Editar aplicação' : 'Registrar aplicação',
      values: { dataAplicacao: hoje, veterinario: state.perfil.nome, ...v },
      fields: [
        { name: 'petId', label: 'Pet', type: 'select', required: true, search: true, options: petOptions(dados.pets, C), col: 'col-12' },
        { name: 'nome', label: 'Vacina / medicamento', required: true, col: 'col-md-8', attrs: 'list="listaVac"' },
        { name: 'dose', label: 'Dose', type: 'select', options: ['1ª dose', '2ª dose', '3ª dose', 'Reforço anual', 'Dose única'], col: 'col-md-4' },
        { type: 'custom', col: 'd-none', html: `<datalist id="listaVac">${VACINAS.map(x => `<option value="${x}">`).join('')}</datalist>` },
        { name: 'dataAplicacao', label: 'Data da aplicação', type: 'date', required: true, col: 'col-md-6' },
        { name: 'proximaDose', label: 'Próxima dose', type: 'date', col: 'col-md-6' },
        { name: 'fabricante', label: 'Fabricante', col: 'col-md-4' },
        { name: 'lote', label: 'Lote', col: 'col-md-4' },
        { name: 'veterinario', label: 'Aplicado por', col: 'col-md-4' },
        { name: 'obs', label: 'Observações / reações', type: 'textarea', rows: 2, col: 'col-12' }
      ],
      onShown: (el) => {
        const f = $('form', el);
        // sugere a próxima dose automaticamente (reforço anual por padrão)
        const sugerir = () => {
          if (!f.dataAplicacao.value || (v.id && f.proximaDose.value)) return;
          const dias = REFORCO[f.nome.value] ?? (/1ª|2ª/.test(f.dose.value) ? 21 : 365);
          f.proximaDose.value = toISODate(addDays(new Date(f.dataAplicacao.value + 'T00:00'), dias));
        };
        f.nome.addEventListener('change', sugerir); f.dose.onchange = sugerir; f.dataAplicacao.onchange = sugerir;
      },
      onSubmit: async (d) => { await save('vacinas', v.id, d); toast('Aplicação registrada 💉'); await recarregar(); }
    });
  }

  $('#filtros', view).onclick = (e) => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    filtro = b.dataset.f;
    $('#filtros', view).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    desenhar();
  };
  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#btnNovo', view).onclick = () => abrirForm();
  $('#tbody', view).onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const v = vacinas.find(x => x.id === (b.dataset.edit || b.dataset.del));
    if (b.dataset.edit) abrirForm(v);
    if (b.dataset.del && exigirLicenca() && await confirmar('Excluir este registro de vacina?')) { await remove('vacinas', v.id); toast('Registro excluído'); recarregar(); }
  };

  desenhar();
  if (params.get('pet')) abrirForm({ petId: params.get('pet') });
}

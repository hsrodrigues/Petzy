import { state, list, save, remove, update, create, loadTutoresPets, where } from '../store.js';
import { $, esc, pageHeader, formModal, modal, confirmar, toast, money, fmtDateTime, fmtTime, toISODate, toISODateTime, addDays, badge } from '../ui.js';
import { exigirLicenca } from '../app.js';
import { petOptions, emoji } from './pets.js';

export const TIPOS = [
  { value: 'consulta', label: 'Consulta' }, { value: 'retorno', label: 'Retorno' }, { value: 'vacina', label: 'Vacina' },
  { value: 'exame', label: 'Exame' }, { value: 'cirurgia', label: 'Cirurgia' }, { value: 'banho', label: 'Banho' }, { value: 'tosa', label: 'Banho & Tosa' }
];
export const STATUS = {
  agendado: { l: 'Agendado', c: 'secondary' }, confirmado: { l: 'Confirmado', c: 'primary' },
  em_atendimento: { l: 'Em atendimento', c: 'warning' }, concluido: { l: 'Concluído', c: 'success' },
  cancelado: { l: 'Cancelado', c: 'danger' }, faltou: { l: 'Faltou', c: 'danger' }
};
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const inicioSemana = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; };

export async function render(view, { params }) {
  let semana = inicioSemana(params.get('d') ? new Date(params.get('d') + 'T00:00') : new Date());
  const cfg = state.clinica?.config || {};
  const H0 = cfg.horaInicio ?? 8, H1 = cfg.horaFim ?? 19;
  const [dados, equipe, servicos] = await Promise.all([loadTutoresPets(), list('equipe'), list('produtos', where('tipo', '==', 'servico'))]);
  const { P, C } = dados;
  const E = Object.fromEntries(equipe.map(e => [e.id, e]));
  let ags = [];

  view.innerHTML = `
    ${pageHeader('Agenda', 'Consultas, vacinas, banho & tosa e cirurgias · <i class="bi bi-arrows-move"></i> arraste um agendamento para remarcar',
      `<button class="btn btn-primary" id="btnNovo"><i class="bi bi-plus-lg me-1"></i>Novo agendamento</button>`)}
    <div class="card">
      <div class="card-header d-flex align-items-center gap-2 flex-wrap">
        <div class="btn-group">
          <button class="btn btn-light border" id="prev"><i class="bi bi-chevron-left"></i></button>
          <button class="btn btn-light border" id="hoje">Hoje</button>
          <button class="btn btn-light border" id="next"><i class="bi bi-chevron-right"></i></button>
        </div>
        <h5 class="mb-0 ms-2 fw-bold" id="titulo"></h5>
        <select class="form-select w-auto ms-auto" id="fProf"><option value="">Todos os profissionais</option>
          ${equipe.map(e => `<option value="${e.id}">${esc(e.nome)}</option>`).join('')}</select>
        <button class="btn btn-light border" id="limparFiltros" title="Limpar filtros"><i class="bi bi-x-circle me-1"></i>Limpar</button>
        <div class="d-none d-xl-flex gap-2 fs-8">
          ${TIPOS.map(t => `<span class="ag-event ${t.value} mb-0 py-1">${t.label}</span>`).join('')}
        </div>
      </div>
      <div class="agenda-wrap"><div class="agenda-grid" id="grid"></div></div>
    </div>`;

  async function carregar() {
    const ini = toISODate(semana), fim = toISODate(addDays(semana, 7));
    ags = await list('agendamentos', where('inicio', '>=', ini), where('inicio', '<', fim));
    desenhar();
  }

  function desenhar() {
    const prof = $('#fProf', view).value;
    const fimSem = addDays(semana, 6);
    $('#titulo', view).textContent = `${semana.getDate()} ${semana.toLocaleDateString('pt-BR', { month: 'short' })} – ${fimSem.getDate()} ${fimSem.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}`;
    const hojeISO = toISODate();
    let html = '<div class="ag-head"></div>';
    for (let d = 0; d < 7; d++) {
      const dia = addDays(semana, d);
      html += `<div class="ag-head ${toISODate(dia) === hojeISO ? 'today' : ''}">${DIAS[d]}<strong>${dia.getDate()}</strong></div>`;
    }
    for (let h = H0; h < H1; h++) {
      html += `<div class="ag-hour">${String(h).padStart(2, '0')}:00</div>`;
      for (let d = 0; d < 7; d++) {
        const diaISO = toISODate(addDays(semana, d));
        const slot = `${diaISO}T${String(h).padStart(2, '0')}`;
        const evs = ags.filter(a => a.inicio.startsWith(slot) && (!prof || a.profissionalId === prof)).sort((a, b) => a.inicio.localeCompare(b.inicio));
        html += `<div class="ag-cell" data-slot="${slot}:00">${evs.map(a => `
          <div class="ag-event ${a.tipo} ${a.status}" data-id="${a.id}" draggable="${a.status === 'concluido' ? 'false' : 'true'}" title="${esc(P[a.petId]?.nome || '')} - ${esc(a.tipo)}">
            <b>${fmtTime(a.inicio)} ${emoji(P[a.petId]?.especie)} ${esc(P[a.petId]?.nome || '—')}</b>
            <span class="opacity-75">${esc(C[a.clienteId]?.nome?.split(' ')[0] || '')} · ${esc(TIPOS.find(t => t.value === a.tipo)?.label || a.tipo)}</span>
          </div>`).join('')}</div>`;
      }
    }
    $('#grid', view).innerHTML = html;
  }

  function abrirForm(ag = {}) {
    if (!exigirLicenca()) return;
    if (!dados.pets.length) return toast('Cadastre um pet antes de agendar.', 'warning');
    formModal({
      title: ag.id ? 'Editar agendamento' : 'Novo agendamento', values: { status: 'agendado', duracao: 30, ...ag },
      fields: [
        { name: 'petId', label: 'Pet', type: 'select', required: true, search: true, options: petOptions(dados.pets, C), col: 'col-12' },
        { name: 'tipo', label: 'Tipo', type: 'select', required: true, options: TIPOS, col: 'col-md-6', default: 'consulta' },
        { name: 'servicoId', label: 'Serviço (preço)', type: 'select', options: servicos.map(s => ({ value: s.id, label: `${s.nome} — ${money(s.precoVenda)}` })), col: 'col-md-6' },
        { name: 'inicio', label: 'Data e hora', type: 'datetime-local', required: true, col: 'col-md-6' },
        { name: 'duracao', label: 'Duração', type: 'select', options: [15, 30, 45, 60, 90, 120, 180].map(m => ({ value: m, label: `${m} min` })), col: 'col-md-3' },
        { name: 'valor', label: 'Valor', type: 'money', col: 'col-md-3' },
        { name: 'profissionalId', label: 'Profissional', type: 'select', options: equipe.map(e => ({ value: e.id, label: e.nome })), col: 'col-md-6' },
        { name: 'status', label: 'Status', type: 'select', required: true, options: Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.l })), col: 'col-md-6' },
        { name: 'buscaLeva', label: 'Leva e traz (táxi dog)', type: 'checkbox', col: 'col-12' },
        { name: 'obs', label: 'Observações', type: 'textarea', rows: 2, col: 'col-12' }
      ],
      onShown: (el) => {
        const f = $('form', el);
        f.servicoId.onchange = () => { const s = servicos.find(x => x.id === f.servicoId.value); if (s) { f.valor.value = s.precoVenda; if (s.duracao) f.duracao.value = s.duracao; } };
      },
      onSubmit: async (d) => {
        // conflito de horário para o mesmo profissional
        const ini = new Date(d.inicio), fim = new Date(ini.getTime() + (d.duracao || 30) * 60000);
        const choque = d.profissionalId && ags.find(a => a.id !== ag.id && a.profissionalId === d.profissionalId && !['cancelado', 'faltou'].includes(a.status) &&
          new Date(a.inicio) < fim && new Date(new Date(a.inicio).getTime() + (a.duracao || 30) * 60000) > ini);
        if (choque && !(await confirmar(`${esc(E[d.profissionalId]?.nome)} já tem <strong>${esc(P[choque.petId]?.nome)}</strong> às ${fmtTime(choque.inicio)}. Agendar mesmo assim?`, { ok: 'Agendar', danger: false }))) throw new Error('Escolha outro horário');
        d.clienteId = P[d.petId]?.clienteId || null;
        d.duracao = Number(d.duracao) || 30;
        await save('agendamentos', ag.id, d);
        toast(ag.id ? 'Agendamento atualizado' : 'Agendamento criado 📅');
        await carregar();
      }
    });
  }

  function detalhes(ag) {
    const pet = P[ag.petId] || {}, tutor = C[ag.clienteId] || {};
    const whats = (tutor.telefone || '').replace(/\D/g, '');
    const msg = encodeURIComponent(`Olá ${tutor.nome?.split(' ')[0] || ''}! Confirmando ${TIPOS.find(t => t.value === ag.tipo)?.label.toLowerCase()} do(a) ${pet.nome} em ${fmtDateTime(ag.inicio)} na ${state.clinica.nome}. Podemos confirmar? 🐾`);
    const st = STATUS[ag.status] || STATUS.agendado;
    const { el, close } = modal({
      title: `${emoji(pet.especie)} ${esc(pet.nome || 'Pet')}`, size: 'md',
      body: `
        <div class="d-flex gap-2 mb-3">${badge(TIPOS.find(t => t.value === ag.tipo)?.label || ag.tipo, 'primary')} ${badge(st.l, st.c)} ${ag.faturado ? badge('faturado', 'success') : ''}</div>
        <dl class="row fs-7 mb-0">
          <dt class="col-4 text-muted fw-normal">Quando</dt><dd class="col-8">${fmtDateTime(ag.inicio)} · ${ag.duracao || 30} min</dd>
          <dt class="col-4 text-muted fw-normal">Tutor</dt><dd class="col-8">${esc(tutor.nome || '—')} <span class="text-muted">${esc(tutor.telefone || '')}</span></dd>
          <dt class="col-4 text-muted fw-normal">Profissional</dt><dd class="col-8">${esc(E[ag.profissionalId]?.nome || '—')}</dd>
          <dt class="col-4 text-muted fw-normal">Valor</dt><dd class="col-8 fw-semibold">${money(ag.valor)}</dd>
          ${ag.buscaLeva ? '<dt class="col-4 text-muted fw-normal">Leva e traz</dt><dd class="col-8">Sim 🚗</dd>' : ''}
          ${ag.obs ? `<dt class="col-4 text-muted fw-normal">Obs.</dt><dd class="col-8">${esc(ag.obs)}</dd>` : ''}
        </dl>
        <hr>
        <div class="fs-8 text-muted mb-2">ALTERAR STATUS</div>
        <div class="d-flex flex-wrap gap-2">${Object.entries(STATUS).map(([k, s]) =>
          `<button class="btn btn-sm ${k === ag.status ? `btn-${s.c}` : 'btn-light border'}" data-st="${k}">${s.l}</button>`).join('')}</div>`,
      footer: `
        ${whats ? `<a class="btn btn-light border me-auto" target="_blank" href="https://wa.me/55${whats}?text=${msg}"><i class="bi bi-whatsapp text-success me-1"></i>Confirmar</a>` : ''}
        ${['consulta', 'retorno', 'cirurgia', 'exame'].includes(ag.tipo) ? `<a class="btn btn-soft" href="#/prontuarios?pet=${ag.petId}" data-bs-dismiss="modal"><i class="bi bi-clipboard2-pulse me-1"></i>Prontuário</a>` : ''}
        <button class="btn btn-light border" data-del><i class="bi bi-trash text-danger"></i></button>
        <button class="btn btn-primary" data-edit><i class="bi bi-pencil me-1"></i>Editar</button>`
    });

    el.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => {
      if (!exigirLicenca()) return;
      const status = b.dataset.st;
      const patch = { status };
      // ao concluir, lança a receita no financeiro (uma única vez)
      if (status === 'concluido' && ag.valor > 0 && !ag.faturado) {
        await create('financeiro', {
          tipo: 'receita', categoria: ['banho', 'tosa'].includes(ag.tipo) ? 'Banho & Tosa' : 'Serviços clínicos',
          descricao: `${TIPOS.find(t => t.value === ag.tipo)?.label} - ${pet.nome || ''} (${tutor.nome || ''})`,
          valor: ag.valor, vencimento: toISODate(), pago: true, pagoEm: toISODate(), formaPagamento: 'A definir',
          origem: 'agendamento', origemId: ag.id, clienteId: ag.clienteId
        });
        patch.faturado = true;
        toast(`${money(ag.valor)} lançado no financeiro`);
      }
      await update('agendamentos', ag.id, patch);
      close(); carregar();
    });
    $('[data-edit]', el).onclick = () => { close(); abrirForm(ag); };
    $('[data-del]', el).onclick = async () => {
      if (!exigirLicenca()) return;
      close();
      if (await confirmar('Excluir este agendamento?')) { await remove('agendamentos', ag.id); toast('Agendamento excluído'); carregar(); }
    };
  }

  // ---------- arrastar e soltar para remarcar ----------
  let arrastado = null, timerSemana = null, acabouDeArrastar = false;

  async function mover(ag, slot) {
    const novo = slot.slice(0, 14) + ag.inicio.slice(14, 16); // mantém os minutos originais
    if (novo === ag.inicio) return;
    if (ag.status === 'concluido') return toast('Atendimentos concluídos não podem ser remarcados.', 'warning');
    if (!exigirLicenca()) return;
    const ini = new Date(novo), fim = new Date(ini.getTime() + (ag.duracao || 30) * 60000);
    const choque = ag.profissionalId && ags.find(x => x.id !== ag.id && x.profissionalId === ag.profissionalId && !['cancelado', 'faltou'].includes(x.status) &&
      new Date(x.inicio) < fim && new Date(new Date(x.inicio).getTime() + (x.duracao || 30) * 60000) > ini);
    if (choque && !(await confirmar(`${esc(E[ag.profissionalId]?.nome || 'O profissional')} já tem <strong>${esc(P[choque.petId]?.nome || '')}</strong> às ${fmtTime(choque.inicio)}. Remarcar mesmo assim?`, { ok: 'Remarcar', danger: false }))) return;
    const antigo = ag.inicio;
    ag.inicio = novo;
    if (!ags.includes(ag)) ags.push(ag);
    desenhar(); // atualização otimista
    try {
      await update('agendamentos', ag.id, { inicio: novo });
      toast(`${P[ag.petId]?.nome || 'Agendamento'} remarcado para ${fmtDateTime(novo)}`);
    } catch (e) {
      ag.inicio = antigo;
      toast(e.message, 'danger');
      await carregar();
    }
  }

  const grid = $('#grid', view);
  const limparDrag = () => grid.querySelectorAll('.drag-over, .arrastando').forEach(x => x.classList.remove('drag-over', 'arrastando'));
  grid.addEventListener('dragstart', (e) => {
    const ev = e.target.closest?.('[data-id]'); if (!ev) return;
    arrastado = ags.find(a => a.id === ev.dataset.id);
    e.dataTransfer.setData('text/plain', ev.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => ev.classList.add('arrastando'));
  });
  grid.addEventListener('dragend', () => {
    limparDrag();
    clearTimeout(timerSemana);
    timerSemana = null;
    acabouDeArrastar = true;
    setTimeout(() => { acabouDeArrastar = false; }, 0);
  });
  grid.addEventListener('dragover', (e) => {
    const cell = e.target.closest?.('[data-slot]'); if (!cell || !arrastado) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!cell.classList.contains('drag-over')) { grid.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over')); cell.classList.add('drag-over'); }
  });
  grid.addEventListener('drop', (e) => {
    const cell = e.target.closest?.('[data-slot]'); if (!cell || !arrastado) return;
    e.preventDefault();
    const ag = arrastado; arrastado = null;
    limparDrag();
    mover(ag, cell.dataset.slot);
  });
  // segurar o item sobre as setas troca de semana
  ['#prev', '#next'].forEach(s => {
    const b = $(s, view);
    b.addEventListener('dragover', (e) => {
      if (!arrastado) return;
      e.preventDefault();
      if (!timerSemana) timerSemana = setTimeout(() => { timerSemana = null; b.click(); }, 700);
    });
    b.addEventListener('dragleave', () => { clearTimeout(timerSemana); timerSemana = null; });
  });

  $('#grid', view).onclick = (e) => {
    if (acabouDeArrastar) return;
    const ev = e.target.closest('[data-id]');
    if (ev) return detalhes(ags.find(a => a.id === ev.dataset.id));
    const cell = e.target.closest('[data-slot]');
    if (cell) abrirForm({ inicio: cell.dataset.slot });
  };
  $('#prev', view).onclick = () => { semana = addDays(semana, -7); carregar(); };
  $('#next', view).onclick = () => { semana = addDays(semana, 7); carregar(); };
  $('#hoje', view).onclick = () => { semana = inicioSemana(new Date()); carregar(); };
  $('#fProf', view).onchange = desenhar;
  $('#limparFiltros', view).onclick = () => { $('#fProf', view).value = ''; desenhar(); };
  $('#btnNovo', view).onclick = () => { const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); abrirForm({ inicio: toISODateTime(d) }); };

  await carregar();
}

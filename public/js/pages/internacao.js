// ================= Internação / Hospitalização =================
// Controle de leitos, prescrição médica e evolução clínica para pacientes internados.
import { state, list, save, update, loadTutoresPets } from '../store.js';
import { $, esc, pageHeader, empty, formModal, modal, confirmar, toast, fmtDateTime, toISODateTime, agoraLocal, badge, kpi } from '../ui.js';
import { exigirLicenca } from '../app.js';
import { petOptions, emoji } from './pets.js';

const uid = () => Math.random().toString(36).slice(2, 10);

export async function render(view) {
  const [internacoes, dados, equipe] = await Promise.all([list('internacoes'), loadTutoresPets(), list('equipe')]);
  const { pets, C, P } = dados;
  const E = Object.fromEntries(equipe.map(e => [e.id, e]));

  view.innerHTML = `
    ${pageHeader('Internação', 'Leitos, prescrição e evolução clínica dos pacientes internados',
      `<button class="btn btn-primary" id="btnNovo"><i class="bi bi-plus-lg me-1"></i>Internar paciente</button>`)}
    <div class="row g-3 mb-3" id="kpis"></div>
    <div class="card mb-3">
      <div class="card-header">Internados agora</div>
      <div class="row g-3 p-3" id="ativos"></div>
    </div>
    <div class="card">
      <div class="card-header">Histórico de altas</div>
      <div class="table-responsive"><table class="table table-hover">
        <thead><tr><th>Paciente</th><th>Leito</th><th>Entrada</th><th>Alta</th><th class="text-end">Ações</th></tr></thead>
        <tbody id="tbHistorico"></tbody>
      </table></div>
    </div>`;

  let lista = internacoes;
  const telaAtiva = view.firstElementChild;
  async function recarregar() { lista = await list('internacoes'); if (telaAtiva.isConnected) desenhar(); }

  function desenhar() {
    const ativos = lista.filter(i => i.status !== 'alta').sort((a, b) => (a.leito || '').localeCompare(b.leito || ''));
    const historico = lista.filter(i => i.status === 'alta').sort((a, b) => (b.dataAlta || '').localeCompare(a.dataAlta || ''));

    const altasMes = historico.filter(i => i.dataAlta >= toISODateTime(new Date(Date.now() - 30 * 86400000))).length;
    $('#kpis', view).innerHTML = `
      <div class="col-6 col-lg-4">${kpi('hospital', 'Internados agora', ativos.length, 'primary')}</div>
      <div class="col-6 col-lg-4">${kpi('clipboard2-pulse', 'Altas nos últimos 30 dias', altasMes, 'success')}</div>`;

    $('#ativos', view).innerHTML = ativos.length ? ativos.map(i => {
      const pet = P[i.petId] || {}, tutor = C[i.clienteId] || {};
      const dias = Math.max(0, Math.floor((Date.now() - new Date(i.dataEntrada).getTime()) / 86400000));
      return `<div class="col-md-6 col-xl-4"><div class="card h-100 border" data-abrir="${i.id}" role="button">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div><div class="fw-bold">${emoji(pet.especie)} ${esc(pet.nome || 'Pet removido')}</div><div class="fs-8 text-muted">${esc(tutor.nome || '')}</div></div>
            ${badge(i.leito ? 'Leito ' + i.leito : 'sem leito', 'primary')}
          </div>
          <div class="fs-7 text-muted mb-2">${esc(i.motivo || '')}</div>
          <div class="d-flex justify-content-between fs-8 text-muted">
            <span><i class="bi bi-clock-history"></i> ${dias} dia${dias === 1 ? '' : 's'} internado</span>
            <span>${esc(E[i.veterinarioId]?.nome || '—')}</span>
          </div>
        </div></div></div>`;
    }).join('') : `<div class="col-12">${empty('hospital', 'Nenhum paciente internado no momento.')}</div>`;

    $('#tbHistorico', view).innerHTML = historico.length ? historico.slice(0, 100).map(i => {
      const pet = P[i.petId] || {};
      return `<tr>
        <td>${emoji(pet.especie)} ${esc(pet.nome || 'Pet removido')} <span class="text-muted fs-8">${esc(C[i.clienteId]?.nome || '')}</span></td>
        <td class="fs-7">${esc(i.leito || '—')}</td>
        <td class="fs-7">${fmtDateTime(i.dataEntrada)}</td>
        <td class="fs-7">${i.dataAlta ? fmtDateTime(i.dataAlta) : '—'}</td>
        <td class="text-end"><button class="btn btn-sm btn-light border" data-abrir="${i.id}">Ver</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="5">${empty('clock-history', 'Nenhuma alta registrada ainda.')}</td></tr>`;
  }

  function abrirNovo() {
    if (!exigirLicenca()) return;
    if (!pets.length) return toast('Cadastre um pet antes de internar.', 'warning');
    formModal({
      title: 'Internar paciente', values: { dataEntrada: toISODateTime() },
      fields: [
        { name: 'petId', label: 'Pet', type: 'select', required: true, search: true, options: petOptions(pets, C), col: 'col-12' },
        { name: 'leito', label: 'Leito / gaiola', col: 'col-md-4' },
        { name: 'veterinarioId', label: 'Veterinário responsável', type: 'select', options: equipe.map(e => ({ value: e.id, label: e.nome })), col: 'col-md-8' },
        { name: 'dataEntrada', label: 'Entrada', type: 'datetime-local', required: true, col: 'col-md-6' },
        { name: 'motivo', label: 'Motivo da internação', type: 'textarea', rows: 2, required: true, col: 'col-12' }
      ],
      onSubmit: async (d) => {
        d.clienteId = P[d.petId]?.clienteId || null;
        d.status = 'internado';
        d.prescricoes = []; d.evolucoes = [];
        await save('internacoes', null, d);
        toast('Paciente internado');
        await recarregar();
      }
    });
  }

  function abrirDetalhe(i) {
    const pet = P[i.petId] || {}, tutor = C[i.clienteId] || {};
    const alta = i.status === 'alta';
    const { el, close } = modal({
      title: `${emoji(pet.especie)} ${esc(pet.nome || 'Pet')} <span class="fs-7 text-muted fw-normal">· ${esc(tutor.nome || '')}</span>`, size: 'lg',
      body: `
        <div class="d-flex flex-wrap gap-2 mb-3">
          ${badge(i.leito ? 'Leito ' + i.leito : 'sem leito', 'primary')}
          ${alta ? badge('Alta em ' + fmtDateTime(i.dataAlta), 'success') : badge('Internado desde ' + fmtDateTime(i.dataEntrada), 'warning')}
          ${badge(esc(E[i.veterinarioId]?.nome || 'sem veterinário'), 'secondary')}
        </div>
        <p class="fs-7"><strong>Motivo:</strong> ${esc(i.motivo || '—')}</p>
        <ul class="nav nav-pills gap-1 mb-3" id="abasInt">
          <li class="nav-item"><button class="nav-link active" data-a="prescricao"><i class="bi bi-capsule me-1"></i>Prescrição</button></li>
          <li class="nav-item"><button class="nav-link" data-a="evolucao"><i class="bi bi-journal-medical me-1"></i>Evolução</button></li>
        </ul>
        <div id="painelPrescricao"></div>
        <div id="painelEvolucao" class="d-none"></div>`,
      footer: alta ? '' : '<button class="btn btn-outline-danger me-auto" id="btnAlta"><i class="bi bi-box-arrow-right me-1"></i>Dar alta</button>'
    });

    function desenharPrescricao() {
      const lista = i.prescricoes || [];
      $('#painelPrescricao', el).innerHTML = `
        ${lista.length ? `<div class="list-group list-group-flush mb-3">${lista.map(p => `
          <div class="list-group-item d-flex justify-content-between align-items-start">
            <div><div class="fw-semibold fs-7">${esc(p.medicamento)} <span class="text-muted fw-normal">${esc(p.dose || '')} ${esc(p.via ? '· ' + p.via : '')}</span></div>
            ${p.horarios ? `<div class="fs-8 text-muted">Horários: ${esc(p.horarios)}</div>` : ''}${p.obs ? `<div class="fs-8 text-muted">${esc(p.obs)}</div>` : ''}</div>
            ${alta ? '' : `<button class="btn btn-sm btn-light border" data-rm-presc="${p.id}"><i class="bi bi-trash text-danger"></i></button>`}
          </div>`).join('')}</div>` : `<p class="text-muted fs-7">Nenhum medicamento prescrito ainda.</p>`}
        ${alta ? '' : `<form id="formPresc" class="row g-2">
          <div class="col-md-4"><input class="form-control form-control-sm" name="medicamento" placeholder="Medicamento" required></div>
          <div class="col-md-3"><input class="form-control form-control-sm" name="dose" placeholder="Dose (ex.: 5mg/kg)"></div>
          <div class="col-md-2"><input class="form-control form-control-sm" name="via" placeholder="Via (IV, VO...)"></div>
          <div class="col-md-3"><input class="form-control form-control-sm" name="horarios" placeholder="Horários (ex.: 8h/16h/0h)"></div>
          <div class="col-12"><button class="btn btn-sm btn-soft w-100" type="submit"><i class="bi bi-plus-lg me-1"></i>Adicionar à prescrição</button></div>
        </form>`}`;
      $('#formPresc', el)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const item = { id: uid(), medicamento: f.medicamento.value.trim(), dose: f.dose.value.trim(), via: f.via.value.trim(), horarios: f.horarios.value.trim() };
        if (!item.medicamento) return;
        i.prescricoes = [...(i.prescricoes || []), item];
        await update('internacoes', i.id, { prescricoes: i.prescricoes });
        desenharPrescricao();
      });
      el.querySelectorAll('[data-rm-presc]').forEach(b => b.onclick = async () => {
        i.prescricoes = (i.prescricoes || []).filter(p => p.id !== b.dataset.rmPresc);
        await update('internacoes', i.id, { prescricoes: i.prescricoes });
        desenharPrescricao();
      });
    }

    function desenharEvolucao() {
      const lista = [...(i.evolucoes || [])].sort((a, b) => b.quando.localeCompare(a.quando));
      $('#painelEvolucao', el).innerHTML = `
        ${alta ? '' : `<form id="formEvo" class="mb-3">
          <textarea class="form-control form-control-sm mb-2" name="texto" rows="2" placeholder="Evolução clínica (estado geral, alimentação, resposta ao tratamento...)" required></textarea>
          <div class="row g-2 mb-2">
            <div class="col-3"><input class="form-control form-control-sm" name="temperatura" placeholder="Temp. °C"></div>
            <div class="col-3"><input class="form-control form-control-sm" name="fc" placeholder="FC bpm"></div>
            <div class="col-3"><input class="form-control form-control-sm" name="fr" placeholder="FR mpm"></div>
            <div class="col-3"><input class="form-control form-control-sm" name="peso" placeholder="Peso kg"></div>
          </div>
          <button class="btn btn-sm btn-soft w-100" type="submit"><i class="bi bi-plus-lg me-1"></i>Registrar evolução</button>
        </form>`}
        ${lista.length ? `<div class="list-group list-group-flush">${lista.map(v => `
          <div class="list-group-item">
            <div class="d-flex justify-content-between"><strong class="fs-7">${fmtDateTime(v.quando)}</strong><span class="fs-8 text-muted">${esc(v.autor || '')}</span></div>
            <div class="fs-7">${esc(v.texto)}</div>
            ${(v.temperatura || v.fc || v.fr || v.peso) ? `<div class="fs-8 text-muted mt-1">${[v.temperatura && 'Temp ' + v.temperatura + '°C', v.fc && 'FC ' + v.fc, v.fr && 'FR ' + v.fr, v.peso && 'Peso ' + v.peso + 'kg'].filter(Boolean).join(' · ')}</div>` : ''}
          </div>`).join('')}</div>` : '<p class="text-muted fs-7">Nenhuma evolução registrada ainda.</p>'}`;
      $('#formEvo', el)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const item = { id: uid(), quando: agoraLocal(), texto: f.texto.value.trim(), autor: state?.perfil?.nome || '', temperatura: f.temperatura.value.trim(), fc: f.fc.value.trim(), fr: f.fr.value.trim(), peso: f.peso.value.trim() };
        if (!item.texto) return;
        i.evolucoes = [...(i.evolucoes || []), item];
        await update('internacoes', i.id, { evolucoes: i.evolucoes });
        desenharEvolucao();
      });
    }

    $('#abasInt', el).onclick = (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      el.querySelectorAll('#abasInt .nav-link').forEach(x => x.classList.toggle('active', x === b));
      $('#painelPrescricao', el).classList.toggle('d-none', b.dataset.a !== 'prescricao');
      $('#painelEvolucao', el).classList.toggle('d-none', b.dataset.a !== 'evolucao');
    };
    $('#btnAlta', el)?.addEventListener('click', async () => {
      if (!exigirLicenca()) return;
      if (!(await confirmar(`Dar alta para <strong>${esc(pet.nome || 'o paciente')}</strong>?`))) return;
      await update('internacoes', i.id, { status: 'alta', dataAlta: agoraLocal() });
      toast('Alta registrada');
      close();
      recarregar();
    });

    desenharPrescricao(); desenharEvolucao();
  }

  $('#btnNovo', view).onclick = abrirNovo;
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-abrir]'); if (!b) return;
    abrirDetalhe(lista.find(i => i.id === b.dataset.abrir));
  });

  desenhar();
}

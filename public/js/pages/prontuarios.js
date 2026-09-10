import { state, list, save, remove, update, loadTutoresPets, orderBy, limit } from '../store.js';
import { $, esc, pageHeader, empty, formModal, modal, confirmar, toast, fmtDateTime, fmtDate, toISODateTime, norm, debounce, idade, badge } from '../ui.js';
import { exigirLicenca } from '../app.js';
import { petOptions, emoji } from './pets.js';

const TIPOS = ['Consulta', 'Retorno', 'Emergência', 'Cirurgia', 'Exame', 'Internação', 'Teleconsulta'];

export async function render(view, { params }) {
  let [dados, atend] = await Promise.all([loadTutoresPets(), list('atendimentos', orderBy('data', 'desc'), limit(200))]);
  const { P, C } = dados;

  view.innerHTML = `
    ${pageHeader('Prontuários', 'Atendimentos clínicos, anamnese e prescrições',
      `<button class="btn btn-primary" id="btnNovo"><i class="bi bi-clipboard2-plus me-1"></i>Novo atendimento</button>`)}
    <div class="card">
      <div class="card-header d-flex gap-2 flex-wrap align-items-center">
        <div class="position-relative flex-fill" style="max-width:360px">
          <i class="bi bi-search position-absolute text-muted" style="left:.8rem;top:50%;transform:translateY(-50%)"></i>
          <input class="form-control ps-5" id="busca" placeholder="Pet, tutor ou diagnóstico...">
        </div>
        <select class="form-select w-auto" id="fTipo"><option value="">Todos os tipos</option>${TIPOS.map(t => `<option>${t}</option>`).join('')}</select>
      </div>
      <div class="table-responsive"><table class="table table-hover">
        <thead><tr><th>Data</th><th>Paciente</th><th>Tipo</th><th>Diagnóstico</th><th>Veterinário</th><th class="text-end">Ações</th></tr></thead>
        <tbody id="tbody"></tbody>
      </table></div>
    </div>`;

  function desenhar() {
    const q = norm($('#busca', view).value), t = $('#fTipo', view).value;
    const rows = atend.filter(a => (!t || a.tipo === t) && (!q || norm([P[a.petId]?.nome, C[a.clienteId]?.nome, a.diagnostico, a.queixa].join(' ')).includes(q)));
    $('#tbody', view).innerHTML = rows.length ? rows.map(a => `
      <tr>
        <td class="text-nowrap fs-7">${fmtDateTime(a.data)}</td>
        <td><a href="#/pets/${a.petId}" class="fw-semibold text-decoration-none">${emoji(P[a.petId]?.especie)} ${esc(P[a.petId]?.nome || '—')}</a>
          <div class="text-muted fs-8">${esc(C[a.clienteId]?.nome || '')}</div></td>
        <td>${badge(a.tipo || 'Consulta', a.tipo === 'Emergência' ? 'danger' : 'primary')}</td>
        <td class="fs-7">${esc(a.diagnostico || '—')}</td>
        <td class="fs-7">${esc(a.vetNome || '')}</td>
        <td class="text-end text-nowrap">
          <button class="btn btn-icon btn-light" title="Ver / imprimir" data-ver="${a.id}"><i class="bi bi-eye"></i></button>
          <button class="btn btn-icon btn-light" title="Editar" data-edit="${a.id}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-icon btn-light" title="Excluir" data-del="${a.id}"><i class="bi bi-trash text-danger"></i></button>
        </td>
      </tr>`).join('') : `<tr><td colspan="6">${empty('clipboard2-pulse', 'Nenhum atendimento registrado.')}</td></tr>`;
  }

  async function recarregar() { atend = await list('atendimentos', orderBy('data', 'desc'), limit(200)); desenhar(); }

  function abrirForm(a = {}) {
    if (!exigirLicenca()) return;
    if (!dados.pets.length) return toast('Cadastre um pet primeiro.', 'warning');
    formModal({
      title: a.id ? 'Editar atendimento' : 'Novo atendimento', size: 'xl',
      values: { data: toISODateTime(), tipo: 'Consulta', ...a },
      fields: [
        { name: 'petId', label: 'Paciente', type: 'select', required: true, options: petOptions(dados.pets, C), col: 'col-md-6' },
        { name: 'tipo', label: 'Tipo', type: 'select', required: true, options: TIPOS, col: 'col-md-3' },
        { name: 'data', label: 'Data/hora', type: 'datetime-local', required: true, col: 'col-md-3' },
        { type: 'custom', col: 'col-12', html: '<div id="alertaPet"></div>' },
        { type: 'section', label: 'Sinais vitais' },
        { name: 'peso', label: 'Peso (kg)', type: 'number', step: '0.01', col: 'col-6 col-md-2' },
        { name: 'temperatura', label: 'Temp. (°C)', type: 'number', step: '0.1', col: 'col-6 col-md-2' },
        { name: 'fc', label: 'FC (bpm)', type: 'number', col: 'col-6 col-md-2' },
        { name: 'fr', label: 'FR (mpm)', type: 'number', col: 'col-6 col-md-2' },
        { name: 'mucosas', label: 'Mucosas', type: 'select', options: ['Normocoradas', 'Hipocoradas', 'Hiperêmicas', 'Ictéricas', 'Cianóticas'], col: 'col-6 col-md-2' },
        { name: 'hidratacao', label: 'Hidratação', type: 'select', options: ['Normal', 'Desidratação leve', 'Desidratação moderada', 'Desidratação grave'], col: 'col-6 col-md-2' },
        { type: 'section', label: 'Avaliação clínica' },
        { name: 'queixa', label: 'Queixa principal', col: 'col-12' },
        { name: 'anamnese', label: 'Anamnese', type: 'textarea', rows: 3, col: 'col-md-6' },
        { name: 'exameFisico', label: 'Exame físico', type: 'textarea', rows: 3, col: 'col-md-6' },
        { name: 'diagnostico', label: 'Diagnóstico / suspeita', col: 'col-md-8' },
        { name: 'retorno', label: 'Retorno em', type: 'date', col: 'col-md-4' },
        { type: 'section', label: 'Conduta' },
        { name: 'prescricao', label: 'Prescrição (receita)', type: 'textarea', rows: 4, col: 'col-md-6', placeholder: 'Medicamento - dose - via - frequência - duração' },
        { name: 'exames', label: 'Exames solicitados / procedimentos', type: 'textarea', rows: 4, col: 'col-md-6' }
      ],
      onShown: (el) => {
        const f = $('form', el);
        const alerta = () => {
          const p = P[f.petId.value];
          $('#alertaPet', el).innerHTML = p ? `<div class="d-flex gap-3 fs-7 text-muted bg-light rounded-3 p-2 px-3">
            <span>${esc([p.especie, p.raca, p.sexo].filter(Boolean).join(' · '))}</span><span>${idade(p.nascimento)}</span><span>Último peso: ${p.peso || '—'} kg</span>
            ${p.alergias ? `<span class="text-danger fw-semibold">⚠ ${esc(p.alergias)}</span>` : ''}</div>` : '';
        };
        f.petId.onchange = alerta; alerta();
      },
      onSubmit: async (d) => {
        d.clienteId = P[d.petId]?.clienteId || null;
        if (!a.id) { d.vetId = state.user.uid; d.vetNome = state.perfil.nome; }
        await save('atendimentos', a.id, d);
        if (d.peso) await update('pets', d.petId, { peso: d.peso }); // mantém o peso do pet atualizado
        toast('Atendimento salvo');
        await recarregar();
      }
    });
  }

  function ver(a) {
    const p = P[a.petId] || {}, t = C[a.clienteId] || {};
    const bloco = (tit, txt) => txt ? `<div class="mb-3"><div class="fs-8 text-muted text-uppercase fw-semibold">${tit}</div><div style="white-space:pre-line">${esc(txt)}</div></div>` : '';
    const { el } = modal({
      title: `${emoji(p.especie)} ${esc(p.nome || '')} · ${esc(a.tipo)}`, size: 'lg',
      body: `<div class="text-muted fs-7 mb-3">${fmtDateTime(a.data)} · ${esc(a.vetNome || '')} · Tutor: ${esc(t.nome || '')}</div>
        <div class="d-flex gap-2 flex-wrap mb-3">${[a.peso && `Peso ${a.peso} kg`, a.temperatura && `T ${a.temperatura} °C`, a.fc && `FC ${a.fc}`, a.fr && `FR ${a.fr}`, a.mucosas, a.hidratacao].filter(Boolean).map(x => badge(x, 'secondary')).join('')}</div>
        ${bloco('Queixa', a.queixa)}${bloco('Anamnese', a.anamnese)}${bloco('Exame físico', a.exameFisico)}
        ${bloco('Diagnóstico', a.diagnostico)}${bloco('Prescrição', a.prescricao)}${bloco('Exames / procedimentos', a.exames)}
        ${a.retorno ? `<div class="alert alert-info py-2 fs-7 mb-0">Retorno previsto: <strong>${fmtDate(a.retorno)}</strong></div>` : ''}`,
      footer: `<button class="btn btn-light border" data-print="receita" ${a.prescricao ? '' : 'disabled'}><i class="bi bi-printer me-1"></i>Imprimir receita</button>
               <button class="btn btn-primary" data-print="completo"><i class="bi bi-file-earmark-medical me-1"></i>Imprimir prontuário</button>`
    });
    el.querySelectorAll('[data-print]').forEach(b => b.onclick = () => imprimir(a, p, t, b.dataset.print));
  }

  function imprimir(a, p, t, modo) {
    const c = state.clinica;
    const w = window.open('', '_blank');
    const sec = (tit, txt) => txt ? `<h4>${tit}</h4><p>${esc(txt)}</p>` : '';
    w.document.write(`<html><head><title>${modo === 'receita' ? 'Receita' : 'Prontuário'} - ${esc(p.nome)}</title>
      <style>body{font-family:Arial,sans-serif;padding:40px;color:#222;max-width:800px;margin:auto}header{border-bottom:3px solid #6c5ce7;padding-bottom:12px;margin-bottom:20px}
      h1{margin:0;font-size:22px}h4{margin:18px 0 4px;color:#6c5ce7;font-size:13px;text-transform:uppercase}p{white-space:pre-line;margin:0}
      .info{display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:14px;background:#f6f6fb;padding:12px;border-radius:8px}
      .ass{margin-top:80px;text-align:center}.ass div{border-top:1px solid #333;width:300px;margin:auto;padding-top:6px}</style></head><body>
      <header><h1>${esc(c.nome)}</h1><small>${esc([c.endereco, c.telefone, c.cnpj && 'CNPJ ' + c.cnpj].filter(Boolean).join(' · '))}</small></header>
      <h2 style="font-size:18px">${modo === 'receita' ? 'Receituário' : 'Prontuário clínico'}</h2>
      <div class="info"><div><b>Paciente:</b> ${esc(p.nome)}</div><div><b>Espécie/Raça:</b> ${esc([p.especie, p.raca].filter(Boolean).join(' / '))}</div>
      <div><b>Tutor:</b> ${esc(t.nome || '')}</div><div><b>Data:</b> ${fmtDateTime(a.data)}</div>
      <div><b>Idade:</b> ${idade(p.nascimento)}</div><div><b>Peso:</b> ${a.peso || p.peso || '—'} kg</div></div>
      ${modo === 'receita' ? sec('Prescrição', a.prescricao) : sec('Queixa', a.queixa) + sec('Anamnese', a.anamnese) + sec('Exame físico', a.exameFisico) + sec('Diagnóstico', a.diagnostico) + sec('Prescrição', a.prescricao) + sec('Exames / procedimentos', a.exames)}
      <div class="ass"><div>${esc(a.vetNome || '')}<br><small>Médico(a) Veterinário(a)${state.perfil.crmv ? ' · CRMV ' + esc(state.perfil.crmv) : ''}</small></div></div>
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#fTipo', view).onchange = desenhar;
  $('#btnNovo', view).onclick = () => abrirForm();
  $('#tbody', view).onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const a = atend.find(x => x.id === (b.dataset.ver || b.dataset.edit || b.dataset.del));
    if (b.dataset.ver) ver(a);
    if (b.dataset.edit) abrirForm(a);
    if (b.dataset.del && exigirLicenca() && await confirmar('Excluir este atendimento do prontuário?')) {
      await remove('atendimentos', a.id); toast('Atendimento excluído'); recarregar();
    }
  };

  desenhar();
  if (params.get('pet')) abrirForm({ petId: params.get('pet') });
}

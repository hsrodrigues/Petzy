import { state, list, save, remove, update, create, loadTutoresPets, orderBy, limit } from '../store.js';
import { $, esc, pageHeader, empty, modal, confirmar, toast, fmtDateTime, fmtDate, toISODateTime, toISODate, addDays, today, norm, debounce, idade, badge, kpi, num, fieldHtml, readForm, ativarBusca } from '../ui.js';
import { exigirLicenca } from '../app.js';
import { petOptions, emoji } from './pets.js';
import { VIAS, SISTEMAS, EXAMES, usoDaVia } from '../docs.js';
import { gerarDocumento, menuDocs } from '../documentos.js';

const TIPOS = ['Consulta', 'Retorno', 'Emergência', 'Cirurgia', 'Exame', 'Internação', 'Vacinação', 'Teleconsulta'];
const FARMACIAS = ['Veterinária', 'Humana', 'Manipulação'];
const MEDS = ['Amoxicilina + clavulanato de potássio', 'Cefalexina', 'Enrofloxacino', 'Doxiciclina', 'Metronidazol', 'Azitromicina', 'Sulfametoxazol + trimetoprima',
  'Meloxicam', 'Carprofeno', 'Firocoxibe', 'Dipirona', 'Tramadol', 'Gabapentina', 'Prednisolona', 'Dexametasona', 'Omeprazol', 'Ondansetrona', 'Maropitant (Cerenia)',
  'Simeticona', 'Probiótico', 'Oclacitinib (Apoquel)', 'Lokivetmab (Cytopoint)', 'Cetoconazol shampoo', 'Clorexidina 2% solução', 'Colírio de tobramicina',
  'Pomada oftálmica (Epitezan)', 'Otológico (Otomax)', 'Ivermectina', 'Milbemicina + praziquantel', 'Fluralaner (Bravecto)', 'Sarolaner (Simparic)',
  'Furosemida', 'Pimobendan', 'Benazepril', 'Levotiroxina', 'Fenobarbital', 'Silimarina', 'Ácido ursodesoxicólico', 'Suplemento vitamínico'];
const DOCS_ATEND = ['receita', 'receitaControle', 'prontuario', '-', 'exames', 'atestado', 'termo'];

// ---------- blocos de HTML do formulário ----------
const sistemasHtml = (v = {}) => `
  <div class="d-flex justify-content-between align-items-center mb-2">
    <span class="fw-semibold">Avaliação por sistemas</span>
    <button type="button" class="btn btn-sm btn-light border" id="sisNormal"><i class="bi bi-check2-all me-1"></i>Marcar vazios como normais</button>
  </div>
  ${SISTEMAS.map(([k, l]) => { const s = v[k] || {}; return `
  <div class="sistema-row">
    <span class="fs-7 fw-semibold">${l}</span>
    <select class="form-select form-select-sm" data-sis="${k}"><option value="">—</option>${['Normal', 'Alterado', 'Não avaliado'].map(o => `<option ${s.status === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <input class="form-control form-control-sm" data-sis-obs="${k}" value="${esc(s.obs || '')}" placeholder="Alterações encontradas">
  </div>`; }).join('')}`;

const examesHtml = (sel = []) => `
  <label class="form-label">Exames solicitados</label>
  <div class="check-grid">${EXAMES.map((e, i) => `
    <div class="form-check"><input class="form-check-input" type="checkbox" id="exs${i}" value="${e}" data-exame ${sel.includes(e) ? 'checked' : ''}>
    <label class="form-check-label fs-7" for="exs${i}">${e}</label></div>`).join('')}</div>`;

const rxItemHtml = (i = {}) => `
  <div class="rx-item">
    <span class="rx-num"></span>
    <button type="button" class="btn-close position-absolute top-0 end-0 m-2" style="font-size:.6rem" data-rx-rm title="Remover"></button>
    <div class="row g-2">
      <div class="col-md-5"><label class="form-label fs-8 mb-1">Medicamento</label><input class="form-control form-control-sm" data-k="medicamento" list="listaMeds" value="${esc(i.medicamento || '')}" placeholder="Nome comercial ou princípio ativo"></div>
      <div class="col-6 col-md-3"><label class="form-label fs-8 mb-1">Concentração</label><input class="form-control form-control-sm" data-k="concentracao" value="${esc(i.concentracao || '')}" placeholder="250 mg"></div>
      <div class="col-6 col-md-4"><label class="form-label fs-8 mb-1">Quantidade</label><input class="form-control form-control-sm" data-k="quantidade" value="${esc(i.quantidade || '')}" placeholder="1 caixa · 14 comprimidos"></div>
      <div class="col-6 col-md-3"><label class="form-label fs-8 mb-1">Via</label><select class="form-select form-select-sm" data-k="via">${VIAS.map(v => `<option ${v.value === (i.via || 'Oral') ? 'selected' : ''}>${v.value}</option>`).join('')}</select></div>
      <div class="col-6 col-md-3"><label class="form-label fs-8 mb-1">Farmácia</label><select class="form-select form-select-sm" data-k="farmacia">${FARMACIAS.map(f => `<option ${f === (i.farmacia || 'Veterinária') ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
      <div class="col-md-6"><label class="form-label fs-8 mb-1">Posologia</label><input class="form-control form-control-sm" data-k="posologia" value="${esc(i.posologia || '')}" placeholder="Administrar 1 comprimido a cada 12 horas, por 7 dias"></div>
    </div>
  </div>`;

const receitaHtml = (v) => `
  ${v.prescricao && !v.receita?.length ? `<div class="alert alert-secondary fs-7"><strong>Prescrição registrada anteriormente:</strong><div style="white-space:pre-line">${esc(v.prescricao)}</div></div>` : ''}
  <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
    <div class="fw-semibold me-auto">Medicamentos prescritos</div>
    <div class="dropdown">
      <button type="button" class="btn btn-sm btn-light border dropdown-toggle" data-bs-toggle="dropdown"><i class="bi bi-bookmark-star me-1"></i>Usar modelo</button>
      <ul class="dropdown-menu dropdown-menu-end" id="rxModelos"><li><span class="dropdown-item-text text-muted fs-7">Carregando…</span></li></ul>
    </div>
    <button type="button" class="btn btn-sm btn-light border" id="rxSalvarModelo"><i class="bi bi-bookmark-plus me-1"></i>Salvar como modelo</button>
  </div>
  <div id="rxItens"></div>
  <button type="button" class="btn btn-soft btn-sm" id="rxAdd"><i class="bi bi-plus-lg me-1"></i>Adicionar medicamento</button>
  <div class="form-check form-switch mt-3"><input class="form-check-input" type="checkbox" id="rxControle" ${v.receitaControle ? 'checked' : ''}>
    <label class="form-check-label fs-7" for="rxControle">Receita de <strong>controle especial</strong> (2 vias, para tramadol, gabapentina, fenobarbital etc.)</label></div>
  <details class="mt-3 bg-light rounded-3 p-3">
    <summary class="fw-semibold fs-7"><i class="bi bi-calculator me-1"></i>Calculadora de dose</summary>
    <div class="row g-2 mt-1 align-items-end">
      <div class="col-4 col-md-2"><label class="form-label fs-8 mb-1">Peso (kg)</label><input type="number" step="0.01" class="form-control form-control-sm" id="cdPeso"></div>
      <div class="col-4 col-md-2"><label class="form-label fs-8 mb-1">Dose (mg/kg)</label><input type="number" step="0.01" class="form-control form-control-sm" id="cdDose"></div>
      <div class="col-4 col-md-3"><label class="form-label fs-8 mb-1">mg por comprimido/ml</label><input type="number" step="0.01" class="form-control form-control-sm" id="cdConc"></div>
      <div class="col-md-5 fs-7" id="cdRes">Informe peso e dose.</div>
    </div>
  </details>`;

function abas(dados, v) {
  return [
    { id: 'triagem', t: 'Triagem', i: 'heart-pulse', fields: [
      { name: 'petId', label: 'Paciente', type: 'select', required: true, search: true, options: petOptions(dados.pets, dados.C), col: 'col-md-6' },
      { name: 'tipo', label: 'Tipo', type: 'select', required: true, options: TIPOS, col: 'col-6 col-md-3' },
      { name: 'data', label: 'Data/hora', type: 'datetime-local', required: true, col: 'col-6 col-md-3' },
      { type: 'custom', col: 'col-12', html: '<div id="alertaPet"></div>' },
      { type: 'section', label: 'Sinais vitais' },
      { name: 'peso', label: 'Peso (kg)', type: 'number', step: '0.01', col: 'col-6 col-md-2' },
      { name: 'temperatura', label: 'Temperatura (°C)', type: 'number', step: '0.1', col: 'col-6 col-md-2' },
      { name: 'fc', label: 'FC (bpm)', type: 'number', col: 'col-6 col-md-2' },
      { name: 'fr', label: 'FR (mpm)', type: 'number', col: 'col-6 col-md-2' },
      { name: 'tpc', label: 'TPC (seg.)', type: 'number', step: '0.5', col: 'col-6 col-md-2' },
      { name: 'escore', label: 'Escore corporal', type: 'select', col: 'col-6 col-md-2', options: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ value: n, label: `${n}/9${n <= 3 ? ' magro' : n === 5 ? ' ideal' : n >= 7 ? ' obeso' : ''}` })) },
      { name: 'mucosas', label: 'Mucosas', type: 'select', options: ['Normocoradas', 'Hipocoradas', 'Hiperêmicas', 'Ictéricas', 'Cianóticas'], col: 'col-6 col-md-3' },
      { name: 'hidratacao', label: 'Hidratação', type: 'select', options: ['Normal', 'Desidratação leve (5%)', 'Desidratação moderada (8%)', 'Desidratação grave (10%+)'], col: 'col-6 col-md-3' },
      { name: 'dor', label: 'Escala de dor', type: 'select', options: [...Array(11).keys()].map(n => ({ value: n, label: `${n}/10${n === 0 ? ' sem dor' : n >= 7 ? ' intensa' : ''}` })), col: 'col-6 col-md-3' },
      { name: 'estadoMental', label: 'Estado mental', type: 'select', options: ['Alerta', 'Apático', 'Deprimido', 'Agitado', 'Estuporoso', 'Comatoso'], col: 'col-6 col-md-3' }
    ] },
    { id: 'anamnese', t: 'Anamnese', i: 'chat-left-text', fields: [
      { name: 'queixa', label: 'Queixa principal', col: 'col-12', placeholder: 'Motivo da consulta' },
      { name: 'anamnese', label: 'Histórico da doença atual', type: 'textarea', rows: 4, col: 'col-12', placeholder: 'Início, evolução, frequência, sinais observados pelo tutor...' },
      { name: 'alimentacao', label: 'Alimentação', col: 'col-md-6', placeholder: 'Ração, quantidade, petiscos, apetite...' },
      { name: 'ambiente', label: 'Ambiente e contactantes', col: 'col-md-6', placeholder: 'Casa/apartamento, acesso à rua, outros animais...' },
      { name: 'medicacoesUso', label: 'Medicações em uso', col: 'col-md-6' },
      { name: 'vacinacaoEmDia', label: 'Vacinação / vermifugação', type: 'select', options: ['Em dia', 'Atrasada', 'Nunca vacinado', 'Desconhecida'], col: 'col-md-6' },
      { name: 'antecedentes', label: 'Antecedentes (doenças, cirurgias, alergias)', type: 'textarea', rows: 2, col: 'col-12' }
    ] },
    { id: 'exame', t: 'Exame físico', i: 'clipboard2-pulse', fields: [
      { type: 'custom', col: 'col-12', html: sistemasHtml(v.exameSistemas) },
      { name: 'exameFisico', label: 'Observações gerais do exame físico', type: 'textarea', rows: 3, col: 'col-12' }
    ] },
    { id: 'conduta', t: 'Diagnóstico e conduta', i: 'journal-medical', fields: [
      { name: 'diagnostico', label: 'Diagnóstico (presuntivo ou definitivo)', col: 'col-md-8' },
      { name: 'prognostico', label: 'Prognóstico', type: 'select', options: ['Favorável', 'Reservado', 'Desfavorável', 'Grave'], col: 'col-md-4' },
      { name: 'diferenciais', label: 'Diagnósticos diferenciais', type: 'textarea', rows: 2, col: 'col-md-6' },
      { name: 'procedimentos', label: 'Procedimentos realizados', type: 'textarea', rows: 2, col: 'col-md-6' },
      { type: 'custom', col: 'col-12', html: examesHtml(v.examesSolicitados) },
      { name: 'exames', label: 'Outros exames', col: 'col-md-5' },
      { name: 'retorno', label: 'Retorno em', type: 'date', col: 'col-md-3' },
      { type: 'custom', col: 'col-md-4 d-flex align-items-end gap-1', html: [7, 15, 30].map(d => `<button type="button" class="btn btn-sm btn-light border" data-ret="${d}">+${d} dias</button>`).join('') },
      { name: 'orientacoes', label: 'Orientações ao tutor', type: 'textarea', rows: 3, col: 'col-12', placeholder: 'Cuidados em casa, restrições, sinais de alerta...' }
    ] },
    { id: 'receita', t: 'Receita', i: 'prescription2', fields: [
      { type: 'custom', col: 'col-12', html: receitaHtml(v) },
      { name: 'receitaObs', label: 'Observações da receita (saem impressas)', type: 'textarea', rows: 2, col: 'col-12', placeholder: 'Ex.: administrar junto com alimento; retornar se houver vômito.' }
    ] }
  ];
}

export async function render(view, { params }) {
  let [dados, atend] = await Promise.all([loadTutoresPets(), list('atendimentos', orderBy('data', 'desc'), limit(300))]);
  const { P, C } = dados;

  view.innerHTML = `
    ${pageHeader('Prontuários', 'Atendimentos clínicos, receitas e documentos',
      `<button class="btn btn-primary" id="btnNovo"><i class="bi bi-clipboard2-plus me-1"></i>Novo atendimento</button>`)}
    <div class="row g-3 mb-3" id="kpis"></div>
    <div class="card">
      <div class="card-header d-flex gap-2 flex-wrap align-items-center">
        <div class="position-relative flex-fill" style="max-width:360px">
          <i class="bi bi-search position-absolute text-muted" style="left:.8rem;top:50%;transform:translateY(-50%)"></i>
          <input class="form-control ps-5" id="busca" placeholder="Pet, tutor, diagnóstico ou medicamento...">
        </div>
        <select class="form-select w-auto" id="fTipo"><option value="">Todos os tipos</option>${TIPOS.map(t => `<option>${t}</option>`).join('')}</select>
        <select class="form-select w-auto" id="fPeriodo"><option value="">Qualquer data</option><option value="hoje">Hoje</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="retorno">Retornos próximos</option></select>
        <button class="btn btn-light border" id="limparFiltros" title="Limpar filtros"><i class="bi bi-x-circle me-1"></i>Limpar</button>
      </div>
      <div class="table-responsive"><table class="table table-hover">
        <thead><tr><th>Data</th><th>Paciente</th><th>Tipo</th><th>Diagnóstico</th><th>Receita</th><th>Veterinário</th><th class="text-end">Ações</th></tr></thead>
        <tbody id="tbody"></tbody>
      </table></div>
    </div>`;

  const hoje = today(), em7 = toISODate(addDays(new Date(), 7));

  function desenhar() {
    $('#kpis', view).innerHTML = `
      <div class="col-6 col-lg-3">${kpi('clipboard2-pulse', 'Atendimentos hoje', atend.filter(a => a.data?.startsWith(hoje)).length)}</div>
      <div class="col-6 col-lg-3">${kpi('calendar-month', 'Neste mês', atend.filter(a => a.data?.startsWith(hoje.slice(0, 7))).length, 'info')}</div>
      <div class="col-6 col-lg-3">${kpi('arrow-repeat', 'Retornos em 7 dias', atend.filter(a => a.retorno >= hoje && a.retorno <= em7).length, 'warning')}</div>
      <div class="col-6 col-lg-3">${kpi('prescription2', 'Receitas emitidas no mês', atend.filter(a => a.data?.startsWith(hoje.slice(0, 7)) && (a.receita?.length || a.prescricao)).length, 'success')}</div>`;

    const q = norm($('#busca', view).value), t = $('#fTipo', view).value, per = $('#fPeriodo', view).value;
    const desde = per && per !== 'hoje' && per !== 'retorno' ? toISODate(addDays(new Date(), -Number(per))) : '';
    const rows = atend.filter(a => (!t || a.tipo === t)
      && (!per || (per === 'hoje' ? a.data?.startsWith(hoje) : per === 'retorno' ? (a.retorno >= hoje && a.retorno <= em7) : a.data >= desde))
      && (!q || norm([P[a.petId]?.nome, C[a.clienteId]?.nome, a.diagnostico, a.queixa, ...(a.receita || []).map(i => i.medicamento)].join(' ')).includes(q)));

    $('#tbody', view).innerHTML = rows.length ? rows.map(a => {
      const meds = (a.receita || []).filter(i => i.medicamento);
      return `<tr>
        <td class="text-nowrap fs-7">${fmtDateTime(a.data)}</td>
        <td><a href="#/pets/${a.petId}" class="fw-semibold text-decoration-none">${emoji(P[a.petId]?.especie)} ${esc(P[a.petId]?.nome || '—')}</a>
          <div class="text-muted fs-8">${esc(C[a.clienteId]?.nome || '')}</div></td>
        <td>${badge(a.tipo || 'Consulta', a.tipo === 'Emergência' ? 'danger' : a.tipo === 'Cirurgia' ? 'warning' : 'primary')}</td>
        <td class="fs-7">${esc(a.diagnostico || '—')}${a.retorno ? `<div class="fs-8 text-muted"><i class="bi bi-arrow-repeat"></i> retorno ${fmtDate(a.retorno)}</div>` : ''}</td>
        <td class="fs-8 text-muted" style="max-width:220px">${meds.length ? esc(meds.map(i => i.medicamento).join(', ')) : a.prescricao ? 'texto livre' : '—'}</td>
        <td class="fs-7">${esc(a.vetNome || '')}</td>
        <td class="text-end text-nowrap">
          <button class="btn btn-icon btn-light" title="Ver" data-ver="${a.id}"><i class="bi bi-eye"></i></button>
          <div class="dropdown d-inline-block">
            <button class="btn btn-icon btn-light" data-bs-toggle="dropdown" data-bs-popper-config='{"strategy":"fixed"}' title="Documentos"><i class="bi bi-printer"></i></button>
            <ul class="dropdown-menu dropdown-menu-end">${menuDocs(DOCS_ATEND, `data-atend="${a.id}" data-doc`)}</ul>
          </div>
          <button class="btn btn-icon btn-light" title="Editar" data-edit="${a.id}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-icon btn-light" title="Excluir" data-del="${a.id}"><i class="bi bi-trash text-danger"></i></button>
        </td></tr>`;
    }).join('') : `<tr><td colspan="7">${empty('clipboard2-pulse', atend.length ? 'Nenhum atendimento encontrado.' : 'Nenhum atendimento registrado ainda.')}</td></tr>`;
  }

  async function recarregar() { atend = await list('atendimentos', orderBy('data', 'desc'), limit(300)); desenhar(); }

  const doc = (tipo, a) => gerarDocumento(tipo, { pet: P[a.petId] || {}, tutor: C[a.clienteId] || {}, atendimento: a });

  // ================= Formulário do atendimento =================
  function abrirForm(a = {}) {
    if (!exigirLicenca()) return;
    if (!dados.pets.length) return toast('Cadastre um pet primeiro.', 'warning');
    const v = { data: toISODateTime(), tipo: 'Consulta', ...a };
    const A = abas(dados, v);
    const campos = A.flatMap(x => x.fields);

    const { el, close } = modal({
      title: `<i class="bi bi-clipboard2-pulse text-primary me-2"></i>${a.id ? 'Editar atendimento' : 'Novo atendimento'}`, size: 'xl',
      body: `
        <ul class="nav nav-tabs mb-3 flex-nowrap overflow-auto">${A.map((x, i) => `
          <li class="nav-item"><button type="button" class="nav-link text-nowrap ${i ? '' : 'active'}" data-bs-toggle="tab" data-bs-target="#ab-${x.id}"><i class="bi bi-${x.i} me-1"></i>${x.t}</button></li>`).join('')}
        </ul>
        <form novalidate><div class="tab-content">${A.map((x, i) => `
          <div class="tab-pane fade ${i ? '' : 'show active'}" id="ab-${x.id}"><div class="row g-3">${x.fields.map(f => fieldHtml(f, v[f.name])).join('')}</div></div>`).join('')}
        </div></form>
        <datalist id="listaMeds">${MEDS.map(m => `<option value="${m}">`).join('')}</datalist>`,
      footer: `<span class="text-muted fs-8 me-auto d-none d-md-inline"><i class="bi bi-info-circle me-1"></i>Só o paciente, o tipo e a data são obrigatórios.</span>
        <button class="btn btn-light" data-bs-dismiss="modal">Cancelar</button>
        <button class="btn btn-outline-primary" data-salvar="1"><i class="bi bi-printer me-1"></i>Salvar e imprimir receita</button>
        <button class="btn btn-primary px-4" data-salvar="0">Salvar atendimento</button>`
    });
    const form = $('form', el);
    ativarBusca(el);

    // alerta com dados do paciente (alergias, peso, idade)
    const alerta = () => {
      const p = P[form.petId.value];
      $('#alertaPet', el).innerHTML = p ? `<div class="d-flex flex-wrap gap-3 fs-7 text-muted bg-light rounded-3 p-2 px-3">
        <span>${emoji(p.especie)} ${esc([p.especie, p.raca, p.sexo].filter(Boolean).join(' · '))}</span><span>${idade(p.nascimento)}</span>
        <span>Último peso: ${p.peso || '—'} kg</span><span>Tutor: ${esc(C[p.clienteId]?.nome || '—')}</span>
        ${p.alergias ? `<span class="text-danger fw-semibold"><i class="bi bi-exclamation-triangle"></i> ${esc(p.alergias)}</span>` : ''}</div>` : '';
      if (p?.peso && !$('#cdPeso', el).value) $('#cdPeso', el).value = p.peso;
    };
    form.petId.addEventListener('change', alerta);
    alerta();

    $('#sisNormal', el).onclick = () => el.querySelectorAll('[data-sis]').forEach(s => { if (!s.value) s.value = 'Normal'; });
    el.querySelectorAll('[data-ret]').forEach(b => b.onclick = () => { form.retorno.value = toISODate(addDays(new Date(), Number(b.dataset.ret))); });

    // ---------- receita ----------
    const itensBox = $('#rxItens', el);
    const numerar = () => itensBox.querySelectorAll('.rx-num').forEach((n, i) => { n.textContent = i + 1; });
    const addItem = (i) => { itensBox.insertAdjacentHTML('beforeend', rxItemHtml(i)); numerar(); };
    (v.receita?.length ? v.receita : [{}]).forEach(addItem);
    $('#rxAdd', el).onclick = () => { addItem({}); itensBox.lastElementChild.querySelector('input').focus(); };
    itensBox.onclick = (e) => { if (e.target.closest('[data-rx-rm]')) { e.target.closest('.rx-item').remove(); numerar(); } };
    const lerItens = () => [...itensBox.querySelectorAll('.rx-item')].map(r => {
      const o = {}; r.querySelectorAll('[data-k]').forEach(x => { o[x.dataset.k] = x.value.trim(); });
      o.uso = usoDaVia(o.via);
      return o;
    }).filter(o => o.medicamento);

    let modelos = [];
    const desenharModelos = () => {
      $('#rxModelos', el).innerHTML = modelos.length ? modelos.map(m => `<li><button type="button" class="dropdown-item d-flex justify-content-between gap-3" data-modelo="${m.id}">
        <span>${esc(m.nome)}</span><span class="text-muted fs-8">${m.itens.length} item(ns)</span></button></li>`).join('')
        : '<li><span class="dropdown-item-text text-muted fs-7">Nenhum modelo salvo ainda.<br>Monte uma receita e clique em "Salvar como modelo".</span></li>';
    };
    list('modelosReceita').then(m => { modelos = m.sort((x, y) => x.nome.localeCompare(y.nome)); desenharModelos(); }).catch(() => desenharModelos());
    $('#rxModelos', el).onclick = (e) => {
      const b = e.target.closest('[data-modelo]'); if (!b) return;
      const m = modelos.find(x => x.id === b.dataset.modelo);
      itensBox.querySelectorAll('.rx-item').forEach(r => { if (![...r.querySelectorAll('input[data-k]')].some(x => x.value.trim())) r.remove(); });
      m.itens.forEach(addItem);
      if (m.obs && !form.receitaObs.value) form.receitaObs.value = m.obs;
      toast(`Modelo "${m.nome}" aplicado`);
    };
    $('#rxSalvarModelo', el).onclick = async () => {
      const itens = lerItens();
      if (!itens.length) return toast('Adicione ao menos um medicamento.', 'warning');
      const nome = prompt('Nome do modelo (ex.: Otite externa canina):');
      if (!nome?.trim()) return;
      const id = await create('modelosReceita', { nome: nome.trim(), itens, obs: form.receitaObs.value.trim() });
      modelos.push({ id, nome: nome.trim(), itens }); modelos.sort((x, y) => x.nome.localeCompare(y.nome)); desenharModelos();
      toast('Modelo salvo');
    };

    // calculadora de dose
    const calc = () => {
      const p = Number($('#cdPeso', el).value), d = Number($('#cdDose', el).value), c = Number($('#cdConc', el).value);
      $('#cdRes', el).innerHTML = !p || !d ? 'Informe peso e dose.'
        : `Dose total: <strong>${num(p * d, 2)} mg</strong>${c ? ` = <strong>${num((p * d) / c, 2)}</strong> comprimido(s) ou ml por administração` : ''}`;
    };
    ['#cdPeso', '#cdDose', '#cdConc'].forEach(s => $(s, el).addEventListener('input', calc));
    if (v.peso) $('#cdPeso', el).value = v.peso;
    form.peso.addEventListener('input', () => { $('#cdPeso', el).value = form.peso.value; calc(); });

    // ---------- salvar ----------
    el.querySelectorAll('[data-salvar]').forEach(btn => btn.onclick = async () => {
      if (!form.checkValidity()) {
        form.classList.add('was-validated');
        const pane = form.querySelector(':invalid')?.closest('.tab-pane');
        if (pane) bootstrap.Tab.getOrCreateInstance(el.querySelector(`[data-bs-target="#${pane.id}"]`)).show();
        return toast('Preencha os campos obrigatórios.', 'warning');
      }
      const d = readForm(form, campos);
      d.exameSistemas = {};
      el.querySelectorAll('[data-sis]').forEach(s => {
        const obs = el.querySelector(`[data-sis-obs="${s.dataset.sis}"]`).value.trim();
        if (s.value || obs) d.exameSistemas[s.dataset.sis] = { status: s.value, obs };
      });
      d.examesSolicitados = [...el.querySelectorAll('[data-exame]:checked')].map(x => x.value);
      d.receita = lerItens();
      d.receitaControle = $('#rxControle', el).checked;
      d.clienteId = P[d.petId]?.clienteId || null;
      if (!a.id) Object.assign(d, { vetId: state.user.uid, vetNome: state.perfil.nome, vetCrmv: state.perfil.crmv || '' });

      el.querySelectorAll('[data-salvar]').forEach(b => { b.disabled = true; });
      try {
        const id = await save('atendimentos', a.id, d);
        if (d.peso) await update('pets', d.petId, { peso: d.peso }); // mantém o peso do pet atualizado
        toast('Atendimento salvo');
        close();
        await recarregar();
        if (btn.dataset.salvar === '1') doc(d.receitaControle ? 'receitaControle' : 'receita', { ...a, ...d, id });
      } catch (e) {
        toast(e.message, 'danger');
        el.querySelectorAll('[data-salvar]').forEach(b => { b.disabled = false; });
      }
    });
  }

  // ================= Visualização =================
  function ver(a) {
    const p = P[a.petId] || {}, t = C[a.clienteId] || {};
    const bloco = (tit, txt) => txt ? `<div class="mb-3"><div class="fs-8 text-muted text-uppercase fw-semibold mb-1">${tit}</div><div style="white-space:pre-line">${esc(txt)}</div></div>` : '';
    const vit = [a.peso && `Peso ${a.peso} kg`, a.temperatura && `T ${a.temperatura} °C`, a.fc && `FC ${a.fc}`, a.fr && `FR ${a.fr}`, a.tpc && `TPC ${a.tpc}s`,
      a.escore && `ECC ${a.escore}/9`, a.dor != null && a.dor !== '' && `Dor ${a.dor}/10`, a.mucosas, a.hidratacao, a.estadoMental].filter(Boolean);
    const sis = SISTEMAS.filter(([k]) => a.exameSistemas?.[k]?.status || a.exameSistemas?.[k]?.obs);
    const meds = (a.receita || []).filter(i => i.medicamento);

    const { el, close } = modal({
      title: `${emoji(p.especie)} ${esc(p.nome || '')} <span class="text-muted fw-normal fs-6">· ${esc(a.tipo || 'Consulta')}</span>`, size: 'xl',
      body: `
        <div class="d-flex flex-wrap gap-3 text-muted fs-7 mb-3">
          <span><i class="bi bi-calendar3 me-1"></i>${fmtDateTime(a.data)}</span><span><i class="bi bi-person-badge me-1"></i>${esc(a.vetNome || '')}</span>
          <span><i class="bi bi-person me-1"></i>${esc(t.nome || '')}</span>${a.retorno ? `<span class="text-primary"><i class="bi bi-arrow-repeat me-1"></i>Retorno ${fmtDate(a.retorno)}</span>` : ''}
        </div>
        ${vit.length ? `<div class="d-flex flex-wrap gap-2 mb-4">${vit.map(x => badge(x, 'secondary')).join('')}</div>` : ''}
        <div class="row g-4">
          <div class="col-lg-6">
            ${bloco('Queixa principal', a.queixa)}${bloco('Histórico', a.anamnese)}
            ${bloco('Alimentação', a.alimentacao)}${bloco('Ambiente', a.ambiente)}${bloco('Medicações em uso', a.medicacoesUso)}
            ${sis.length ? `<div class="mb-3"><div class="fs-8 text-muted text-uppercase fw-semibold mb-1">Exame físico</div>
              ${sis.map(([k, l]) => { const s = a.exameSistemas[k]; return `<div class="fs-7 d-flex gap-2 py-1 border-bottom"><span class="fw-semibold" style="min-width:150px">${l}</span>
                ${s.status ? badge(s.status, s.status === 'Alterado' ? 'danger' : s.status === 'Normal' ? 'success' : 'secondary') : ''}<span class="text-muted">${esc(s.obs || '')}</span></div>`; }).join('')}</div>` : ''}
            ${bloco('Observações do exame físico', a.exameFisico)}
          </div>
          <div class="col-lg-6">
            ${bloco('Diagnóstico', a.diagnostico)}${bloco('Diferenciais', a.diferenciais)}${a.prognostico ? bloco('Prognóstico', a.prognostico) : ''}
            ${bloco('Procedimentos', a.procedimentos)}
            ${a.examesSolicitados?.length || a.exames ? bloco('Exames solicitados', [...(a.examesSolicitados || []), a.exames].filter(Boolean).join(' · ')) : ''}
            ${meds.length ? `<div class="mb-3"><div class="fs-8 text-muted text-uppercase fw-semibold mb-1">Receita ${a.receitaControle ? badge('controle especial', 'warning') : ''}</div>
              ${meds.map((i, n) => `<div class="fs-7 py-1 border-bottom"><strong>${n + 1}. ${esc(i.medicamento)} ${esc(i.concentracao || '')}</strong> <span class="text-muted">· ${esc(i.quantidade || '')}</span>
                <div class="text-muted">${esc(i.posologia || '')} · via ${esc((i.via || '').toLowerCase())}</div></div>`).join('')}</div>` : bloco('Prescrição', a.prescricao)}
            ${bloco('Orientações', a.orientacoes || a.receitaObs)}
          </div>
        </div>`,
      footer: `
        <div class="dropdown me-auto"><button class="btn btn-light border dropdown-toggle" data-bs-toggle="dropdown"><i class="bi bi-printer me-1"></i>Documentos</button>
          <ul class="dropdown-menu">${menuDocs(DOCS_ATEND)}</ul></div>
        <button class="btn btn-light" data-bs-dismiss="modal">Fechar</button>
        <button class="btn btn-primary" data-edit><i class="bi bi-pencil me-1"></i>Editar</button>`
    });
    el.querySelectorAll('[data-doc]').forEach(b => b.onclick = () => doc(b.dataset.doc, a));
    $('[data-edit]', el).onclick = () => { close(); abrirForm(a); };
  }

  // ================= Eventos =================
  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#fTipo', view).onchange = desenhar;
  $('#fPeriodo', view).onchange = desenhar;
  $('#limparFiltros', view).onclick = () => { $('#busca', view).value = ''; $('#fTipo', view).value = ''; $('#fPeriodo', view).value = ''; desenhar(); };
  $('#btnNovo', view).onclick = () => abrirForm();
  $('#tbody', view).onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.dataset.ver || b.dataset.edit || b.dataset.del || b.dataset.atend;
    const a = atend.find(x => x.id === id); if (!a) return;
    if (b.dataset.doc) return doc(b.dataset.doc, a);
    if (b.dataset.ver) ver(a);
    if (b.dataset.edit) abrirForm(a);
    if (b.dataset.del && exigirLicenca() && await confirmar('Excluir este atendimento do prontuário?')) {
      await remove('atendimentos', a.id); toast('Atendimento excluído'); recarregar();
    }
  };

  desenhar();
  if (params.get('pet')) abrirForm({ petId: params.get('pet') });
}

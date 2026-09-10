import { list, save, remove, get, update, loadTutoresPets, where } from '../store.js';
import { $, esc, pageHeader, empty, formModal, confirmar, toast, idade, fmtDate, fmtDateTime, norm, debounce, badge, money } from '../ui.js';
import { exigirLicenca } from '../app.js';
import { abrirFormCliente } from './clientes.js';

export const ESPECIES = ['Cão', 'Gato', 'Ave', 'Roedor', 'Réptil', 'Coelho', 'Outro'];
const EMOJI = { 'Cão': '🐶', 'Gato': '🐱', 'Ave': '🦜', 'Roedor': '🐹', 'Réptil': '🦎', 'Coelho': '🐰' };
export const emoji = (e) => EMOJI[e] || '🐾';

// <option>s "Pet — Tutor" usados em vários formulários
export const petOptions = (pets, C) => pets.map(p => ({ value: p.id, label: `${emoji(p.especie)} ${p.nome} — ${C[p.clienteId]?.nome || 'sem tutor'}` }));

export const fotoPet = (p, cls = '') => p.foto
  ? `<img src="${p.foto}" class="${cls}" alt="${esc(p.nome)}" style="object-fit:cover">`
  : `<div class="${cls} d-grid" style="place-items:center;background:linear-gradient(135deg,#efedff,#e3f8f2)">${emoji(p.especie)}</div>`;

// Reduz a imagem para ~400px e guarda como data URL no próprio documento
// (funciona no plano gratuito do Firebase, sem precisar do Storage)
function comprimirImagem(file, max = 400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.78));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function abrirFormPet(pet = {}, { clientes, C }, onSaved) {
  if (!exigirLicenca()) return;
  let foto = pet.foto || null;
  const fields = [
    { type: 'custom', col: 'col-12', html: `
      <div class="d-flex align-items-center gap-3">
        <div id="fotoPrev" style="width:84px;height:84px;border-radius:18px;overflow:hidden;font-size:2.4rem">${fotoPet(pet, 'w-100 h-100')}</div>
        <div><label class="btn btn-soft btn-sm mb-1"><i class="bi bi-camera me-1"></i>Foto do pet<input type="file" accept="image/*" id="fotoInput" hidden></label>
        <div class="text-muted fs-8">JPG ou PNG. A imagem é redimensionada automaticamente.</div></div>
      </div>` },
    { name: 'nome', label: 'Nome do pet', required: true, col: 'col-md-5' },
    { name: 'clienteId', label: 'Tutor', type: 'select', required: true, col: 'col-md-7',
      options: clientes.map(c => ({ value: c.id, label: c.nome })) },
    { name: 'especie', label: 'Espécie', type: 'select', required: true, options: ESPECIES, col: 'col-md-4', default: 'Cão' },
    { name: 'raca', label: 'Raça', col: 'col-md-4', placeholder: 'SRD, Poodle...' },
    { name: 'sexo', label: 'Sexo', type: 'select', options: ['Macho', 'Fêmea'], col: 'col-md-4' },
    { name: 'nascimento', label: 'Nascimento', type: 'date', col: 'col-md-4' },
    { name: 'peso', label: 'Peso (kg)', type: 'number', step: '0.01', col: 'col-md-4' },
    { name: 'porte', label: 'Porte', type: 'select', options: ['Mini', 'Pequeno', 'Médio', 'Grande', 'Gigante'], col: 'col-md-4' },
    { name: 'pelagem', label: 'Pelagem / cor', col: 'col-md-4' },
    { name: 'microchip', label: 'Microchip', col: 'col-md-4' },
    { name: 'castrado', label: 'Castrado(a)', type: 'checkbox', col: 'col-md-4' },
    { name: 'alergias', label: 'Alergias / alertas', col: 'col-12', placeholder: 'Ex.: alérgico a dipirona, agressivo ao manusear...' },
    { name: 'obs', label: 'Observações', type: 'textarea', col: 'col-12', rows: 2 }
  ];
  formModal({
    title: pet.id ? `Editar ${esc(pet.nome)}` : 'Novo pet', fields, values: pet,
    onShown: (el) => {
      $('#fotoInput', el).onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        foto = await comprimirImagem(f);
        $('#fotoPrev', el).innerHTML = `<img src="${foto}" class="w-100 h-100" style="object-fit:cover">`;
      };
    },
    onSubmit: async (data) => {
      data.foto = foto;
      const id = await save('pets', pet.id, data);
      toast(pet.id ? 'Pet atualizado' : 'Pet cadastrado 🐾');
      onSaved?.({ id, ...data });
    }
  });
}

// ================= Lista =================
export async function render(view, { args, params }) {
  if (args[0]) return renderPerfil(view, args[0]);

  let dados = await loadTutoresPets();

  view.innerHTML = `
    ${pageHeader('Pets', 'Todos os pacientes da clínica',
      `<button class="btn btn-light border" id="btnTutor"><i class="bi bi-person-plus me-1"></i>Novo tutor</button>
       <button class="btn btn-primary" id="btnNovo"><i class="bi bi-plus-lg me-1"></i>Novo pet</button>`)}
    <div class="card mb-3"><div class="card-body d-flex gap-2 flex-wrap align-items-center py-3">
      <div class="position-relative flex-fill" style="max-width:360px">
        <i class="bi bi-search position-absolute text-muted" style="left:.8rem;top:50%;transform:translateY(-50%)"></i>
        <input class="form-control ps-5" id="busca" placeholder="Nome do pet, tutor, raça, microchip...">
      </div>
      <select class="form-select w-auto" id="fEspecie"><option value="">Todas as espécies</option>${ESPECIES.map(e => `<option>${e}</option>`).join('')}</select>
      <span class="text-muted fs-7 ms-auto" id="contador"></span>
    </div></div>
    <div class="row g-3" id="grid"></div>`;

  const busca = $('#busca', view);
  busca.value = params.get('q') || '';

  function desenhar() {
    const { pets, C } = dados;
    const q = norm(busca.value), esp = $('#fEspecie', view).value;
    const rows = pets.filter(p => (!esp || p.especie === esp) &&
      (!q || norm([p.nome, p.raca, p.microchip, C[p.clienteId]?.nome, C[p.clienteId]?.telefone].join(' ')).includes(q)));
    $('#contador', view).textContent = `${rows.length} pets`;
    $('#grid', view).innerHTML = rows.length ? rows.map(p => `
      <div class="col-sm-6 col-lg-4 col-xxl-3">
        <a href="#/pets/${p.id}" class="card pet-card h-100 text-decoration-none text-reset">
          <div class="pet-photo">${p.foto ? `<img src="${p.foto}" class="w-100 h-100" style="object-fit:cover;border-radius:12px 12px 0 0">` : emoji(p.especie)}</div>
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start">
              <h6 class="fw-bold mb-0">${esc(p.nome)}</h6>
              ${p.sexo ? `<i class="bi bi-gender-${p.sexo === 'Macho' ? 'male text-info' : 'female text-danger'}"></i>` : ''}
            </div>
            <div class="text-muted fs-7">${esc([p.especie, p.raca].filter(Boolean).join(' · '))}</div>
            <div class="d-flex justify-content-between mt-2 fs-7">
              <span><i class="bi bi-person me-1 text-muted"></i>${esc(C[p.clienteId]?.nome || '—')}</span>
              <span class="text-muted">${idade(p.nascimento)}</span>
            </div>
            ${p.alergias ? `<div class="mt-2">${badge('⚠ ' + p.alergias, 'danger')}</div>` : ''}
          </div>
        </a>
      </div>`).join('') : `<div class="col-12"><div class="card">${empty('heart', dados.pets.length ? 'Nenhum pet encontrado.' : 'Nenhum pet cadastrado ainda.')}</div></div>`;
  }

  const recarregar = async () => { dados = await loadTutoresPets(); desenhar(); };
  busca.addEventListener('input', debounce(desenhar, 150));
  $('#fEspecie', view).onchange = desenhar;
  $('#btnNovo', view).onclick = () => {
    if (!dados.clientes.length) return toast('Cadastre um tutor primeiro.', 'warning');
    abrirFormPet({}, dados, recarregar);
  };
  $('#btnTutor', view).onclick = () => abrirFormCliente({}, (c) => { recarregar().then(() => abrirFormPet({ clienteId: c.id }, dados, recarregar)); });

  desenhar();
  if (params.get('novo')) abrirFormPet({ clienteId: params.get('novo') }, dados, recarregar);
}

// ================= Perfil do pet =================
async function renderPerfil(view, id) {
  const [pet, dados, atend, vac, ags] = await Promise.all([
    get('pets', id), loadTutoresPets(),
    list('atendimentos', where('petId', '==', id)),
    list('vacinas', where('petId', '==', id)),
    list('agendamentos', where('petId', '==', id))
  ]);
  if (!pet) { view.innerHTML = empty('question-circle', 'Pet não encontrado.', '<a href="#/pets" class="btn btn-primary">Voltar</a>'); return; }
  const tutor = dados.C[pet.clienteId] || {};
  atend.sort((a, b) => b.data.localeCompare(a.data));
  vac.sort((a, b) => b.dataAplicacao.localeCompare(a.dataAplicacao));
  ags.sort((a, b) => b.inicio.localeCompare(a.inicio));
  const whats = (tutor.telefone || '').replace(/\D/g, '');

  view.innerHTML = `
    <a href="#/pets" class="text-muted fs-7 text-decoration-none"><i class="bi bi-arrow-left me-1"></i>Voltar para pets</a>
    <div class="card mt-2 mb-3"><div class="card-body d-flex gap-4 flex-wrap align-items-center">
      <div style="width:110px;height:110px;border-radius:24px;overflow:hidden;font-size:3.4rem">${fotoPet(pet, 'w-100 h-100')}</div>
      <div class="flex-fill">
        <h2 class="fw-bold mb-1">${esc(pet.nome)} ${pet.castrado ? badge('castrado', 'info') : ''}</h2>
        <div class="text-muted mb-2">${esc([pet.especie, pet.raca, pet.sexo, pet.porte].filter(Boolean).join(' · '))}</div>
        <div class="d-flex gap-4 flex-wrap fs-7">
          <div><div class="text-muted fs-8">IDADE</div><strong>${idade(pet.nascimento)}</strong></div>
          <div><div class="text-muted fs-8">PESO</div><strong>${pet.peso ? pet.peso + ' kg' : '—'}</strong></div>
          <div><div class="text-muted fs-8">PELAGEM</div><strong>${esc(pet.pelagem || '—')}</strong></div>
          <div><div class="text-muted fs-8">MICROCHIP</div><strong>${esc(pet.microchip || '—')}</strong></div>
          <div><div class="text-muted fs-8">TUTOR</div><strong>${esc(tutor.nome || '—')}</strong> <span class="text-muted">${esc(tutor.telefone || '')}</span></div>
        </div>
        ${pet.alergias ? `<div class="alert alert-danger py-2 px-3 mt-3 mb-0 fs-7"><i class="bi bi-exclamation-triangle me-1"></i>${esc(pet.alergias)}</div>` : ''}
      </div>
      <div class="d-flex flex-column gap-2">
        <a href="#/prontuarios?pet=${id}" class="btn btn-primary"><i class="bi bi-clipboard2-plus me-1"></i>Novo atendimento</a>
        <a href="#/vacinas?pet=${id}" class="btn btn-soft"><i class="bi bi-shield-plus me-1"></i>Aplicar vacina</a>
        <div class="d-flex gap-2">
          ${whats ? `<a class="btn btn-light border flex-fill" target="_blank" href="https://wa.me/55${whats}"><i class="bi bi-whatsapp text-success"></i></a>` : ''}
          <button class="btn btn-light border flex-fill" id="btnEdit"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-light border flex-fill" id="btnDel"><i class="bi bi-trash text-danger"></i></button>
        </div>
      </div>
    </div></div>

    <ul class="nav nav-pills mb-3 gap-1">
      <li class="nav-item"><button class="nav-link active" data-bs-toggle="pill" data-bs-target="#tHist">Prontuário (${atend.length})</button></li>
      <li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tVac">Vacinas (${vac.length})</button></li>
      <li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tAg">Agendamentos (${ags.length})</button></li>
    </ul>
    <div class="tab-content">
      <div class="tab-pane fade show active" id="tHist"><div class="card"><div class="card-body">
        ${atend.length ? `<div class="timeline">${atend.map(a => `
          <div class="timeline-item">
            <div class="d-flex justify-content-between flex-wrap"><strong>${esc(a.tipo || 'Consulta')}</strong><span class="text-muted fs-7">${fmtDateTime(a.data)} · ${esc(a.vetNome || '')}</span></div>
            ${a.queixa ? `<div class="fs-7 mt-1"><span class="text-muted">Queixa:</span> ${esc(a.queixa)}</div>` : ''}
            ${a.diagnostico ? `<div class="fs-7"><span class="text-muted">Diagnóstico:</span> <strong>${esc(a.diagnostico)}</strong></div>` : ''}
            ${a.prescricao ? `<div class="fs-7 text-muted" style="white-space:pre-line">${esc(a.prescricao)}</div>` : ''}
            <div class="fs-8 text-muted mt-1">${[a.peso && `Peso ${a.peso}kg`, a.temperatura && `T ${a.temperatura}°C`, a.fc && `FC ${a.fc}`, a.fr && `FR ${a.fr}`].filter(Boolean).join(' · ')}</div>
          </div>`).join('')}</div>` : empty('clipboard2', 'Nenhum atendimento registrado.')}
      </div></div></div>
      <div class="tab-pane fade" id="tVac"><div class="card"><div class="table-responsive"><table class="table">
        <thead><tr><th>Vacina</th><th>Aplicação</th><th>Próxima dose</th><th>Lote</th></tr></thead>
        <tbody>${vac.length ? vac.map(v => `<tr><td class="fw-semibold">${esc(v.nome)}</td><td>${fmtDate(v.dataAplicacao)}</td>
          <td>${v.proximaDose ? badge(fmtDate(v.proximaDose), v.proximaDose < new Date().toISOString().slice(0, 10) ? 'danger' : 'success') : '—'}</td><td class="fs-7 text-muted">${esc(v.lote || '')}</td></tr>`).join('')
          : `<tr><td colspan="4">${empty('shield', 'Nenhuma vacina registrada.')}</td></tr>`}</tbody></table></div></div></div>
      <div class="tab-pane fade" id="tAg"><div class="card"><div class="table-responsive"><table class="table">
        <thead><tr><th>Data</th><th>Tipo</th><th>Status</th><th class="text-end">Valor</th></tr></thead>
        <tbody>${ags.length ? ags.map(a => `<tr><td>${fmtDateTime(a.inicio)}</td><td>${badge(a.tipo, 'primary')}</td><td class="fs-7">${esc((a.status || '').replace('_', ' '))}</td><td class="text-end">${money(a.valor)}</td></tr>`).join('')
          : `<tr><td colspan="4">${empty('calendar', 'Nenhum agendamento.')}</td></tr>`}</tbody></table></div></div></div>
    </div>`;

  $('#btnEdit', view).onclick = () => abrirFormPet(pet, dados, () => renderPerfil(view, id));
  $('#btnDel', view).onclick = async () => {
    if (!exigirLicenca()) return;
    if (await confirmar(`Excluir <strong>${esc(pet.nome)}</strong>? O histórico clínico continuará salvo, mas ficará sem vínculo.`)) {
      await remove('pets', id); toast('Pet excluído'); location.hash = '#/pets';
    }
  };
}

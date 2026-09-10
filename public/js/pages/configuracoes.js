import { state, list, ref, where, PAPEIS, PLANOS, MODULOS, db, writeBatch, col } from '../store.js';
import {
  doc, setDoc, updateDoc, initializeApp, deleteApp, getAuth, createUserWithEmailAndPassword, signOut, firebaseConfig,
  storage, ref as sRef, uploadBytes, getDownloadURL, deleteObject, emulador, connectAuthEmulator
} from '../firebase.js';
import { $, esc, pageHeader, formModal, toast, confirmar, modal, initials, badge, mask, toISODate, toISODateTime, addDays, comprimirImagem } from '../ui.js';
import { recarregarClinica, exigirLicenca } from '../app.js';
import { previsualizar } from '../documentos.js';
import * as D from '../docs.js';

// coleções operacionais (ordem: dependentes primeiro)
const COLECOES = ['agendamentos', 'atendimentos', 'vacinas', 'vendas', 'financeiro', 'movimentacoes', 'modelosReceita', 'pets', 'clientes', 'produtos', 'fornecedores', 'fiscal'];
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

const IMPORTACOES = {
  clientes: { label: 'Tutores', required: ['nome'], fields: ['nome', 'cpf', 'telefone', 'email', 'cep', 'endereco', 'numero', 'bairro', 'cidade', 'uf', 'obs'] },
  pets: { label: 'Pets', required: ['nome', 'clienteNome'], fields: ['nome', 'clienteNome', 'especie', 'raca', 'sexo', 'nascimento', 'peso', 'alergias', 'microchip', 'obs'] },
  produtos: { label: 'Produtos', required: ['nome', 'precoVenda'], fields: ['nome', 'categoria', 'codigo', 'precoCusto', 'precoVenda', 'estoque', 'estoqueMinimo', 'unidade', 'validade'] },
  fornecedores: { label: 'Fornecedores', required: ['nome'], fields: ['nome', 'documento', 'contato', 'telefone', 'email', 'endereco', 'observacoes'] }
};

function parseCSV(text) {
  const rows = [], row = [];
  let value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { value += '"'; i++; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && (ch === ';' || ch === ',')) { row.push(value.trim()); value = ''; continue; }
    if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i++;
      row.push(value.trim()); value = '';
      if (row.some(Boolean)) rows.push(row.splice(0));
      continue;
    }
    value += ch;
  }
  if (value || row.length) { row.push(value.trim()); rows.push(row); }
  return rows;
}

const chaveCSV = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const numeroCSV = (s) => Number(String(s || '').replace(/R\$\s?/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')) || 0;
const baixarJSON = (nome, dados) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' })); a.download = nome; a.click(); URL.revokeObjectURL(a.href); };
const lerArquivo = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = () => reject(new Error('Não foi possível ler o arquivo.')); r.readAsText(file, 'UTF-8'); });

export async function render(view) {
  const admin = state.perfil.papel === 'admin';
  const c = state.clinica;
  const dis = admin ? '' : 'disabled';
  let logo = c.logo || null;

  view.innerHTML = `
    ${pageHeader('Configurações', 'Dados da clínica, identidade visual, equipe e dados')}
    <ul class="nav nav-pills mb-3 gap-1 flex-wrap">
      <li class="nav-item"><button class="nav-link active" data-bs-toggle="pill" data-bs-target="#tClinica"><i class="bi bi-building me-1"></i>Clínica</button></li>
      <li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tMarca"><i class="bi bi-palette me-1"></i>Logo e documentos</button></li>
      <li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tEquipe"><i class="bi bi-people me-1"></i>Equipe</button></li>
      <li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tPerfil"><i class="bi bi-person me-1"></i>Meu perfil</button></li>
      ${admin ? '<li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tDados"><i class="bi bi-database me-1"></i>Dados</button></li>' : ''}
    </ul>
    <div class="tab-content">

      <!-- ===== Clínica ===== -->
      <div class="tab-pane fade show active" id="tClinica"><div class="card"><div class="card-body">
        <form id="fClinica" class="row g-3" novalidate>
          <div class="col-md-6"><label class="form-label">Nome da clínica</label><input class="form-control" name="nome" required value="${esc(c.nome)}" ${dis}></div>
          <div class="col-md-3"><label class="form-label">CNPJ</label><input class="form-control" name="cnpj" value="${esc(c.cnpj || '')}" ${dis}></div>
          <div class="col-md-3"><label class="form-label">Tipo</label><select class="form-select" name="tipo" ${dis}>
            ${[['clinica', 'Clínica veterinária'], ['petshop', 'Petshop'], ['ambos', 'Clínica + Petshop']].map(([v, l]) => `<option value="${v}" ${c.tipo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="col-md-4"><label class="form-label">Telefone / WhatsApp</label><input class="form-control" name="telefone" value="${esc(c.telefone || '')}" ${dis}></div>
          <div class="col-md-4"><label class="form-label">E-mail</label><input class="form-control" type="email" name="email" value="${esc(c.email || '')}" ${dis}></div>
          <div class="col-md-4"><label class="form-label">Site / Instagram</label><input class="form-control" name="site" value="${esc(c.site || '')}" placeholder="@suaclinica" ${dis}></div>
          <div class="col-md-6"><label class="form-label">Endereço</label><input class="form-control" name="endereco" value="${esc(c.endereco || '')}" placeholder="Rua, número, bairro" ${dis}></div>
          <div class="col-md-4"><label class="form-label">Cidade</label><input class="form-control" name="cidade" value="${esc(c.cidade || '')}" ${dis}></div>
          <div class="col-md-2"><label class="form-label">UF</label><select class="form-select" name="uf" ${dis}><option value="">—</option>${UFS.map(u => `<option ${c.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
          <div class="col-12"><h6 class="fw-bold text-primary mt-2 mb-0">Horário da agenda</h6></div>
          <div class="col-6 col-md-3"><label class="form-label">Abre às</label><select class="form-select" name="horaInicio" ${dis}>${[...Array(24).keys()].map(h => `<option value="${h}" ${(c.config?.horaInicio ?? 8) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
          <div class="col-6 col-md-3"><label class="form-label">Fecha às</label><select class="form-select" name="horaFim" ${dis}>${[...Array(24).keys()].map(h => h + 1).map(h => `<option value="${h}" ${(c.config?.horaFim ?? 19) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
          ${admin ? '<div class="col-12 text-end"><button class="btn btn-primary px-4">Salvar alterações</button></div>' : '<div class="col-12 text-muted fs-7">Somente o administrador pode alterar estes dados.</div>'}
        </form>
      </div></div></div>

      <!-- ===== Logo e documentos ===== -->
      <div class="tab-pane fade" id="tMarca"><div class="card"><div class="card-body">
        <form id="fMarca" class="row g-4" novalidate>
          <div class="col-lg-5">
            <label class="form-label">Logo da clínica</label>
            <div class="d-flex align-items-center gap-3">
              <div class="logo-preview" id="logoPrev">${logo ? `<img src="${logo}" alt="Logo">` : '<span class="text-muted fs-8 text-center px-2">Sem logo</span>'}</div>
              <div class="d-flex flex-column gap-2">
                <label class="btn btn-soft btn-sm ${admin ? '' : 'disabled'}"><i class="bi bi-upload me-1"></i>Enviar logo<input type="file" accept="image/png,image/jpeg,image/webp" id="logoInput" hidden ${dis}></label>
                <button type="button" class="btn btn-light border btn-sm" id="logoRemover" ${logo && admin ? '' : 'disabled'}><i class="bi bi-trash me-1"></i>Remover</button>
              </div>
            </div>
            <div class="text-muted fs-8 mt-2">PNG com fundo transparente fica melhor. A imagem é otimizada automaticamente e aparece em receitas, atestados, prontuários e na carteira de vacinação.</div>
          </div>
          <div class="col-lg-7 row g-3 m-0 p-0">
            <div class="col-md-8"><label class="form-label">Responsável técnico</label><input class="form-control" name="responsavel" value="${esc(c.responsavel || '')}" placeholder="Dra. Ana Souza" ${dis}></div>
            <div class="col-md-4"><label class="form-label">CRMV do responsável</label><input class="form-control" name="responsavelCrmv" value="${esc(c.responsavelCrmv || '')}" placeholder="SP-12345" ${dis}></div>
            <div class="col-md-4"><label class="form-label">Cor dos documentos</label><input type="color" class="form-control" name="corDocumentos" value="${esc(c.corDocumentos || '#6c5ce7')}" ${dis}></div>
            <div class="col-md-8"><label class="form-label">Rodapé dos documentos</label><input class="form-control" name="rodape" value="${esc(c.rodape || '')}" placeholder="Atendimento 24h · (11) 99999-9999 · @suaclinica" ${dis}></div>
          </div>
          <div class="col-12 d-flex gap-2 justify-content-end flex-wrap">
            <button type="button" class="btn btn-light border" id="btnPreview"><i class="bi bi-eye me-1"></i>Pré-visualizar receita</button>
            ${admin ? '<button class="btn btn-primary px-4">Salvar identidade visual</button>' : ''}
          </div>
        </form>
      </div></div></div>

      <!-- ===== Equipe ===== -->
      <div class="tab-pane fade" id="tEquipe"><div class="card">
        <div class="card-header d-flex justify-content-between align-items-center"><span id="equipeInfo">Equipe</span>
          ${admin ? '<button class="btn btn-primary btn-sm" id="btnMembro"><i class="bi bi-person-plus me-1"></i>Adicionar membro</button>' : ''}</div>
        <div class="table-responsive"><table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Status</th>${admin ? '<th class="text-end">Ações</th>' : ''}</tr></thead><tbody id="tbEquipe"></tbody></table></div>
      </div></div>

      <!-- ===== Meu perfil ===== -->
      <div class="tab-pane fade" id="tPerfil"><div class="card"><div class="card-body">
        <form id="fPerfil" class="row g-3" style="max-width:640px" novalidate>
          <div class="col-md-8"><label class="form-label">Nome (sai na assinatura dos documentos)</label><input class="form-control" name="nome" required value="${esc(state.perfil.nome || '')}"></div>
          <div class="col-md-4"><label class="form-label">CRMV</label><input class="form-control" name="crmv" value="${esc(state.perfil.crmv || '')}" placeholder="SP-12345"></div>
          <div class="col-12"><label class="form-label">E-mail de acesso</label><input class="form-control" value="${esc(state.user.email)}" readonly></div>
          <div class="col-12"><button class="btn btn-primary">Salvar perfil</button></div>
        </form>
      </div></div></div>

      <!-- ===== Dados ===== -->
      ${admin ? `<div class="tab-pane fade" id="tDados">
        <div class="card mb-3"><div class="card-body">
          <h5 class="fw-bold mb-1"><i class="bi bi-receipt-cutoff text-primary me-1"></i>Integração fiscal</h5>
          <p class="text-muted mb-3">Deixe os dados fiscais prontos para conectar um provedor de NF-e, NFC-e ou NFS-e. Tokens, certificados A1 e senhas devem ficar no Secret Manager, nunca no navegador.</p>
          <button class="btn btn-outline-primary" id="btnFiscalConfig"><i class="bi bi-sliders me-1"></i>Configurar dados fiscais</button>
        </div></div>
        <div class="card mb-3"><div class="card-body">
          <h5 class="fw-bold mb-1"><i class="bi bi-shield-check text-success me-1"></i>Privacidade e LGPD</h5>
          <p class="text-muted mb-3">Exporte os dados da clínica em formato portátil para atender solicitações de acesso e mantenha o uso de dados limitado à operação do Petzy.</p>
          <button class="btn btn-outline-success" id="btnExportarLGPD"><i class="bi bi-file-earmark-lock me-1"></i>Exportar dados da clínica (JSON)</button>
        </div></div>
        <div class="card mb-3"><div class="card-body">
          <h5 class="fw-bold mb-1"><i class="bi bi-cloud-arrow-up text-primary me-1"></i>Migrar dados de outro sistema</h5>
          <p class="text-muted mb-3">Importe tutores, pets, produtos ou fornecedores por CSV. O arquivo original não é alterado e cada registro recebe a marca de origem da importação.</p>
          <button class="btn btn-primary" id="btnImportar"><i class="bi bi-upload me-1"></i>Importar CSV</button>
        </div></div>
        <div class="card mb-3"><div class="card-body">
          <h5 class="fw-bold mb-1"><i class="bi bi-magic text-primary me-1"></i>Dados de exemplo</h5>
          <p class="text-muted mb-3">Tutores, pets, produtos, serviços, agenda da semana, prontuários, vacinas, vendas e financeiro dos últimos meses.
          Tudo o que é gerado aqui fica <strong>marcado como exemplo</strong> e pode ser removido depois sem afetar seus dados reais.</p>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-gradient" id="btnDemo"><i class="bi bi-magic me-1"></i>Gerar dados de exemplo</button>
            <button class="btn btn-outline-danger" id="btnDemoLimpar"><i class="bi bi-eraser me-1"></i>Remover dados de exemplo</button>
          </div>
        </div></div>
        <div class="card border-danger"><div class="card-body">
          <h5 class="fw-bold text-danger mb-1"><i class="bi bi-exclamation-octagon me-1"></i>Zona de perigo</h5>
          <p class="text-muted mb-3">Apaga <strong>todos</strong> os tutores, pets, agendamentos, prontuários, vacinas, produtos, vendas e lançamentos financeiros desta clínica.
          A equipe, as configurações e a assinatura são mantidas. <strong>Não é possível desfazer.</strong></p>
          <button class="btn btn-danger" id="btnZerar"><i class="bi bi-trash3 me-1"></i>Apagar todos os dados da clínica</button>
        </div></div>
      </div>` : ''}
    </div>`;

  mask($('[name=cnpj]', view), 'cnpj'); mask($('[name=telefone]', view), 'tel');

  // ---------- clínica ----------
  $('#fClinica', view).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.checkValidity()) { f.classList.add('was-validated'); return; }
    if (Number(f.horaFim.value) <= Number(f.horaInicio.value)) return toast('O horário de fechamento deve ser depois da abertura.', 'warning');
    await updateDoc(doc(db, 'clinicas', state.clinicaId), {
      nome: f.nome.value.trim(), cnpj: f.cnpj.value, tipo: f.tipo.value, telefone: f.telefone.value, email: f.email.value.trim(),
      site: f.site.value.trim(), endereco: f.endereco.value.trim(), cidade: f.cidade.value.trim(), uf: f.uf.value,
      config: { ...(c.config || {}), horaInicio: Number(f.horaInicio.value), horaFim: Number(f.horaFim.value) }
    });
    await recarregarClinica();
    toast('Dados da clínica atualizados');
  };

  // ---------- logo e documentos ----------
  const desenharLogo = () => {
    $('#logoPrev', view).innerHTML = logo ? `<img src="${logo}" alt="Logo">` : '<span class="text-muted fs-8 text-center px-2">Sem logo</span>';
    $('#logoRemover', view).disabled = !logo || !admin;
  };
  $('#logoInput', view).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Envie uma imagem PNG ou JPG.', 'warning');
    try {
      const url = await comprimirImagem(f, 480);
      if (url.length > 350000) return toast('Imagem muito grande mesmo após otimizar. Tente uma versão mais simples do logo.', 'warning');
      logo = url; desenharLogo();
      toast('Logo carregado. Clique em "Salvar identidade visual".', 'info');
    } catch (err) { toast(err.message, 'danger'); }
    e.target.value = '';
  };
  $('#logoRemover', view).onclick = () => { logo = null; desenharLogo(); };

  const dadosMarca = () => {
    const f = $('#fMarca', view);
    return { logo, responsavel: f.responsavel.value.trim(), responsavelCrmv: f.responsavelCrmv.value.trim(), corDocumentos: f.corDocumentos.value, rodape: f.rodape.value.trim() };
  };
  let logoSalvo = c.logo || null;
  $('#fMarca', view).onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Salvando...'; }
    try {
      const dados = dadosMarca();
      if (logo !== logoSalvo) Object.assign(dados, await salvarLogo(logo));
      await updateDoc(doc(db, 'clinicas', state.clinicaId), dados);
      await recarregarClinica();
      logo = logoSalvo = state.clinica.logo || null;
      toast(dados.logoArmazenamento === 'firestore'
        ? 'Identidade visual salva. (O Firebase Storage não está ativo no projeto, então a logo foi guardada no banco de dados.)'
        : 'Identidade visual salva. Ela já aparece nos documentos.', dados.logoArmazenamento === 'firestore' ? 'info' : 'success');
    } catch (err) { toast(err.message, 'danger'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Salvar identidade visual'; } }
  };
  $('#btnPreview', view).onclick = () => previsualizar(D.receita({
    clinica: { ...state.clinica, ...dadosMarca() },
    pet: { nome: 'Thor', especie: 'Cão', raca: 'Golden Retriever', sexo: 'Macho', castrado: true, peso: 32.4, nascimento: '2020-03-10', pelagem: 'Dourada' },
    tutor: { nome: 'Ana Beatriz Souza', cpf: '123.456.789-00', telefone: '(11) 98765-4321', endereco: 'Rua das Flores', numero: '120', cidade: state.clinica.cidade, uf: state.clinica.uf },
    vet: { nome: state.perfil.nome, crmv: state.perfil.crmv },
    itens: [
      { medicamento: 'Amoxicilina + clavulanato de potássio', concentracao: '250 mg', quantidade: '1 caixa (14 comp.)', via: 'Oral', posologia: 'Administrar 1 comprimido a cada 12 horas, por 7 dias.', uso: 'interno' },
      { medicamento: 'Meloxicam', concentracao: '2 mg', quantidade: '1 caixa', via: 'Oral', posologia: 'Administrar 1 comprimido a cada 24 horas, por 4 dias, após alimentação.', uso: 'interno' },
      { medicamento: 'Otológico (Otomax)', concentracao: '', quantidade: '1 frasco', via: 'Otológica', posologia: 'Aplicar 5 gotas no ouvido direito a cada 12 horas, por 10 dias.', uso: 'externo' }
    ],
    obs: 'Retorno em 10 dias para reavaliação. Em caso de vômito ou diarreia, suspender e entrar em contato.'
  }), 'Receita de exemplo');

  // ---------- perfil ----------
  $('#fPerfil', view).onsubmit = async (e) => {
    e.preventDefault();
    const d = { nome: e.target.nome.value.trim(), crmv: e.target.crmv.value.trim() };
    if (!d.nome) return toast('Informe seu nome.', 'warning');
    await updateDoc(doc(db, 'usuarios', state.user.uid), d);
    await updateDoc(doc(db, 'clinicas', state.clinicaId, 'equipe', state.user.uid), d).catch(() => {});
    Object.assign(state.perfil, d);
    $('#userName').textContent = d.nome;
    toast('Perfil atualizado');
  };

  // ---------- equipe ----------
  let equipe = [];
  const limite = PLANOS[c.plano]?.usuarios ?? 2;

  async function carregarEquipe() {
    equipe = await list('equipe');
    const ativos = equipe.filter(m => m.ativo).length;
    $('#equipeInfo', view).innerHTML = `Equipe <span class="text-muted fw-normal fs-7">· ${ativos} de ${limite >= 99 ? 'ilimitados' : limite} usuários do plano</span>`;
    $('#tbEquipe', view).innerHTML = equipe.map(m => `<tr>
      <td><div class="d-flex align-items-center gap-2"><span class="avatar">${initials(m.nome)}</span><span class="fw-semibold">${esc(m.nome)}</span>${m.id === state.user.uid ? badge('você', 'primary') : ''}</div></td>
      <td class="fs-7">${esc(m.email)}</td><td class="fs-7">${PAPEIS[m.papel] || esc(m.papel)}</td>
      <td>${m.ativo ? badge('ativo', 'success') : badge('inativo', 'secondary')}</td>
      ${admin ? `<td class="text-end text-nowrap">${m.id === c.ownerUid ? '<span class="text-muted fs-8">proprietário</span>' : `
        <button class="btn btn-sm btn-light border" data-papel="${m.id}">Função</button>
        <button class="btn btn-sm btn-light border" data-modulos="${m.id}"><i class="bi bi-grid-3x3-gap me-1"></i>Módulos</button>
        <button class="btn btn-sm ${m.ativo ? 'btn-outline-danger' : 'btn-outline-success'}" data-toggle="${m.id}">${m.ativo ? 'Desativar' : 'Reativar'}</button>`}</td>` : ''}
    </tr>`).join('');
  }

  async function atualizarMembro(uid, patch) {
    await updateDoc(doc(db, 'usuarios', uid), patch);
    await updateDoc(doc(db, 'clinicas', state.clinicaId, 'equipe', uid), patch);
    await carregarEquipe();
  }

  if (admin) {
    $('#btnFiscalConfig', view).onclick = () => {
      const fiscal = c.fiscal || {};
      formModal({
        title: 'Configuração fiscal', size: 'lg', values: { ambiente: 'homologacao', serieNfe: '1', serieNfce: '1', serieNfse: '1', ...fiscal },
        fields: [
          { type: 'section', label: 'Provedor e ambiente' },
          { name: 'provedor', label: 'Provedor fiscal', type: 'select', options: [
            { value: '', label: 'Ainda não definido' },
            { value: 'nuvemfiscal', label: 'Nuvem Fiscal' },
            { value: 'focusnfe', label: 'Focus NFe' },
            { value: 'plugnotas', label: 'PlugNotas' },
            { value: 'tecnospeed', label: 'TecnoSpeed' },
            { value: 'enotas', label: 'eNotas' },
            { value: 'webmaniabr', label: 'WebmaniaBR' },
            { value: 'oobj', label: 'Oobj' },
            { value: 'sefaz', label: 'SEFAZ direto' },
            { value: 'prefeitura', label: 'Prefeitura / NFS-e municipal' },
            { value: 'outro', label: 'Outro provedor' }
          ], col: 'col-md-6' },
          { name: 'ambiente', label: 'Ambiente', type: 'select', options: [{ value: 'homologacao', label: 'Homologação / testes' }, { value: 'producao', label: 'Produção' }], col: 'col-md-6' },
          { type: 'section', label: 'Identificação tributária' },
          { name: 'cnpj', label: 'CNPJ do emitente', col: 'col-md-4' },
          { name: 'inscricaoEstadual', label: 'Inscrição estadual', col: 'col-md-4' },
          { name: 'inscricaoMunicipal', label: 'Inscrição municipal', col: 'col-md-4' },
          { name: 'regimeTributario', label: 'Regime tributário', type: 'select', options: [{ value: '', label: 'Selecione' }, { value: 'simples', label: 'Simples Nacional' }, { value: 'normal', label: 'Regime normal' }, { value: 'mei', label: 'MEI' }], col: 'col-md-4' },
          { name: 'codigoMunicipio', label: 'Código IBGE do município', col: 'col-md-4' },
          { name: 'municipio', label: 'Município emissor', col: 'col-md-4' },
          { type: 'section', label: 'Séries dos documentos' },
          { name: 'serieNfe', label: 'Série NF-e', col: 'col-md-4' },
          { name: 'serieNfce', label: 'Série NFC-e', col: 'col-md-4' },
          { name: 'serieNfse', label: 'Série NFS-e', col: 'col-md-4' },
          { type: 'custom', col: 'col-12', html: '<div class="alert alert-warning fs-8 mb-0"><i class="bi bi-lock me-1"></i>A chave da API, o certificado digital e a senha serão configurados posteriormente no backend/Secret Manager.</div>' }
        ],
        onSubmit: async (d) => { await updateDoc(doc(db, 'clinicas', state.clinicaId), { fiscal: d }); Object.assign(c, { fiscal: d }); toast('Dados fiscais salvos'); }
      });
    };

    $('#btnExportarLGPD', view).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const colecoes = Object.fromEntries(await Promise.all(COLECOES.map(async nome => [nome, await list(nome)])));
        baixarJSON(`petzy-lgpd-${toISODate()}.json`, { exportadoEm: new Date().toISOString(), clinica: c, equipe: await list('equipe'), colecoes });
        toast('Exportação LGPD gerada');
      } catch (err) { toast(err.message, 'danger'); }
      finally { b.disabled = false; }
    };

    $('#btnImportar', view).onclick = () => {
      const { el, close } = modal({
        title: 'Migrar dados por CSV', size: 'md',
        body: `<p class="text-muted fs-7">Escolha o tipo de cadastro e um arquivo CSV separado por vírgula ou ponto e vírgula. A primeira linha deve conter os nomes das colunas.</p>
          <label class="form-label">Tipo de cadastro</label><select class="form-select mb-3" id="tipoImportacao">${Object.entries(IMPORTACOES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
          <label class="form-label">Arquivo CSV</label><input class="form-control" type="file" id="arquivoImportacao" accept=".csv,text/csv">
          <div class="form-text mt-2" id="ajudaImportacao"></div><div class="alert alert-warning fs-8 mt-3 mb-0"><i class="bi bi-shield-exclamation me-1"></i>Revise o arquivo e tenha autorização para importar esses dados pessoais.</div>`,
        footer: '<button class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary" id="confirmarImportacao"><i class="bi bi-upload me-1"></i>Importar</button>'
      });
      const tipo = $('#tipoImportacao', el), arquivo = $('#arquivoImportacao', el), ajuda = $('#ajudaImportacao', el), ok = $('#confirmarImportacao', el);
      const atualizarAjuda = () => { const cfg = IMPORTACOES[tipo.value]; ajuda.textContent = `Colunas obrigatórias: ${cfg.required.join(', ')}. ${tipo.value === 'pets' ? 'Use clienteNome para vincular o pet a um tutor já cadastrado.' : ''}`; };
      tipo.onchange = atualizarAjuda; atualizarAjuda();
      ok.onclick = async () => {
        if (!arquivo.files[0]) return toast('Selecione um arquivo CSV.', 'warning');
        ok.disabled = true;
        try {
          const cfg = IMPORTACOES[tipo.value], rows = parseCSV(await lerArquivo(arquivo.files[0]));
          if (rows.length < 2) throw new Error('O CSV precisa ter cabeçalho e pelo menos uma linha.');
          const headers = rows[0].map(chaveCSV), missing = cfg.required.filter(k => !headers.includes(chaveCSV(k)));
          if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(', ')}`);
          const clientesAtuais = tipo.value === 'pets' ? await list('clientes') : [];
          const clientesPorNome = Object.fromEntries(clientesAtuais.map(x => [chaveCSV(x.nome), x.id]));
          const registros = [], erros = [];
          rows.slice(1).forEach((values, index) => {
            const raw = Object.fromEntries(cfg.fields.map(field => [field, values[headers.indexOf(chaveCSV(field))] || '']));
            if (cfg.required.some(field => !String(raw[field] || '').trim())) { erros.push(`linha ${index + 2}: campo obrigatório vazio`); return; }
            if (tipo.value === 'pets') {
              const clienteId = clientesPorNome[chaveCSV(raw.clienteNome)];
              if (!clienteId) { erros.push(`linha ${index + 2}: tutor não encontrado (${raw.clienteNome})`); return; }
              raw.clienteId = clienteId; delete raw.clienteNome;
            }
            ['precoCusto', 'precoVenda', 'estoque', 'estoqueMinimo', 'peso'].forEach(k => { if (k in raw) raw[k] = numeroCSV(raw[k]); });
            if (tipo.value === 'produtos') { raw.tipo = 'produto'; raw.ativo = true; }
            registros.push({ ...raw, demo: false, origemImportacao: 'csv', importadoEm: new Date().toISOString() });
          });
          if (erros.length) throw new Error(`Importação interrompida. ${erros.slice(0, 3).join('; ')}${erros.length > 3 ? '...' : ''}`);
          for (let i = 0; i < registros.length; i += 450) {
            const b = writeBatch(db);
            registros.slice(i, i + 450).forEach(registro => b.set(doc(col(tipo.value)), registro));
            await b.commit();
          }
          toast(`${registros.length} registros importados em ${cfg.label}`); close();
        } catch (err) { toast(err.message, 'danger'); }
        finally { ok.disabled = false; }
      };
    };

    $('#btnMembro', view).onclick = () => {
      if (!exigirLicenca()) return;
      if (equipe.filter(m => m.ativo).length >= limite) return toast(`Seu plano permite ${limite} usuários. Faça upgrade em Assinatura.`, 'warning');
      formModal({
        title: 'Adicionar membro da equipe', size: 'md', submit: 'Criar acesso',
        fields: [
          { name: 'nome', label: 'Nome', required: true, col: 'col-12' },
          { name: 'email', label: 'E-mail', type: 'email', required: true, col: 'col-12' },
          { name: 'senha', label: 'Senha provisória', type: 'text', required: true, col: 'col-md-6', attrs: 'minlength="6"', default: Math.random().toString(36).slice(2, 10) },
          { name: 'papel', label: 'Função', type: 'select', required: true, options: Object.entries(PAPEIS).map(([v, l]) => ({ value: v, label: l })), col: 'col-md-6', default: 'recepcao' },
          { type: 'custom', col: 'col-12', html: '<div class="alert alert-info fs-7 mb-0">Envie o e-mail e a senha provisória ao colaborador. Ele pode trocar a senha em "Esqueci minha senha".</div>' }
        ],
        onSubmit: async (d) => {
          // instância secundária do Firebase: cria o usuário sem deslogar o admin
          const sec = initializeApp(firebaseConfig, 'sec-' + Date.now());
          try {
            const sAuth = getAuth(sec);
            if (emulador) connectAuthEmulator(sAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
            const { user } = await createUserWithEmailAndPassword(sAuth, d.email, d.senha);
            await signOut(sAuth);
            const perfil = { nome: d.nome, email: d.email, papel: d.papel, ativo: true, criadoEm: new Date().toISOString() };
            await setDoc(doc(db, 'usuarios', user.uid), { ...perfil, clinicaId: state.clinicaId });
            await setDoc(doc(db, 'clinicas', state.clinicaId, 'equipe', user.uid), perfil);
            toast(`${d.nome} adicionado(a) à equipe`);
            await carregarEquipe();
          } catch (e) {
            if (e.code === 'auth/email-already-in-use') throw new Error('Este e-mail já tem conta no Petzy.');
            throw e;
          } finally { deleteApp(sec); }
        }
      });
    };

    $('#tbEquipe', view).onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const m = equipe.find(x => x.id === (b.dataset.papel || b.dataset.modulos || b.dataset.toggle));
      if (b.dataset.toggle) {
        if (!m.ativo && equipe.filter(x => x.ativo).length >= limite) return toast('Limite de usuários do plano atingido.', 'warning');
        if (m.ativo && !(await confirmar(`Desativar o acesso de <strong>${esc(m.nome)}</strong>?`))) return;
        await atualizarMembro(m.id, { ativo: !m.ativo }); toast('Acesso atualizado');
      }
      if (b.dataset.papel) formModal({
        title: `Função de ${esc(m.nome)}`, size: 'sm', values: m,
        fields: [{ name: 'papel', label: 'Função', type: 'select', required: true, options: Object.entries(PAPEIS).map(([v, l]) => ({ value: v, label: l })), col: 'col-12' }],
        onSubmit: async (d) => { await atualizarMembro(m.id, { papel: d.papel }); toast('Função alterada'); }
      });
      if (b.dataset.modulos) {
        const labels = {
          dashboard: 'Dashboard', agenda: 'Agenda', clientes: 'Tutores', pets: 'Pets', prontuarios: 'Prontuários',
          vacinas: 'Vacinas', pdv: 'PDV / Vendas', produtos: 'Produtos & Serviços', fornecedores: 'Fornecedores',
          financeiro: 'Financeiro', fiscal: 'Fiscal', relatorios: 'Relatórios', configuracoes: 'Configurações'
        };
        const extras = m.modulosExtras || [], bloqueados = m.modulosBloqueados || [];
        formModal({
          title: `Módulos · ${esc(m.nome)}`, size: 'lg', submit: 'Salvar módulos',
          fields: MODULOS.map(k => ({
            name: `mod_${k}`, label: labels[k] || k, type: 'select', col: 'col-md-6',
            options: [{ value: '', label: 'Padrão da função' }, { value: 'liberado', label: 'Liberado' }, { value: 'bloqueado', label: 'Bloqueado' }],
            default: extras.includes(k) ? 'liberado' : bloqueados.includes(k) ? 'bloqueado' : ''
          })),
          onSubmit: async (d) => {
            const modulosExtras = MODULOS.filter(k => d[`mod_${k}`] === 'liberado');
            const modulosBloqueados = MODULOS.filter(k => d[`mod_${k}`] === 'bloqueado');
            await atualizarMembro(m.id, { modulosExtras, modulosBloqueados });
            toast('Módulos atualizados');
          }
        });
      }
    };

    // ---------- dados ----------
    const ocupado = (btn, txt) => { btn.disabled = true; btn.dataset.html = btn.innerHTML; btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${txt}`; };
    const livre = (btn) => { btn.disabled = false; btn.innerHTML = btn.dataset.html; };

    $('#btnDemo', view).onclick = async (e) => {
      const b = e.currentTarget; // capturar antes de qualquer await (depois vira null)
      if (!exigirLicenca()) return;
      const jaTem = (await list('clientes', where('demo', '==', true))).length;
      if (jaTem && !(await confirmar('Esta clínica já tem dados de exemplo. Gerar mais um conjunto?', { ok: 'Gerar', danger: false }))) return;
      if (!jaTem && !(await confirmar('Gerar dados de exemplo nesta clínica? Você poderá removê-los depois.', { ok: 'Gerar', danger: false }))) return;
      ocupado(b, 'Gerando...');
      try { const n = await gerarDemo(); toast(`${n} registros de exemplo criados 🎉`); location.hash = '#/dashboard'; }
      catch (err) { toast(err.message, 'danger'); livre(b); }
    };

    $('#btnDemoLimpar', view).onclick = async (e) => {
      if (!exigirLicenca()) return;
      const b = e.currentTarget; ocupado(b, 'Verificando...');
      try {
        const contagem = await Promise.all(COLECOES.map(n => list(n, where('demo', '==', true)).then(r => r.length)));
        const total = contagem.reduce((s, n) => s + n, 0);
        livre(b);
        if (!total) return toast('Não há dados de exemplo marcados. Dados gerados antes desta versão podem ser apagados na Zona de perigo.', 'info');
        if (!(await confirmar(`Remover <strong>${total}</strong> registros de exemplo? Seus dados reais não serão afetados.`, { ok: 'Remover' }))) return;
        ocupado(b, 'Removendo...');
        await apagar(true, (t) => { b.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Removendo... ${t}/${total}`; });
        toast('Dados de exemplo removidos');
        livre(b);
      } catch (err) { toast(err.message, 'danger'); livre(b); }
    };

    $('#btnZerar', view).onclick = () => {
      if (!exigirLicenca()) return;
      const { el, close } = modal({
        title: '<span class="text-danger"><i class="bi bi-exclamation-octagon me-1"></i>Apagar todos os dados</span>', size: 'md',
        body: `<p>Esta ação apaga <strong>definitivamente</strong> todos os tutores, pets, agendamentos, prontuários, vacinas, produtos, vendas e lançamentos financeiros de <strong>${esc(c.nome)}</strong>.</p>
          <label class="form-label">Para confirmar, digite <strong>APAGAR</strong>:</label><input class="form-control" id="confZerar" autocomplete="off">`,
        footer: '<button class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-danger" id="okZerar" disabled>Apagar tudo</button>'
      });
      const inp = $('#confZerar', el), ok = $('#okZerar', el);
      inp.oninput = () => { ok.disabled = inp.value.trim().toUpperCase() !== 'APAGAR'; };
      ok.onclick = async () => {
        ok.disabled = true; inp.disabled = true;
        try {
          await apagar(false, (t) => { ok.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${t} apagados...`; });
          toast('Todos os dados operacionais foram apagados');
          close(); location.hash = '#/dashboard';
        } catch (err) { toast(err.message, 'danger'); ok.disabled = false; inp.disabled = false; ok.textContent = 'Apagar tudo'; }
      };
    };
  }

  await carregarEquipe();
}

// Logo vai para o Firebase Storage (clinicas/{id}/marca/logo). Se o Storage não estiver
// habilitado no projeto, cai para o próprio documento da clínica (data URL otimizado).
async function salvarLogo(valor) {
  const r = sRef(storage, `clinicas/${state.clinicaId}/marca/logo`);
  if (!valor) {
    await deleteObject(r).catch(() => {});
    return { logo: null, logoArmazenamento: null };
  }
  try {
    const blob = await (await fetch(valor)).blob();
    await uploadBytes(r, blob, { contentType: blob.type || 'image/png', cacheControl: 'public,max-age=86400' });
    return { logo: await getDownloadURL(r), logoArmazenamento: 'storage' };
  } catch (e) {
    console.warn('Storage indisponível; salvando logo no Firestore.', e);
    return { logo: valor, logoArmazenamento: 'firestore' };
  }
}

// Apaga em lotes de 400 (limite do Firestore é 500 operações por lote)
async function apagar(soDemo, progresso) {
  let total = 0;
  for (const nome of COLECOES) {
    const docs = soDemo ? await list(nome, where('demo', '==', true)) : await list(nome);
    for (let i = 0; i < docs.length; i += 400) {
      const b = writeBatch(db);
      docs.slice(i, i + 400).forEach(d => b.delete(ref(nome, d.id)));
      await b.commit();
      total += Math.min(400, docs.length - i);
      progresso?.(total);
    }
  }
  return total;
}

// ================= Dados de demonstração (todos marcados com demo: true) =================
async function gerarDemo() {
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const agora = new Date().toISOString();
  const ops = [];
  const novo = (name, data) => { const r = doc(col(name)); ops.push([r, { ...data, demo: true, criadoEm: data.criadoEm || agora }]); return r.id; };

  const nomes = ['Ana Beatriz Souza', 'Carlos Eduardo Lima', 'Fernanda Oliveira', 'João Pedro Santos', 'Mariana Costa', 'Rafael Almeida', 'Juliana Ferreira', 'Lucas Martins', 'Patrícia Rocha', 'Bruno Carvalho', 'Camila Ribeiro', 'Diego Nascimento'];
  const pets = [['Thor', 'Cão', 'Golden Retriever'], ['Luna', 'Gato', 'Siamês'], ['Mel', 'Cão', 'Shih Tzu'], ['Bob', 'Cão', 'SRD'], ['Nina', 'Gato', 'Persa'], ['Max', 'Cão', 'Labrador'], ['Pipoca', 'Cão', 'Poodle'], ['Frida', 'Gato', 'SRD'], ['Zeus', 'Cão', 'Bulldog Francês'], ['Amora', 'Cão', 'Yorkshire'], ['Simba', 'Gato', 'Maine Coon'], ['Bidu', 'Cão', 'Beagle'], ['Kiara', 'Cão', 'Lhasa Apso'], ['Tom', 'Gato', 'SRD'], ['Paçoca', 'Cão', 'Pinscher'], ['Loki', 'Cão', 'Border Collie']];

  const cIds = nomes.map(n => novo('clientes', { nome: n, telefone: `(11) 9${rint(8000, 9999)}-${rint(1000, 9999)}`, email: n.split(' ')[0].toLowerCase() + '@exemplo.com', cidade: 'São Paulo', uf: 'SP', criadoEm: toISODate(addDays(new Date(), -rint(1, 120))) }));
  const pIds = pets.map(([nome, especie, raca], i) => ({
    id: novo('pets', { nome, especie, raca, clienteId: cIds[i % cIds.length], sexo: rnd(['Macho', 'Fêmea']), peso: especie === 'Gato' ? rint(3, 6) : rint(4, 32), nascimento: toISODate(addDays(new Date(), -rint(200, 4000))), castrado: Math.random() > 0.4 }),
    cid: cIds[i % cIds.length]
  }));

  const prods = [['Ração Premium Cães 15kg', 'Ração', 189.9, 132, 12], ['Ração Gatos Castrados 10kg', 'Ração', 159.9, 110, 8], ['Petisco Bifinho 500g', 'Petiscos', 29.9, 15, 30], ['Shampoo Neutro 500ml', 'Higiene', 34.9, 17, 3], ['Antipulgas Comprimido', 'Farmácia', 89.9, 55, 20], ['Vermífugo 4 comp.', 'Farmácia', 39.9, 21, 25], ['Coleira Antipulgas', 'Acessórios', 69.9, 38, 2], ['Brinquedo Mordedor', 'Brinquedos', 24.9, 9, 18]]
    .map(([nome, categoria, precoVenda, precoCusto, estoque]) => ({ id: novo('produtos', { nome, categoria, precoVenda, precoCusto, estoque, estoqueMinimo: 5, unidade: 'un', tipo: 'produto', ativo: true }), nome, precoVenda, precoCusto }));
  const servs = [['Consulta clínica', 'Consulta', 150, 30], ['Retorno', 'Consulta', 0, 20], ['Vacina V10', 'Vacina', 120, 15], ['Vacina Antirrábica', 'Vacina', 80, 15], ['Banho - porte pequeno', 'Banho', 60, 60], ['Banho & Tosa - porte médio', 'Tosa', 110, 90], ['Hemograma completo', 'Exame', 90, 20], ['Castração felina', 'Cirurgia', 450, 120]]
    .map(([nome, categoria, precoVenda, duracao]) => ({ id: novo('produtos', { nome, categoria, precoVenda, duracao, tipo: 'servico', ativo: true }), nome, precoVenda, categoria }));

  const tipoMap = { Consulta: 'consulta', Vacina: 'vacina', Banho: 'banho', Tosa: 'tosa', Exame: 'exame', Cirurgia: 'cirurgia' };
  for (let i = 0; i < 22; i++) {
    const d = addDays(new Date(), rint(-3, 4)); d.setHours(rint(8, 17), rnd([0, 30]), 0, 0);
    const s = rnd(servs), p = rnd(pIds), passado = d < new Date();
    novo('agendamentos', { petId: p.id, clienteId: p.cid, tipo: tipoMap[s.categoria] || 'consulta', servicoId: s.id, inicio: toISODateTime(d), duracao: 30, valor: s.precoVenda, profissionalId: state.user.uid, status: passado ? rnd(['concluido', 'concluido', 'concluido', 'faltou']) : rnd(['agendado', 'confirmado']) });
  }

  const casos = [
    { diagnostico: 'Otite externa bacteriana', queixa: 'Coçando a orelha direita e balançando a cabeça há 5 dias', receita: [{ medicamento: 'Otológico (Otomax)', quantidade: '1 frasco', via: 'Otológica', posologia: 'Aplicar 5 gotas no ouvido direito a cada 12 horas, por 10 dias.' }] },
    { diagnostico: 'Dermatite alérgica', queixa: 'Prurido intenso e vermelhidão na barriga', receita: [{ medicamento: 'Oclacitinib (Apoquel)', concentracao: '5,4 mg', quantidade: '1 caixa', via: 'Oral', posologia: 'Administrar 1 comprimido a cada 12 horas por 14 dias, depois 1 vez ao dia.' }] },
    { diagnostico: 'Gastroenterite aguda', queixa: 'Vômito e diarreia desde ontem', receita: [{ medicamento: 'Ondansetrona', concentracao: '4 mg', quantidade: '1 caixa', via: 'Oral', posologia: 'Administrar 1/2 comprimido a cada 12 horas, por 3 dias.' }, { medicamento: 'Probiótico', quantidade: '1 bisnaga', via: 'Oral', posologia: 'Administrar 2 g uma vez ao dia, por 5 dias.' }] },
    { diagnostico: 'Check-up anual, paciente saudável', queixa: 'Consulta de rotina', receita: [] }
  ];
  pIds.slice(0, 10).forEach(p => {
    const k = rnd(casos);
    novo('atendimentos', {
      petId: p.id, clienteId: p.cid, tipo: 'Consulta', data: toISODateTime(addDays(new Date(), -rint(1, 90))), queixa: k.queixa, diagnostico: k.diagnostico,
      temperatura: 38.5, fc: rint(80, 120), fr: rint(18, 30), tpc: 2, mucosas: 'Normocoradas', hidratacao: 'Normal', escore: 5,
      exameSistemas: { tegumentar: { status: 'Normal', obs: '' }, cardio: { status: 'Normal', obs: '' }, resp: { status: 'Normal', obs: '' } },
      receita: k.receita.map(i => ({ farmacia: 'Veterinária', concentracao: '', ...i, uso: D.usoDaVia(i.via) })),
      vetId: state.user.uid, vetNome: state.perfil.nome, vetCrmv: state.perfil.crmv || ''
    });
    const apl = addDays(new Date(), -rint(200, 380));
    novo('vacinas', { petId: p.id, nome: rnd(['V10 (Polivalente)', 'Antirrábica', 'V4 Felina']), dose: 'Reforço anual', dataAplicacao: toISODate(apl), proximaDose: toISODate(addDays(apl, 365)), fabricante: 'Zoetis', lote: 'L' + rint(10000, 99999), veterinario: state.perfil.nome });
  });

  for (let i = 0; i < 60; i++) {
    const d = addDays(new Date(), -rint(0, 170)), it = rnd(prods), qtd = rint(1, 3), total = it.precoVenda * qtd, pag = rnd(['PIX', 'PIX', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro']);
    const vid = novo('vendas', { itens: [{ id: it.id, nome: it.nome, tipo: 'produto', preco: it.precoVenda, custo: it.precoCusto, qtd }], clienteId: rnd(cIds), total, subtotal: total, desconto: 0, pagamento: pag, status: 'concluida', data: d.toISOString().slice(0, 19), vendedor: state.perfil.nome });
    novo('financeiro', { tipo: 'receita', categoria: 'Vendas PDV', descricao: `Venda PDV #${vid.slice(0, 6).toUpperCase()}`, valor: total, vencimento: toISODate(d), pago: true, pagoEm: toISODate(d), formaPagamento: pag, origem: 'venda', origemId: vid });
  }
  for (let m = 0; m < 6; m++) {
    const base = new Date(); base.setMonth(base.getMonth() - m, 5);
    const pago = m > 0 || new Date().getDate() >= 5;
    [['Aluguel', 'Aluguel', 3500], ['Salários', 'Salários', 8200], ['Energia / Água', 'Energia / Água', rint(600, 900)], ['Fornecedores', 'Compra de ração e medicamentos', rint(2500, 4500)]]
      .forEach(([categoria, descricao, valor]) => novo('financeiro', { tipo: 'despesa', categoria, descricao, valor, vencimento: toISODate(base), pago, pagoEm: pago ? toISODate(base) : null, formaPagamento: 'Boleto' }));
    for (let k = 0; k < rint(25, 40); k++) {
      const d = new Date(base); d.setDate(rint(1, 28)); if (d > new Date()) continue;
      const s = rnd(servs.filter(x => x.precoVenda));
      novo('financeiro', { tipo: 'receita', categoria: ['Banho', 'Tosa'].includes(s.categoria) ? 'Banho & Tosa' : 'Serviços clínicos', descricao: s.nome, valor: s.precoVenda, vencimento: toISODate(d), pago: true, pagoEm: toISODate(d), formaPagamento: rnd(['PIX', 'Cartão de crédito', 'Dinheiro']) });
    }
  }

  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(([r, d]) => b.set(r, d));
    await b.commit();
  }
  return ops.length;
}

import { state, list, ref, where, PAPEIS, PLANOS, MODULOS, db, writeBatch, col } from '../store.js';
import {
  doc, setDoc, updateDoc, initializeApp, deleteApp, getAuth, createUserWithEmailAndPassword, signOut, firebaseConfig,
  storage, ref as sRef, uploadBytes, getDownloadURL, deleteObject, emulador, connectAuthEmulator, chamarFuncao
} from '../firebase.js';
import { $, esc, pageHeader, formModal, toast, confirmar, modal, initials, badge, mask, toISODate, toISODateTime, addDays, comprimirImagem, num } from '../ui.js';
import { recarregarClinica, exigirLicenca } from '../app.js';
import { previsualizar } from '../documentos.js';
import { NCM_SUGERIDO } from '../fiscalDados.js';
import { atualizarTabela as atualizarTabelaNcm, garantirCache as garantirCacheNcm } from '../ncm.js';
import * as D from '../docs.js';

// coleções operacionais (ordem: dependentes primeiro)
const COLECOES = ['agendamentos', 'atendimentos', 'vacinas', 'vendas', 'financeiro', 'movimentacoes', 'modelosReceita', 'pets', 'clientes', 'produtos', 'fornecedores', 'fiscal', 'solicitacoesPortal', 'internacoes', 'campanhas'];
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
          <p class="text-muted mb-3">Emita NFS-e pelo Petzy com a TecnoSpeed. Comece no <strong>modo teste</strong> (sem valor fiscal) e passe para produção quando a clínica estiver cadastrada com o certificado digital. O token de acesso é da plataforma e fica protegido no servidor.</p>
          <div class="d-flex gap-2 flex-wrap"><button class="btn btn-outline-primary" id="btnFiscalConfig"><i class="bi bi-sliders me-1"></i>Configurar dados fiscais</button>
          <button class="btn btn-light border" id="btnFiscalVerificar"><i class="bi bi-plug me-1"></i>Verificar conexão</button></div>
        </div></div>
        <div class="card mb-3"><div class="card-body">
          <h5 class="fw-bold mb-1"><i class="bi bi-phone text-primary me-1"></i>Portal do tutor</h5>
          <p class="text-muted mb-3">Envie este link para os tutores: eles entram com telefone e CPF e veem o histórico, as vacinas e os próximos agendamentos do pet, além de poderem pedir um horário sem ligar. Os pedidos aparecem na sua Agenda.</p>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <input class="form-control" id="portalLink" readonly style="max-width:420px">
            <button class="btn btn-outline-primary" id="btnPortalCopiar"><i class="bi bi-clipboard me-1"></i>Copiar link</button>
            <button class="btn btn-light border" id="btnPortalQr"><i class="bi bi-qr-code me-1"></i>QR Code</button>
            <a class="btn btn-light border" id="btnPortalWhats" target="_blank" rel="noopener"><i class="bi bi-whatsapp text-success me-1"></i>Divulgar no WhatsApp</a>
          </div>
        </div></div>
        <div class="card mb-3"><div class="card-body">
          <h5 class="fw-bold mb-1"><i class="bi bi-calendar-plus text-primary me-1"></i>Agendamento online público</h5>
          <p class="text-muted mb-3">Link para <strong>qualquer pessoa</strong> pedir um horário, mesmo sem ser cliente ainda — ótimo para o Instagram ou o Google. O pedido cai na Agenda para a equipe confirmar o cadastro e o horário.</p>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <input class="form-control" id="agendarLink" readonly style="max-width:420px">
            <button class="btn btn-outline-primary" id="btnAgendarCopiar"><i class="bi bi-clipboard me-1"></i>Copiar link</button>
            <button class="btn btn-light border" id="btnAgendarQr"><i class="bi bi-qr-code me-1"></i>QR Code</button>
            <a class="btn btn-light border" id="btnAgendarWhats" target="_blank" rel="noopener"><i class="bi bi-whatsapp text-success me-1"></i>Divulgar no WhatsApp</a>
          </div>
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
          <h5 class="fw-bold mb-1"><i class="bi bi-upc-scan text-primary me-1"></i>Tabela de NCM</h5>
          <p class="text-muted mb-3">Classificação fiscal usada na NF-e e na NFC-e, direto da fonte oficial (Siscomex/Receita Federal). Fica salva no navegador: a busca funciona offline depois de baixada uma vez.</p>
          <div class="d-flex align-items-center gap-3 flex-wrap">
            <button class="btn btn-primary" id="btnNcmAtualizar"><i class="bi bi-cloud-download me-1"></i>Atualizar tabela de NCM</button>
            <span class="fs-7 text-muted" id="ncmStatus">Verificando...</span>
          </div>
        </div></div>
        <div class="card mb-3"><div class="card-body">
          <h5 class="fw-bold mb-1"><i class="bi bi-magic text-primary me-1"></i>Dados de exemplo</h5>
          <p class="text-muted mb-3">Tutores com CPF e endereço, pets, fornecedores, produtos com dados fiscais (NCM), serviços, compras e contas a pagar, agenda, prontuários, vacinas, vendas, fiado, financeiro e notas fiscais de exemplo.
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
    // async: se o usuário já tiver navegado/deslogado enquanto os updateDoc acima rodavam, o elemento
    // do shell pode não existir mais — não deixa essa atualização cosmética quebrar o resto do fluxo.
    const nomeEl = $('#userName'); if (nomeEl) nomeEl.textContent = d.nome;
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
      ${admin ? `<td class="text-end text-nowrap">
        ${m.id === c.ownerUid ? '<span class="text-muted fs-8 me-2">proprietário</span>' : `
          <button class="btn btn-sm btn-light border" data-papel="${m.id}">Função</button>
          <button class="btn btn-sm btn-light border" data-modulos="${m.id}"><i class="bi bi-grid-3x3-gap me-1"></i>Módulos</button>
          <button class="btn btn-sm ${m.ativo ? 'btn-outline-danger' : 'btn-outline-success'}" data-toggle="${m.id}">${m.ativo ? 'Desativar' : 'Reativar'}</button>`}
        <button class="btn btn-sm btn-light border" data-comissao="${m.id}"><i class="bi bi-percent me-1"></i>${m.comissaoPercentual ? num(m.comissaoPercentual) + '%' : 'Comissão'}</button>
      </td>` : ''}
    </tr>`).join('');
  }

  async function atualizarMembro(uid, patch) {
    await updateDoc(doc(db, 'usuarios', uid), patch);
    await updateDoc(doc(db, 'clinicas', state.clinicaId, 'equipe', uid), patch);
    await carregarEquipe();
  }

  if (admin) {
    // ---------- portal do tutor ----------
    const portalUrl = new URL('portal.html', location.href);
    portalUrl.searchParams.set('c', state.clinicaId);
    $('#portalLink', view).value = portalUrl.toString();
    $('#portalLink', view).scrollLeft = 0; // mostra o começo da URL (o nome do arquivo), não só o "?c=..." final
    $('#btnPortalCopiar', view).onclick = async () => {
      try { await navigator.clipboard.writeText(portalUrl.toString()); } catch { $('#portalLink', view).select(); document.execCommand('copy'); }
      toast('Link copiado');
    };
    $('#btnPortalWhats', view).href = `https://wa.me/?text=${encodeURIComponent(`Olá! Agora você pode acompanhar o histórico e as vacinas do seu pet e pedir um horário pelo nosso portal:\n${portalUrl}\n\nBasta entrar com o telefone e o CPF cadastrados na clínica. 🐾`)}`;
    $('#btnPortalQr', view).onclick = async () => {
      const { qrDataURL } = await import('../pix.js');
      try {
        const img = await qrDataURL(portalUrl.toString());
        modal({ title: 'QR Code do portal', size: 'sm', body: `<div class="text-center"><img src="${img}" style="width:220px;max-width:100%;image-rendering:pixelated" class="border rounded-3 p-2 bg-white mb-2"><div class="fs-7 text-muted">Aponte a câmera do celular para abrir o portal. Vale colocar impresso na recepção.</div></div>` });
      } catch (e) { toast(e.message, 'danger'); }
    };

    // ---------- agendamento online público ----------
    const agendarUrl = new URL('agendar.html', location.href);
    agendarUrl.searchParams.set('c', state.clinicaId);
    $('#agendarLink', view).value = agendarUrl.toString();
    $('#agendarLink', view).scrollLeft = 0;
    $('#btnAgendarCopiar', view).onclick = async () => {
      try { await navigator.clipboard.writeText(agendarUrl.toString()); } catch { $('#agendarLink', view).select(); document.execCommand('copy'); }
      toast('Link copiado');
    };
    $('#btnAgendarWhats', view).href = `https://wa.me/?text=${encodeURIComponent(`Quer marcar um horário na ${state.clinica.nome}? Preencha aqui, sem precisar ligar:\n${agendarUrl}`)}`;
    $('#btnAgendarQr', view).onclick = async () => {
      const { qrDataURL } = await import('../pix.js');
      try {
        const img = await qrDataURL(agendarUrl.toString());
        modal({ title: 'QR Code de agendamento', size: 'sm', body: `<div class="text-center"><img src="${img}" style="width:220px;max-width:100%;image-rendering:pixelated" class="border rounded-3 p-2 bg-white mb-2"><div class="fs-7 text-muted">Ótimo para colocar nas redes sociais ou na vitrine — qualquer pessoa pode pedir um horário sem ligar.</div></div>` });
      } catch (e) { toast(e.message, 'danger'); }
    };

    // Diagnóstico: a clínica está cadastrada na TecnoSpeed? Em produção ou homologação na prefeitura?
    $('#btnFiscalVerificar', view).onclick = async (e) => {
      const b = e.currentTarget;
      if (!['tecnospeed', 'plugnotas'].includes(state.clinica.fiscal?.provedor)) return toast('Escolha "TecnoSpeed / PlugNotas" em Configurar dados fiscais primeiro.', 'warning');
      b.disabled = true; const html = b.innerHTML; b.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Verificando...';
      try {
        const r = await chamarFuncao('verificarEmpresaFiscal', {});
        const linha = (rot, val, cor = '') => `<div class="d-flex justify-content-between py-2 border-bottom"><span class="text-muted">${rot}</span><strong class="${cor}">${val}</strong></div>`;
        const ambientes = { teste: 'Teste (sandbox, sem valor fiscal)', homologacao: 'Homologação', producao: 'Produção' };
        const conflito = r.cadastrada && ((r.ambiente === 'homologacao' && r.producao) || (r.ambiente === 'producao' && !r.producao));
        modal({
          title: `<i class="bi bi-plug me-2 text-primary"></i>Conexão com a TecnoSpeed`, size: 'md',
          body: `${linha('Ambiente no Petzy', ambientes[r.ambiente] || r.ambiente)}
            ${linha('CNPJ emitente', esc(r.cnpj))}
            ${linha('Cadastrada na TecnoSpeed', r.cadastrada ? 'Sim' : 'Não', r.cadastrada ? 'text-success' : 'text-danger')}
            ${r.cadastrada ? linha('Razão social', esc(r.razaoSocial || '—')) + [['nfse', 'NFS-e (serviços)'], ['nfce', 'NFC-e (balcão)'], ['nfe', 'NF-e (produtos)']].map(([t, rot]) => {
              const x = r.tipos?.[t] || {};
              return linha(rot, x.ativo ? (x.producao ? 'Habilitada · produção' : 'Habilitada · homologação') : 'Não habilitada', x.ativo ? 'text-success' : 'text-muted');
            }).join('') : ''}
            <div class="alert alert-${!r.cadastrada || conflito ? 'warning' : 'success'} fs-7 mt-3 mb-0">${
              r.teste ? 'Modo teste: as notas usam a empresa de demonstração da TecnoSpeed e não têm valor fiscal. Tudo pronto para testar.'
              : !r.cadastrada ? 'O CNPJ ainda não está cadastrado na TecnoSpeed. É preciso cadastrar a empresa e o certificado digital A1 antes de emitir.'
              : conflito ? 'O ambiente do Petzy não bate com o da TecnoSpeed. Ajuste um dos dois para evitar emitir no ambiente errado.'
              : 'Conexão OK. A clínica já pode emitir NFS-e.'}</div>`
        });
      } catch (err) {
        toast(err.code === 'functions/internal' && err.message === 'internal' ? 'O serviço fiscal está indisponível no momento.' : err.message, 'danger');
      } finally { b.disabled = false; b.innerHTML = html; }
    };

    $('#btnFiscalConfig', view).onclick = () => {
      const fiscal = c.fiscal || {};
      const TRIBUTACAO = [
        { value: 6, label: 'Tributável dentro do município' }, { value: 7, label: 'Tributável fora do município' },
        { value: 5, label: 'ISS retido pelo tomador' }, { value: 1, label: 'Isento de ISS' }, { value: 2, label: 'Imune' }
      ];
      const INFO_AMBIENTE = {
        teste: 'As notas são geradas no sandbox da TecnoSpeed com uma empresa de demonstração. Não têm valor fiscal: ideal para conhecer e testar o fluxo.',
        homologacao: 'Notas enviadas à prefeitura em ambiente de homologação (sem valor fiscal). Exige a clínica cadastrada na TecnoSpeed com certificado.',
        producao: '<strong class="text-danger">Notas com valor fiscal.</strong> Use somente depois de validar tributação e dados com o contador.'
      };
      formModal({
        title: 'Configuração fiscal', size: 'lg',
        values: {
          ambiente: 'teste', serieNfe: '1', serieNfce: '1', serieNfse: '1', codigoServico: '05.01', cnae: '7500100', tipoTributacao: 6, cnpj: c.cnpj || '',
          regimeTributario: 'simples', cfopPadrao: '5102', csosnPadrao: '102', cstPisCofins: '49',
          ...fiscal, provedor: fiscal.provedor === 'plugnotas' ? 'tecnospeed' : (fiscal.provedor || '')
        },
        fields: [
          { type: 'section', label: 'Provedor e ambiente' },
          { name: 'provedor', label: 'Provedor fiscal', type: 'select', options: [
            { value: 'tecnospeed', label: 'TecnoSpeed / PlugNotas · emissão integrada' },
            { value: 'externo', label: 'Outro provedor (registro manual das notas)' }
          ], col: 'col-md-6' },
          { name: 'ambiente', label: 'Ambiente', type: 'select', required: true, options: [
            { value: 'teste', label: 'Teste · sem valor fiscal' },
            { value: 'homologacao', label: 'Homologação na prefeitura' },
            { value: 'producao', label: 'Produção · com valor fiscal' }
          ], col: 'col-md-6' },
          { type: 'custom', col: 'col-12', html: '<div class="fs-7 text-muted" id="ambInfo"></div>' },
          { type: 'section', label: 'Emitente' },
          { name: 'cnpj', label: 'CNPJ do emitente', col: 'col-md-4' },
          { name: 'inscricaoMunicipal', label: 'Inscrição municipal', col: 'col-md-4' },
          { name: 'inscricaoEstadual', label: 'Inscrição estadual', col: 'col-md-4' },
          { name: 'regimeTributario', label: 'Regime tributário', type: 'select', options: [{ value: 'simples', label: 'Simples Nacional' }, { value: 'normal', label: 'Regime normal' }, { value: 'mei', label: 'MEI' }], col: 'col-md-4' },
          { name: 'codigoMunicipio', label: 'Código IBGE do município', col: 'col-md-4' },
          { name: 'municipio', label: 'Município emissor', col: 'col-md-4' },
          { type: 'section', label: 'NFS-e · serviços veterinários' },
          { name: 'codigoServico', label: 'Item da lista de serviços (LC 116)', col: 'col-md-4', placeholder: '05.01' },
          { name: 'cnae', label: 'CNAE', col: 'col-md-4', placeholder: '7500100' },
          { name: 'aliquotaIss', label: 'Alíquota de ISS (%)', type: 'number', step: '0.01', col: 'col-md-4', attrs: 'min="0" max="5"' },
          { name: 'tipoTributacao', label: 'Tributação do ISS', type: 'select', required: true, options: TRIBUTACAO, col: 'col-md-6' },
          { name: 'serieNfse', label: 'Série NFS-e', col: 'col-md-2' },
          { name: 'serieNfe', label: 'Série NF-e', col: 'col-md-2' },
          { name: 'serieNfce', label: 'Série NFC-e', col: 'col-md-2' },
          { type: 'section', label: 'NF-e e NFC-e · produtos' },
          { name: 'cfopPadrao', label: 'CFOP padrão', col: 'col-6 col-md-3', placeholder: '5102', attrs: 'maxlength="4" inputmode="numeric"' },
          { name: 'csosnPadrao', label: 'CSOSN padrão (Simples)', type: 'select', col: 'col-6 col-md-3', options: [
            { value: '102', label: '102 · Sem crédito' }, { value: '103', label: '103 · Isenta' }, { value: '300', label: '300 · Imune' }, { value: '400', label: '400 · Não tributada' }, { value: '500', label: '500 · ICMS por ST' }] },
          { name: 'cstPisCofins', label: 'CST PIS/COFINS', type: 'select', col: 'col-6 col-md-3', options: [
            { value: '49', label: '49 · Outras saídas' }, { value: '07', label: '07 · Isenta' }, { value: '99', label: '99 · Outras operações' }] },
          { name: 'aliquotaIcms', label: 'ICMS % (regime normal)', type: 'number', step: '0.01', col: 'col-6 col-md-3', attrs: 'min="0" max="35"' },
          { type: 'custom', col: 'col-12', html: '<div class="alert alert-info fs-8 mb-0"><i class="bi bi-info-circle me-1"></i>Os padrões 05.01 / CNAE 7500-1/00 (serviços veterinários) e CFOP 5102 / CSOSN 102 (revenda no Simples) são os mais comuns. Cada produto pode ter NCM, CFOP e CSOSN próprios em Produtos &amp; Serviços. Confirme tudo com o contador antes da produção. Na NFC-e de produção, o CSC da SEFAZ é cadastrado na TecnoSpeed junto com o certificado.</div>' }
        ],
        onShown: (el) => {
          const f = $('form', el);
          mask(f.cnpj, 'cnpj');
          const info = () => { $('#ambInfo', el).innerHTML = f.provedor.value === 'tecnospeed' ? (INFO_AMBIENTE[f.ambiente.value] || '') : 'Sem emissão integrada: registre as notas emitidas fora e gere recibos pelo Petzy.'; };
          f.ambiente.addEventListener('change', info); f.provedor.addEventListener('change', info); info();
        },
        onSubmit: async (d) => {
          const cnpj = String(d.cnpj || '').replace(/\D/g, '');
          if (d.provedor === 'tecnospeed' && d.ambiente !== 'teste' && cnpj.length !== 14) throw new Error('Informe o CNPJ do emitente (14 dígitos) para homologação ou produção.');
          if (d.aliquotaIss != null && (d.aliquotaIss < 0 || d.aliquotaIss > 5)) throw new Error('A alíquota de ISS deve ficar entre 0% e 5%.');
          if (d.provedor === 'tecnospeed' && d.ambiente !== 'teste' && d.aliquotaIss == null && ![1, 2].includes(Number(d.tipoTributacao))) throw new Error('Informe a alíquota de ISS.');
          d.tipoTributacao = Number(d.tipoTributacao) || 6;
          d.cfopPadrao = String(d.cfopPadrao || '').replace(/\D/g, '');
          if (d.cfopPadrao && d.cfopPadrao.length !== 4) throw new Error('O CFOP padrão deve ter 4 dígitos (ex.: 5102).');
          await updateDoc(doc(db, 'clinicas', state.clinicaId), { fiscal: d });
          await recarregarClinica();
          Object.assign(c, { fiscal: d });
          toast('Dados fiscais salvos');
        }
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
      const m = equipe.find(x => x.id === (b.dataset.papel || b.dataset.modulos || b.dataset.toggle || b.dataset.comissao));
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
      if (b.dataset.comissao) formModal({
        title: `Comissão de ${esc(m.nome)}`, size: 'sm', values: m,
        fields: [
          { name: 'comissaoPercentual', label: '% sobre vendas e atendimentos faturados', type: 'number', step: '0.1', col: 'col-12', attrs: 'min="0" max="100"' },
          { type: 'custom', col: 'col-12', html: '<div class="fs-8 text-muted">Aplicado sobre as vendas do PDV feitas por esse profissional e sobre os atendimentos/agendamentos que ele concluiu. Veja o total em Relatórios › Comissões.</div>' }
        ],
        onSubmit: async (d) => { await atualizarMembro(m.id, { comissaoPercentual: Number(d.comissaoPercentual) || 0 }); toast('Comissão atualizada'); }
      });
      if (b.dataset.modulos) {
        const labels = {
          dashboard: 'Dashboard', agenda: 'Agenda', clientes: 'Tutores', pets: 'Pets', prontuarios: 'Prontuários',
          vacinas: 'Vacinas', internacao: 'Internação', pdv: 'PDV / Vendas', produtos: 'Produtos & Serviços', fornecedores: 'Fornecedores',
          financeiro: 'Financeiro', fiscal: 'Fiscal', relatorios: 'Relatórios', marketing: 'Marketing', bi: 'BI Avançado',
          auditoria: 'Auditoria', configuracoes: 'Configurações'
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

    // ---------- tabela de NCM ----------
    const statusNcm = (r) => {
      // async: se o usuário já saiu de Configurações antes desta Promise assentar, o elemento some do
      // DOM (a view foi trocada) — sem essa guarda, a atribuição abaixo quebra o resto da aplicação.
      const elStatus = $('#ncmStatus', view); if (!elStatus) return;
      const dt = r?.atualizadoEm ? new Date(r.atualizadoEm).toLocaleDateString('pt-BR') : null;
      elStatus.innerHTML = dt
        ? `${esc(r.total)} códigos · atualizada em ${dt}${r.vigencia ? ' · ' + esc(r.vigencia) : ''}`
        : 'Tabela ainda não baixada. Clique em "Atualizar" para buscar na Receita Federal.';
    };
    garantirCacheNcm().then(() => chamarFuncao('metaTabelaNcm', {})).then(statusNcm).catch(() => { const el = $('#ncmStatus', view); if (el) el.textContent = 'Não foi possível verificar a tabela agora.'; });
    $('#btnNcmAtualizar', view).onclick = async (e) => {
      const b = e.currentTarget; ocupado(b, 'Baixando...');
      try {
        const r = await atualizarTabelaNcm({ forcar: true });
        statusNcm(r);
        toast(r.fonteIndisponivel ? 'O Siscomex está indisponível agora; mantivemos a última tabela salva.' : 'Tabela de NCM atualizada ✔', r.fonteIndisponivel ? 'warning' : 'success');
      } catch (err) { toast(err.code === 'functions/internal' && err.message === 'internal' ? 'O serviço está indisponível no momento.' : err.message, 'danger'); }
      finally { livre(b); }
    };

    $('#btnDemo', view).onclick = async (e) => {
      const b = e.currentTarget; // capturar antes de qualquer await (depois vira null)
      if (b.disabled || !exigirLicenca()) return;
      b.disabled = true; // trava já no primeiro clique: evita gerar dois conjuntos
      try {
        const jaTem = (await list('clientes', where('demo', '==', true))).length > 0;
        const ok = await confirmar(jaTem
          ? 'Esta clínica já tem dados de exemplo. <strong>Recriar</strong> apaga os exemplos atuais e gera um conjunto novo e completo. Seus dados reais não são afetados.'
          : 'Gerar dados de exemplo completos nesta clínica? Se a integração fiscal ainda não estiver configurada, ela será ativada no <strong>modo teste</strong> (sem valor fiscal). Você poderá remover tudo depois.',
          { ok: jaTem ? 'Recriar exemplos' : 'Gerar', danger: false });
        if (!ok) return;
        ocupado(b, jaTem ? 'Recriando...' : 'Gerando...');
        if (jaTem) await apagar(true);
        const n = await gerarDemo();
        toast(`${n} registros de exemplo criados 🎉`);
        location.hash = '#/dashboard';
      } catch (err) { toast(err.message, 'danger'); }
      finally { if (b.dataset.html) livre(b); else b.disabled = false; }
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
    let docs = soDemo ? await list(nome, where('demo', '==', true)) : await list(nome);
    // notas transmitidas à prefeitura têm guarda obrigatória: não entram na limpeza
    if (nome === 'fiscal') docs = docs.filter(d => d.integracao !== true || ['rascunho', 'rejeitada'].includes(d.status));
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
// Conjunto COMPLETO: todos os campos que as telas usam (dados fiscais, endereço com IBGE, fornecedores e compras,
// contas a pagar, fiado, notas fiscais...). Ao criar um campo novo em qualquer cadastro, inclua-o aqui também.
async function gerarDemo() {
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const r2 = (n) => Math.round(n * 100) / 100;
  const hoje = new Date();
  const dia = (n) => toISODate(addDays(hoje, n));
  const agora = new Date().toISOString();
  const ops = [];
  const novo = (name, data) => { const r = doc(col(name)); ops.push([r, { ...data, demo: true, criadoEm: data.criadoEm || agora }]); return r.id; };

  // documentos com dígitos verificadores válidos
  const cpf = () => {
    const n = Array.from({ length: 9 }, () => rint(0, 9));
    const dv = (a) => { const r = (a.reduce((s, d, i) => s + d * (a.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
    n.push(dv(n)); n.push(dv(n));
    const t = n.join(''); return t.slice(0, 3) + '.' + t.slice(3, 6) + '.' + t.slice(6, 9) + '-' + t.slice(9);
  };
  const cnpj = () => {
    const n = [...Array.from({ length: 8 }, () => rint(0, 9)), 0, 0, 0, 1];
    const dv = (a) => { const pesos = a.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = a.reduce((s, d, i) => s + d * pesos[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
    n.push(dv(n)); n.push(dv(n));
    const t = n.join(''); return t.slice(0, 2) + '.' + t.slice(2, 5) + '.' + t.slice(5, 8) + '/' + t.slice(8, 12) + '-' + t.slice(12);
  };
  const ean = () => { const d = [7, 8, 9, ...Array.from({ length: 9 }, () => rint(0, 9))]; const s = d.reduce((a, x, i) => a + x * (i % 2 ? 3 : 1), 0); d.push((10 - (s % 10)) % 10); return d.join(''); };
  const telefone = () => '(11) 9' + rint(6000, 9999) + '-' + rint(1000, 9999);

  // ---------- fornecedores ----------
  const fornecedores = [
    ['Distribuidora PetFood Brasil Ltda', 'Marcos Andrade', 'petfood', 'Rua da Mooca, 1200 - Mooca, São Paulo/SP'],
    ['VetFarma Distribuidora de Medicamentos', 'Luciana Prado', 'vetfarma', 'Av. Santo Amaro, 3500 - Brooklin, São Paulo/SP'],
    ['Pet Acessórios Atacado', 'Ricardo Nunes', 'petacessorios', 'Rua Voluntários da Pátria, 800 - Santana, São Paulo/SP']
  ].map(([nome, contato, dominio, endereco]) => ({
    nome, id: novo('fornecedores', { nome, documento: cnpj(), contato, telefone: telefone(), email: 'vendas@' + dominio + '.com.br', endereco, observacoes: 'Pedido mínimo de R$ 500. Entrega em até 2 dias úteis.' })
  }));

  // ---------- tutores (CPF válido e endereço completo com código IBGE, exigido na NF-e) ----------
  const enderecos = [['Rua Augusta', 'Consolação', '01305-000'], ['Av. Paulista', 'Bela Vista', '01310-100'], ['Rua Oscar Freire', 'Jardim Paulista', '01426-001'],
    ['Rua Vergueiro', 'Vila Mariana', '04101-000'], ['Rua Harmonia', 'Vila Madalena', '05435-000'], ['Rua dos Pinheiros', 'Pinheiros', '05422-001'],
    ['Rua Tuiuti', 'Tatuapé', '03081-000'], ['Rua Domingos de Morais', 'Vila Mariana', '04010-100'], ['Av. Rebouças', 'Pinheiros', '05402-000'],
    ['Rua Cardeal Arcoverde', 'Pinheiros', '05407-002'], ['Rua Voluntários da Pátria', 'Santana', '02010-000'], ['Rua Teodoro Sampaio', 'Pinheiros', '05406-000']];
  const nomes = ['Ana Beatriz Souza', 'Carlos Eduardo Lima', 'Fernanda Oliveira', 'João Pedro Santos', 'Mariana Costa', 'Rafael Almeida', 'Juliana Ferreira', 'Lucas Martins', 'Patrícia Rocha', 'Bruno Carvalho', 'Camila Ribeiro', 'Diego Nascimento'];
  const tutores = nomes.map((nome, i) => {
    const [endereco, bairro, cep] = enderecos[i % enderecos.length];
    const email = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(' ').slice(0, 2).join('.') + '@exemplo.com';
    return { nome, id: novo('clientes', {
      nome, cpf: cpf(), telefone: telefone(), email, nascimento: dia(-rint(9000, 25000)),
      cep, endereco, numero: String(rint(10, 2500)), bairro, cidade: 'São Paulo', uf: 'SP', ibge: '3550308',
      obs: i % 4 === 0 ? 'Prefere contato por WhatsApp.' : '', criadoEm: dia(-rint(1, 120))
    }) };
  });

  // ---------- pets ----------
  const listaPets = [['Thor', 'Cão', 'Golden Retriever', 'Grande', 'Dourada'], ['Luna', 'Gato', 'Siamês', 'Pequeno', 'Creme e marrom'], ['Mel', 'Cão', 'Shih Tzu', 'Pequeno', 'Branca e caramelo'],
    ['Bob', 'Cão', 'SRD', 'Médio', 'Preta'], ['Nina', 'Gato', 'Persa', 'Pequeno', 'Branca'], ['Max', 'Cão', 'Labrador', 'Grande', 'Chocolate'], ['Pipoca', 'Cão', 'Poodle', 'Pequeno', 'Branca'],
    ['Frida', 'Gato', 'SRD', 'Pequeno', 'Tricolor'], ['Zeus', 'Cão', 'Bulldog Francês', 'Pequeno', 'Tigrada'], ['Amora', 'Cão', 'Yorkshire', 'Mini', 'Preta e dourada'],
    ['Simba', 'Gato', 'Maine Coon', 'Médio', 'Laranja rajada'], ['Bidu', 'Cão', 'Beagle', 'Médio', 'Tricolor'], ['Kiara', 'Cão', 'Lhasa Apso', 'Pequeno', 'Dourada'],
    ['Tom', 'Gato', 'SRD', 'Pequeno', 'Cinza rajada'], ['Paçoca', 'Cão', 'Pinscher', 'Mini', 'Preta e marrom'], ['Loki', 'Cão', 'Border Collie', 'Médio', 'Preta e branca']];
  const pesoPorPorte = { Mini: [2, 4], Pequeno: [4, 10], 'Médio': [10, 22], Grande: [22, 40] };
  const alergias = ['Alérgico a dipirona', 'Sensível a frango na ração', 'Agitado ao manusear: usar focinheira'];
  const pets = listaPets.map(([nome, especie, raca, porte, pelagem], i) => {
    const tutor = tutores[i % tutores.length];
    const [pmin, pmax] = especie === 'Gato' ? [3, 7] : pesoPorPorte[porte];
    return { nome, especie, tutor, id: novo('pets', {
      nome, especie, raca, porte, pelagem, clienteId: tutor.id, sexo: rnd(['Macho', 'Fêmea']), peso: r2(pmin + Math.random() * (pmax - pmin)),
      nascimento: dia(-rint(200, 4000)), castrado: Math.random() > 0.4, microchip: i % 3 === 0 ? '98200000' + rint(1000000, 9999999) : '',
      alergias: i % 5 === 0 ? rnd(alergias) : '', obs: i % 6 === 0 ? 'Tutor pede para avisar antes de aplicar qualquer medicação.' : ''
    }) };
  });

  // ---------- produtos (NCM, CFOP, origem, CSOSN, código de barras, validade) ----------
  const produtos = [
    ['Ração Premium Cães 15kg', 'Ração', 189.9, 132, 12, 0, 240], ['Ração Gatos Castrados 10kg', 'Ração', 159.9, 110, 8, 0, 200],
    ['Petisco Bifinho 500g', 'Petiscos', 29.9, 15, 30, 0, 180], ['Shampoo Neutro 500ml', 'Higiene', 34.9, 17, 3, 2, 540],
    ['Antipulgas Comprimido', 'Farmácia', 89.9, 55, 20, 1, 400], ['Vermífugo 4 comp.', 'Farmácia', 39.9, 21, 25, 1, 365],
    ['Coleira Antipulgas', 'Acessórios', 69.9, 38, 2, 2, 0], ['Brinquedo Mordedor', 'Brinquedos', 24.9, 9, 18, 2, 0]
  ].map(([nome, categoria, precoVenda, precoCusto, estoque, forn, validade]) => {
    const dados = { nome, categoria, codigo: ean(), unidade: 'un', precoCusto, precoVenda, estoque, estoqueMinimo: 5, validade: validade ? dia(validade) : '',
      tipo: 'produto', ativo: true, ncm: NCM_SUGERIDO[categoria] || '', cfop: '5102', origem: '0', icmsSituacao: '102', cest: '' };
    return { ...dados, fornecedor: fornecedores[forn], id: novo('produtos', dados) };
  });
  const servicos = [['Consulta clínica', 'Consulta', 150, 30], ['Retorno', 'Consulta', 0, 20], ['Vacina V10', 'Vacina', 120, 15], ['Vacina Antirrábica', 'Vacina', 80, 15],
    ['Banho - porte pequeno', 'Banho', 60, 60], ['Banho & Tosa - porte médio', 'Tosa', 110, 90], ['Hemograma completo', 'Exame', 90, 20], ['Castração felina', 'Cirurgia', 450, 120]]
    .map(([nome, categoria, precoVenda, duracao], i) => ({ nome, categoria, precoVenda, id: novo('produtos', { nome, categoria, codigo: 'SRV' + String(i + 1).padStart(3, '0'), precoVenda, duracao, tipo: 'servico', ativo: true }) }));

  // ---------- compras (entradas de estoque) e contas a pagar com boleto de 30 dias ----------
  produtos.forEach((p) => {
    for (const diasAtras of [rint(45, 90), rint(1, 12)]) { // uma compra antiga (paga) e uma recente (boleto em aberto)
      const f = p.fornecedor, qtd = rint(6, 24), total = r2(qtd * p.precoCusto), nf = String(rint(10000, 99999));
      const data = addDays(hoje, -diasAtras), venc = toISODate(addDays(data, 30));
      const movId = novo('movimentacoes', { produtoId: p.id, produto: p.nome, tipo: 'entrada', quantidade: qtd, motivo: 'Reposição de estoque',
        fornecedorId: f.id, fornecedor: f.nome, notaFiscal: nf, custoUnitario: p.precoCusto, totalCompra: total, data: data.toISOString() });
      const pago = venc < dia(0);
      novo('financeiro', { tipo: 'despesa', categoria: 'Fornecedores', descricao: 'Compra de ' + p.nome + ' · ' + f.nome, valor: total, vencimento: venc,
        pago, pagoEm: pago ? venc : null, formaPagamento: 'Boleto', fornecedorId: f.id, fornecedor: f.nome, notaFiscal: nf, origem: 'movimentacao', origemId: movId, produtoId: p.id });
    }
  });

  // ---------- agenda (concluídos já faturados no financeiro, como a tela faz) ----------
  const tipoMap = { Consulta: 'consulta', Vacina: 'vacina', Banho: 'banho', Tosa: 'tosa', Exame: 'exame', Cirurgia: 'cirurgia' };
  for (let i = 0; i < 22; i++) {
    const d = addDays(hoje, rint(-3, 4)); d.setHours(rint(8, 17), rnd([0, 30]), 0, 0);
    const s = rnd(servicos), p = rnd(pets), passado = d < hoje;
    const status = passado ? rnd(['concluido', 'concluido', 'concluido', 'faltou']) : rnd(['agendado', 'confirmado']);
    const tipo = tipoMap[s.categoria] || 'consulta';
    const faturado = status === 'concluido' && s.precoVenda > 0;
    const agId = novo('agendamentos', { petId: p.id, clienteId: p.tutor.id, tipo, servicoId: s.id, inicio: toISODateTime(d), duracao: 30, valor: s.precoVenda,
      profissionalId: state.user.uid, status, faturado, buscaLeva: ['banho', 'tosa'].includes(tipo) && i % 3 === 0, obs: i % 5 === 0 ? 'Tutor pediu confirmação por WhatsApp.' : '' });
    if (faturado) novo('financeiro', { tipo: 'receita', categoria: ['banho', 'tosa'].includes(tipo) ? 'Banho & Tosa' : 'Serviços clínicos', descricao: s.nome + ' - ' + p.nome + ' (' + p.tutor.nome + ')',
      valor: s.precoVenda, vencimento: toISODate(d), pago: true, pagoEm: toISODate(d), formaPagamento: rnd(['PIX', 'Cartão de crédito', 'Dinheiro']), origem: 'agendamento', origemId: agId, clienteId: p.tutor.id });
  }

  // ---------- prontuários completos ----------
  const casos = [
    { diagnostico: 'Otite externa bacteriana', sistema: 'ouvidos', achado: 'Conduto auditivo direito eritematoso, com secreção acastanhada e odor.', queixa: 'Coçando a orelha direita e balançando a cabeça há 5 dias',
      diferenciais: 'Otite por Malassezia; corpo estranho no conduto.', exames: ['Citologia'], retorno: 10, orientacoes: 'Não molhar as orelhas durante o tratamento. Retornar se piorar.',
      receita: [{ medicamento: 'Otológico (Otomax)', quantidade: '1 frasco', via: 'Otológica', posologia: 'Aplicar 5 gotas no ouvido direito a cada 12 horas, por 10 dias.' }] },
    { diagnostico: 'Dermatite alérgica', sistema: 'tegumentar', achado: 'Eritema e escoriações em região abdominal e axilas.', queixa: 'Prurido intenso e vermelhidão na barriga',
      diferenciais: 'Dermatite atópica; alergia alimentar; escabiose.', exames: ['Hemograma completo'], retorno: 14, orientacoes: 'Evitar banhos frequentes. Manter o antipulgas em dia.',
      receita: [{ medicamento: 'Oclacitinib (Apoquel)', concentracao: '5,4 mg', quantidade: '1 caixa', via: 'Oral', posologia: 'Administrar 1 comprimido a cada 12 horas por 14 dias, depois 1 vez ao dia.' }] },
    { diagnostico: 'Gastroenterite aguda', sistema: 'digest', achado: 'Desconforto à palpação abdominal, borborigmos aumentados.', queixa: 'Vômito e diarreia desde ontem',
      diferenciais: 'Indiscrição alimentar; parvovirose; corpo estranho.', exames: ['Hemograma completo', 'Parasitológico de fezes'], retorno: 3, orientacoes: 'Oferecer água aos poucos e dieta leve por 3 dias.',
      receita: [{ medicamento: 'Ondansetrona', concentracao: '4 mg', quantidade: '1 caixa', via: 'Oral', posologia: 'Administrar 1/2 comprimido a cada 12 horas, por 3 dias.' },
        { medicamento: 'Probiótico', quantidade: '1 bisnaga', via: 'Oral', posologia: 'Administrar 2 g uma vez ao dia, por 5 dias.' }] },
    { diagnostico: 'Check-up anual, paciente saudável', sistema: '', achado: '', queixa: 'Consulta de rotina', diferenciais: '', exames: ['Hemograma completo', 'Bioquímico (ALT, FA, ureia, creatinina)'],
      retorno: 365, orientacoes: 'Manter vacinação e vermifugação em dia.', receita: [] }
  ];
  const sistemas = D.SISTEMAS.map(([k]) => k);
  pets.slice(0, 10).forEach(p => {
    const k = rnd(casos);
    const dataAt = addDays(hoje, -rint(1, 90)); dataAt.setHours(rint(8, 17), rnd([0, 15, 30, 45]), 0, 0);
    const exameSistemas = Object.fromEntries(sistemas.map(sis => [sis, sis === k.sistema ? { status: 'Alterado', obs: k.achado } : { status: 'Normal', obs: '' }]));
    novo('atendimentos', {
      petId: p.id, clienteId: p.tutor.id, tipo: 'Consulta', data: toISODateTime(dataAt), queixa: k.queixa,
      anamnese: 'Tutor relata início há poucos dias, sem outros sinais. Alimentação e ingestão de água normais.', alimentacao: 'Ração premium, 2 vezes ao dia',
      ambiente: rnd(['Apartamento, sem acesso à rua', 'Casa com quintal, convive com outro cão', 'Casa, passeios diários']), medicacoesUso: 'Nenhuma', vacinacaoEmDia: 'Em dia',
      antecedentes: 'Sem histórico de doenças relevantes.', peso: rint(4, 30), temperatura: 38.5, fc: rint(80, 120), fr: rint(18, 30), tpc: 2,
      mucosas: 'Normocoradas', hidratacao: 'Normal', escore: 5, dor: k.sistema ? 3 : 0, estadoMental: 'Alerta', exameSistemas,
      exameFisico: k.achado || 'Exame físico sem alterações.', diagnostico: k.diagnostico, diferenciais: k.diferenciais, prognostico: 'Favorável',
      procedimentos: k.sistema ? 'Limpeza e avaliação clínica.' : '', examesSolicitados: k.exames, exames: '', retorno: toISODate(addDays(dataAt, k.retorno)),
      orientacoes: k.orientacoes, receita: k.receita.map(i => ({ farmacia: 'Veterinária', concentracao: '', ...i, uso: D.usoDaVia(i.via) })),
      receitaObs: k.receita.length ? 'Administrar junto com alimento. Em caso de reação, suspender e entrar em contato.' : '', receitaControle: false,
      vetId: state.user.uid, vetNome: state.perfil.nome, vetCrmv: state.perfil.crmv || ''
    });
    // reforço entre 15 dias atrasado e 35 dias à frente (aparece em "atrasadas" e "próximos 30 dias")
    const apl = addDays(hoje, -rint(330, 380));
    novo('vacinas', { petId: p.id, nome: p.especie === 'Gato' ? 'V4 Felina' : rnd(['V10 (Polivalente)', 'Antirrábica']), dose: 'Reforço anual', dataAplicacao: toISODate(apl),
      proximaDose: toISODate(addDays(apl, 365)), fabricante: rnd(['Zoetis', 'MSD Saúde Animal', 'Boehringer Ingelheim']), lote: 'L' + rint(10000, 99999), veterinario: state.perfil.nome, obs: 'Sem reações.' });
  });

  // ---------- modelos de receita ----------
  casos.filter(k => k.receita.length).forEach(k => novo('modelosReceita', { nome: k.diagnostico, itens: k.receita.map(i => ({ farmacia: 'Veterinária', concentracao: '', ...i, uso: D.usoDaVia(i.via) })), obs: k.orientacoes }));

  // ---------- vendas do PDV (com serviços, desconto e fiado) ----------
  for (let i = 0; i < 60; i++) {
    const fiado = i % 12 === 0;
    const d = addDays(hoje, fiado ? -rint(0, 20) : -rint(0, 170)); d.setHours(rint(8, 19), rint(0, 59), 0, 0);
    const itens = [];
    for (let k = 0; k < rint(1, 3); k++) {
      const pr = rnd(produtos);
      if (!itens.some(x => x.id === pr.id)) itens.push({ id: pr.id, nome: pr.nome, tipo: 'produto', preco: pr.precoVenda, custo: pr.precoCusto, qtd: rint(1, 2) });
    }
    if (i % 5 === 0) { const sv = rnd(servicos.filter(x => x.precoVenda)); itens.push({ id: sv.id, nome: sv.nome, tipo: 'servico', preco: sv.precoVenda, custo: 0, qtd: 1 }); }
    const subtotal = r2(itens.reduce((s, x) => s + x.preco * x.qtd, 0));
    const desconto = i % 7 === 0 ? r2(subtotal * 0.05) : 0, total = r2(subtotal - desconto);
    const pet = rnd(pets);
    const pag = fiado ? 'Fiado (a receber)' : rnd(['PIX', 'PIX', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro']);
    const vid = novo('vendas', { itens, clienteId: pet.tutor.id, petId: pet.id, total, subtotal, desconto, pagamento: pag, status: 'concluida',
      data: toISODateTime(d) + ':00', vendedorId: state.user.uid, vendedor: state.perfil.nome });
    const venc = fiado ? toISODate(addDays(d, 30)) : toISODate(d);
    const pago = !fiado || venc < dia(-5);
    novo('financeiro', { tipo: 'receita', categoria: itens.every(x => x.tipo === 'servico') ? 'Serviços' : 'Vendas PDV', descricao: 'Venda PDV #' + vid.slice(0, 6).toUpperCase() + ' - ' + pet.tutor.nome,
      valor: total, vencimento: venc, pago, pagoEm: pago ? venc : null, formaPagamento: pag, origem: 'venda', origemId: vid, clienteId: pet.tutor.id });
  }

  // ---------- despesas fixas (6 meses): pagas até hoje; as do mês ainda por vencer ficam em aberto ----------
  for (let m = 0; m < 6; m++) {
    [['Aluguel', 'Aluguel', 3500, 5], ['Salários', 'Salários', 8200, 5], ['Energia / Água', 'Energia / Água', rint(600, 900), 12],
      ['Internet / Telefone', 'Internet e telefone', 199.9, 15], ['Software', 'Assinatura Petzy', 149.9, 20]].forEach(([categoria, descricao, valor, diaVenc]) => {
      const v = new Date(hoje.getFullYear(), hoje.getMonth() - m, diaVenc);
      const venc = toISODate(v), pago = venc < dia(0) && !(m === 0 && categoria === 'Energia / Água'); // conta de luz do mês vencida e em aberto
      novo('financeiro', { tipo: 'despesa', categoria, descricao, valor, vencimento: venc, pago, pagoEm: pago ? venc : null, formaPagamento: 'Boleto' });
    });
  }

  // ---------- notas fiscais: histórico registrado e rascunhos prontos para emitir no modo teste ----------
  for (let i = 1; i <= 4; i++) {
    const t = rnd(tutores), d = addDays(hoje, -30 * i);
    novo('fiscal', { tipo: 'nfse', integracao: false, status: 'emitida', numero: String(2026000 + i), serie: '1', dataEmissao: toISODate(d), emitidaEm: d.toISOString(),
      clienteId: t.id, descricao: 'Consulta clínica veterinária e aplicação de vacina.', valor: 270, observacoes: 'Nota emitida no site da prefeitura (exemplo).' });
  }
  const tNfse = tutores[0];
  novo('fiscal', { tipo: 'nfse', integracao: true, status: 'rascunho', dataEmissao: dia(0), clienteId: tNfse.id, tomadorCpf: '',
    descricao: 'Consulta clínica veterinária do paciente ' + pets[0].nome + '.', valor: 150, observacoes: 'Rascunho de exemplo: clique em Emitir (modo teste).' });
  const itensNfce = produtos.slice(0, 2).map(pr => ({ produtoId: pr.id, nome: pr.nome, codigo: pr.codigo, qtd: 1, preco: pr.precoVenda, unidade: pr.unidade,
    ncm: pr.ncm, cfop: pr.cfop, cest: '', origem: pr.origem, icmsSituacao: pr.icmsSituacao }));
  novo('fiscal', { tipo: 'nfce', integracao: true, status: 'rascunho', dataEmissao: dia(0), clienteId: tutores[1].id, tomadorCpf: '', pagamento: 'PIX', desconto: 0,
    itens: itensNfce, valor: r2(itensNfce.reduce((s, x) => s + x.preco, 0)), descricao: 'Venda de produtos (exemplo)', observacoes: 'Rascunho de exemplo: clique em Emitir (modo teste).' });

  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(([r, d]) => b.set(r, d));
    await b.commit();
  }

  // integração fiscal em modo teste (sem valor fiscal), só se a clínica ainda não configurou nenhuma
  const fiscalAtual = state.clinica?.fiscal || {};
  if (!['tecnospeed', 'plugnotas'].includes(fiscalAtual.provedor)) {
    await updateDoc(doc(db, 'clinicas', state.clinicaId), { fiscal: {
      regimeTributario: 'simples', codigoServico: '05.01', cnae: '7500100', tipoTributacao: 6, aliquotaIss: 2,
      cfopPadrao: '5102', csosnPadrao: '102', cstPisCofins: '49', serieNfse: '1', serieNfe: '1', serieNfce: '1',
      ...fiscalAtual, provedor: 'tecnospeed', ambiente: 'teste'
    } });
    await recarregarClinica();
  }
  return ops.length;
}

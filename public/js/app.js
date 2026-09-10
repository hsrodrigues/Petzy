// ================= Shell do app: sessão, menu, rotas e licença =================
import { auth, db, doc, getDoc, onAuthStateChanged, signOut } from './firebase.js';
import { state, loadSession, pode, PAPEIS, licenca, carregarPlanos } from './store.js';
import { $, $$, esc, initials, loading, toast, fmtDate } from './ui.js';

const ROTAS = {
  dashboard:     { t: 'Dashboard',        i: 'grid-1x2',          s: 'Visão geral' },
  agenda:        { t: 'Agenda',           i: 'calendar3',         s: 'Atendimento' },
  clientes:      { t: 'Tutores',          i: 'people',            s: 'Atendimento' },
  pets:          { t: 'Pets',             i: 'heart',             s: 'Atendimento' },
  prontuarios:   { t: 'Prontuários',      i: 'clipboard2-pulse',  s: 'Clínico' },
  vacinas:       { t: 'Vacinas',          i: 'shield-plus',       s: 'Clínico' },
  pdv:           { t: 'PDV / Vendas',     i: 'cart3',             s: 'Comercial' },
  produtos:      { t: 'Produtos & Serviços', i: 'box-seam',       s: 'Comercial' },
  fornecedores:  { t: 'Fornecedores',     i: 'truck',             s: 'Comercial' },
  financeiro:    { t: 'Financeiro',       i: 'cash-coin',         s: 'Gestão' },
  relatorios:    { t: 'Relatórios',       i: 'bar-chart-line',    s: 'Gestão' },
  configuracoes: { t: 'Configurações',    i: 'gear',              s: 'Gestão' },
  assinatura:    { t: 'Assinatura',       i: 'credit-card',       s: 'Gestão', oculto: true }
};

// ---------- Menu lateral ----------
function montarMenu() {
  let html = '', secao = '';
  for (const [k, r] of Object.entries(ROTAS)) {
    if (r.oculto || !pode(k)) continue;
    if (r.s !== secao) { secao = r.s; html += `<div class="nav-section">${secao}</div>`; }
    html += `<a class="nav-link" href="#/${k}" data-rota="${k}" title="${esc(r.t)}" aria-label="${esc(r.t)}"><i class="bi bi-${r.i}"></i>${r.t}</a>`;
  }
  $('#nav').innerHTML = html;
}

function marcarMenu(rota) {
  $$('#nav .nav-link').forEach(a => a.classList.toggle('active', a.dataset.rota === rota));
}

// ---------- Licença ----------
export function renderLicenca() {
  const L = licenca();
  const c = state.clinica;
  const nomePlano = { trial: 'Teste grátis', basico: 'Básico', pro: 'Profissional', premium: 'Premium' }[L.plano] || L.plano;

  $('#planCard').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-1">
      <strong>${esc(nomePlano)}</strong>
      <span class="badge ${L.ativa ? 'bg-success' : 'bg-danger'}">${L.ativa ? 'Ativo' : 'Vencido'}</span>
    </div>
    <div class="opacity-75 mb-2">${L.ativa ? `Válido até ${L.validoAte.toLocaleDateString('pt-BR')}` : 'Renove para voltar a editar'}</div>
    <a href="#/assinatura" class="btn btn-sm btn-light w-100 fw-semibold" title="${L.plano === 'trial' || !L.ativa ? 'Assinar agora' : 'Gerenciar plano'}"><i class="bi bi-credit-card"></i><span>${L.plano === 'trial' || !L.ativa ? 'Assinar agora' : 'Gerenciar plano'}</span></a>`;

  let bar = '';
  if (!L.ativa) {
    bar = `<div class="alert alert-danger rounded-0 border-0 mb-0 d-flex align-items-center gap-2 px-4">
      <i class="bi bi-lock-fill"></i><div class="flex-fill"><strong>Licença ${L.status === 'bloqueado' ? 'bloqueada' : 'vencida'}.</strong>
      O sistema está em modo somente leitura. Regularize a assinatura para voltar a cadastrar e editar.</div>
      <a href="#/assinatura" class="btn btn-sm btn-danger">Regularizar</a></div>`;
  } else if (L.dias <= 5) {
    bar = `<div class="alert alert-warning rounded-0 border-0 mb-0 d-flex align-items-center gap-2 px-4">
      <i class="bi bi-hourglass-split"></i><div class="flex-fill">
      ${L.plano === 'trial' ? 'Seu teste grátis' : 'Sua licença'} vence em <strong>${L.dias} dia(s)</strong>.</div>
      <a href="#/assinatura" class="btn btn-sm btn-warning">${L.plano === 'trial' ? 'Assinar' : 'Renovar'}</a></div>`;
  }
  $('#licenseBar').innerHTML = bar;
  document.body.classList.toggle('somente-leitura', !L.ativa);
}

// ---------- Roteador ----------
let renderId = 0;
async function router() {
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, qs] = hash.split('?');
  const [rota, ...args] = path.split('/');
  const params = new URLSearchParams(qs || '');
  const view = $('#view');

  if (!ROTAS[rota]) { location.hash = '#/dashboard'; return; }
  if (!pode(rota) && !(rota === 'assinatura' && state.perfil.papel === 'admin')) {
    view.innerHTML = `<div class="empty-state"><i class="bi bi-shield-lock"></i><h5>Acesso restrito</h5><p>Seu perfil (${PAPEIS[state.perfil.papel]}) não tem acesso a esta área.</p></div>`;
    return;
  }

  marcarMenu(rota);
  fecharMenuMobile();
  document.title = `${ROTAS[rota].t} · Petzy`;
  view.innerHTML = loading();
  const id = ++renderId;
  try {
    const mod = await import(`./pages/${rota}.js`);
    if (id !== renderId) return; // usuário já navegou para outra tela
    view.innerHTML = '';
    await mod.render(view, { args, params });
  } catch (e) {
    console.error(e);
    const perm = e.code === 'permission-denied';
    view.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-octagon text-danger"></i>
      <h5>${perm ? 'Sem permissão' : 'Ops! Algo deu errado'}</h5><p class="text-muted">${esc(e.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">Recarregar</button></div>`;
  }
}

// ---------- Mobile ----------
function fecharMenuMobile() { $('#sidebar').classList.remove('show'); $('#backdrop').classList.add('d-none'); }
$('#btnMenu').onclick = () => { $('#sidebar').classList.add('show'); $('#backdrop').classList.remove('d-none'); };
$('#backdrop').onclick = fecharMenuMobile;

const sidebarToggle = $('#btnSidebarToggle');
const sidebarRecolhido = localStorage.getItem('pz-sidebar-recolhido') === '1';
const atualizarSidebar = (recolhido) => {
  document.body.classList.toggle('sidebar-collapsed', recolhido);
  sidebarToggle?.setAttribute('aria-expanded', String(!recolhido));
  sidebarToggle?.setAttribute('title', recolhido ? 'Expandir menu' : 'Recolher menu');
  sidebarToggle?.setAttribute('aria-label', recolhido ? 'Expandir menu' : 'Recolher menu');
  if (sidebarToggle) sidebarToggle.innerHTML = `<i class="bi bi-${recolhido ? 'layout-sidebar' : 'layout-sidebar-inset'}"></i>`;
};
atualizarSidebar(sidebarRecolhido);
sidebarToggle?.addEventListener('click', () => {
  const recolhido = !document.body.classList.contains('sidebar-collapsed');
  localStorage.setItem('pz-sidebar-recolhido', recolhido ? '1' : '0');
  atualizarSidebar(recolhido);
});

// ---------- Busca global ----------
$('#globalSearch').onsubmit = (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (q) location.hash = `#/pets?q=${encodeURIComponent(q)}`;
};

$('#btnLogout').onclick = async () => { await signOut(auth); location.replace('login.html'); };

// Pages chamam isso quando a clínica é alterada (config/assinatura)
export async function recarregarClinica() {
  const c = await getDoc(doc(db, 'clinicas', state.clinicaId));
  state.clinica = { id: c.id, ...c.data() };
  $('#clinicName').textContent = state.clinica.nome;
  renderLicenca();
}

// Bloqueia ações de escrita na interface quando a licença venceu
export function exigirLicenca() {
  if (licenca().ativa) return true;
  toast('Licença vencida: renove a assinatura para cadastrar ou editar.', 'warning');
  return false;
}

// ---------- Boot ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) return location.replace('login.html');
  try {
    await carregarPlanos();
    const s = await loadSession(user);
    if (!s) return location.replace('login.html'); // sem clínica -> onboarding
    if (!state.perfil.ativo) {
      await signOut(auth);
      alert('Seu acesso foi desativado pelo administrador da clínica.');
      return location.replace('login.html');
    }

    $('#userName').textContent = state.perfil.nome || user.email;
    $('#clinicName').textContent = state.clinica?.nome || '';
    $('#userRole').textContent = PAPEIS[state.perfil.papel] + ' · ' + user.email;
    const av = $('#userAvatar');
    if (user.photoURL) av.outerHTML = `<img class="avatar" id="userAvatar" src="${esc(user.photoURL)}" referrerpolicy="no-referrer">`;
    else av.textContent = initials(state.perfil.nome || user.email);

    getDoc(doc(db, 'superadmins', user.uid)).then(d => d.exists() && $('#superLink').classList.remove('d-none')).catch(() => {});

    montarMenu();
    renderLicenca();
    $('#boot').remove();
    $('#shell').classList.remove('d-none');
    window.addEventListener('hashchange', router);
    router();
  } catch (e) {
    console.error(e);
    $('#boot').innerHTML = `<div class="text-center p-4"><h5>Não foi possível carregar sua conta</h5><p class="text-muted">${esc(e.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">Tentar novamente</button></div>`;
  }
});

// ================= Camada de dados (multi-tenant) =================
import {
  db, auth, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, writeBatch, increment
} from './firebase.js';

export const state = { user: null, perfil: null, clinica: null, clinicaId: null };

const now = () => new Date().toISOString();

export const col = (name) => collection(db, 'clinicas', state.clinicaId, name);
export const ref = (name, id) => doc(db, 'clinicas', state.clinicaId, name, id);

export async function list(name, ...constraints) {
  const snap = await getDocs(constraints.length ? query(col(name), ...constraints) : col(name));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function get(name, id) {
  const s = await getDoc(ref(name, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function create(name, data) {
  const r = await addDoc(col(name), { ...data, criadoEm: now(), criadoPor: auth.currentUser?.uid || null });
  registrarAuditoria(name, r.id, 'criar', data);
  return r.id;
}

export async function update(name, id, data) {
  await updateDoc(ref(name, id), { ...data, atualizadoEm: now() });
  registrarAuditoria(name, id, 'editar', data);
}
export async function remove(name, id) {
  await deleteDoc(ref(name, id));
  registrarAuditoria(name, id, 'excluir', null);
}
export const save = (name, id, data) => (id ? update(name, id, data).then(() => id) : create(name, data));

// ---------- Auditoria ----------
// Rastro de "quem mexeu em quê": uma linha por criação/edição/exclusão nas coleções operacionais.
// É só leitura para o admin (ver js/pages/auditoria.js) e nunca pode ser editada/apagada pelo app
// (garantido nas regras do Firestore) — se alguém contestar um registro, o log continua íntegro.
const SEM_AUDITORIA = ['auditoria', 'movimentacoes', 'portalTentativas'];
const CAMPO_RESUMO = {
  clientes: 'nome', pets: 'nome', produtos: 'nome', fornecedores: 'nome', financeiro: 'descricao',
  vendas: 'total', prontuarios: 'diagnostico', atendimentos: 'diagnostico', agendamentos: 'tipo',
  fiscal: 'descricao', internacoes: 'motivo', vacinas: 'nome', modelos: 'nome'
};
function registrarAuditoria(colecao, docId, acao, dados) {
  if (SEM_AUDITORIA.includes(colecao) || !state.clinicaId) return;
  const campo = CAMPO_RESUMO[colecao];
  const resumo = dados && campo && dados[campo] != null ? String(dados[campo]).slice(0, 140) : '';
  addDoc(collection(db, 'clinicas', state.clinicaId, 'auditoria'), {
    colecao, docId, acao, resumo,
    usuarioId: auth.currentUser?.uid || null, usuarioNome: state.perfil?.nome || auth.currentUser?.email || 'desconhecido',
    criadoEm: now()
  }).catch((e) => console.warn('Falha ao registrar auditoria (não bloqueia a operação principal)', e));
}

export const bumpEstoque = (id, delta) => updateDoc(ref('produtos', id), { estoque: increment(delta) });

export { where, orderBy, limit, writeBatch, db };

// Mapa id -> objeto (útil para mostrar nomes de tutor/pet nas listas)
export const byId = (arr) => Object.fromEntries(arr.map(x => [x.id, x]));

// Carrega clientes e pets juntos (usado em quase todas as telas)
export async function loadTutoresPets() {
  const [clientes, pets] = await Promise.all([list('clientes'), list('pets')]);
  clientes.sort((a, b) => a.nome.localeCompare(b.nome));
  pets.sort((a, b) => a.nome.localeCompare(b.nome));
  return { clientes, pets, C: byId(clientes), P: byId(pets) };
}

// ---------- Sessão / tenant ----------
export async function loadSession(user) {
  const s = await getDoc(doc(db, 'usuarios', user.uid));
  if (!s.exists()) return null;
  state.user = user;
  state.perfil = { id: s.id, ...s.data() };
  state.clinicaId = state.perfil.clinicaId;
  const c = await getDoc(doc(db, 'clinicas', state.clinicaId));
  state.clinica = c.exists() ? { id: c.id, ...c.data() } : null;
  return state;
}

// Cria a clínica (tenant) + perfil admin do dono
export async function criarClinica(user, { nomeClinica, nome, telefone = '', tipo = 'clinica' }) {
  const clinicaRef = doc(collection(db, 'clinicas'));
  const trialAte = new Date(); trialAte.setDate(trialAte.getDate() + 14);
  await setDoc(clinicaRef, {
    nome: nomeClinica, tipo, telefone, email: user.email, ownerUid: user.uid,
    plano: 'trial', status: 'trial', trialAte: trialAte.toISOString(), validoAteMs: trialAte.getTime(),
    valorMensal: 0, criadoEm: now(),
    termosAceitosEm: now(), // evidência do aceite dos Termos de Uso/Privacidade no cadastro (checkbox obrigatório)
    config: { horaInicio: 8, horaFim: 19, intervalo: 30 }
  });
  // perfil só pode ser criado depois da clínica (regra exige ownerUid == uid)
  await setDoc(doc(db, 'usuarios', user.uid), {
    clinicaId: clinicaRef.id, papel: 'admin', nome: nome || user.displayName || '', email: user.email,
    ativo: true, criadoEm: now()
  });
  // espelho do perfil dentro da clínica (lista da equipe)
  await setDoc(doc(db, 'clinicas', clinicaRef.id, 'equipe', user.uid), {
    nome: nome || user.displayName || '', email: user.email, papel: 'admin', ativo: true, criadoEm: now()
  });
  return clinicaRef.id;
}

// ---------- Permissões por papel ----------
export const PAPEIS = {
  admin: 'Administrador',
  veterinario: 'Veterinário(a)',
  recepcao: 'Recepção',
  groomer: 'Banho & Tosa'
};

const ACESSO = {
  admin: '*',
  veterinario: ['dashboard', 'agenda', 'clientes', 'pets', 'prontuarios', 'vacinas', 'internacao', 'produtos', 'fornecedores', 'pdv', 'relatorios'],
  recepcao: ['dashboard', 'agenda', 'clientes', 'pets', 'vacinas', 'produtos', 'pdv', 'financeiro', 'fiscal'],
  groomer: ['dashboard', 'agenda', 'clientes', 'pets']
};

export const MODULOS = ['dashboard', 'agenda', 'clientes', 'pets', 'prontuarios', 'vacinas', 'internacao', 'pdv', 'produtos', 'fornecedores', 'financeiro', 'fiscal', 'relatorios', 'marketing', 'bi', 'auditoria', 'configuracoes'];

export const pode = (rota) => {
  const a = ACESSO[state.perfil?.papel] || [];
  const extras = state.perfil?.modulosExtras || [];
  const bloqueados = state.perfil?.modulosBloqueados || [];
  return (a === '*' || a.includes(rota) || extras.includes(rota)) && !bloqueados.includes(rota);
};

// ---------- Módulos exclusivos de planos pagos mais caros ----------
// O trial libera tudo por 14 dias (pra sentir o valor antes de decidir o plano). Fora do trial, cada
// módulo aqui exige o nível mínimo indicado; quem está num plano abaixo disso ainda VÊ o item no menu
// (isso vende o upgrade), mas a tela mostra uma chamada para assinar em vez do conteúdo de verdade.
const NIVEL_PLANO = { basico: 0, pro: 1, premium: 2 };
export const MODULOS_PREMIUM = { marketing: 1, bi: 2 }; // 1 = Profissional ou superior, 2 = só Premium
export function nivelPlanoAtual() {
  const p = state.clinica?.plano;
  return p === 'trial' ? 99 : (NIVEL_PLANO[p] ?? -1);
}
export function podePlano(rota) {
  const nivel = MODULOS_PREMIUM[rota];
  return nivel == null || nivelPlanoAtual() >= nivel;
}
export function nomePlanoExigido(rota) {
  const nivel = MODULOS_PREMIUM[rota];
  return nivel >= 2 ? 'Premium' : 'Profissional';
}

// ---------- Licença (assinatura mensal) ----------
export function licenca() {
  const c = state.clinica || {};
  const ms = c.validoAteMs || 0;
  const dias = Math.ceil((ms - Date.now()) / 86400000);
  const ativa = ['trial', 'ativo'].includes(c.status) && ms > Date.now();
  return { ativa, dias, status: c.status, plano: c.plano, validoAte: ms ? new Date(ms) : null };
}

// ---------- Planos da assinatura (fonte única para app, landing e painel SaaS) ----------
export const PLANOS = {
  trial:   { nome: 'Teste grátis', preco: 0,      usuarios: 3,  destaque: false, recursos: ['Todos os recursos, inclusive Premium, por 14 dias'] },
  basico:  { nome: 'Básico',       preco: 79.9,   usuarios: 2,  destaque: false, recursos: ['Agenda e cadastro de tutores/pets', 'Prontuário e vacinas', 'PDV e estoque', 'Até 2 usuários'] },
  pro:     { nome: 'Profissional', preco: 149.9,  usuarios: 5,  destaque: true,  recursos: ['Tudo do Básico', 'Financeiro completo', 'Relatórios gerenciais', 'Central de Marketing (campanhas por WhatsApp)', 'Até 5 usuários'] },
  premium: { nome: 'Premium',      preco: 249.9,  usuarios: 99, destaque: false, recursos: ['Tudo do Profissional', 'BI avançado (retenção, LTV, previsão de estoque)', 'Usuários ilimitados', 'Multiunidades', 'Suporte prioritário'] }
};

export async function carregarPlanos() {
  try {
    const snap = await getDocs(collection(db, 'planos'));
    snap.forEach(d => {
      const plano = PLANOS[d.id];
      const preco = Number(d.data()?.preco);
      if (plano && d.id !== 'trial' && Number.isFinite(preco) && preco >= 0) plano.preco = preco;
    });
  } catch (e) {
    console.warn('Não foi possível carregar os preços dos planos. Usando valores padrão.', e);
  }
  return PLANOS;
}

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
  return r.id;
}

export const update = (name, id, data) => updateDoc(ref(name, id), { ...data, atualizadoEm: now() });
export const remove = (name, id) => deleteDoc(ref(name, id));
export const save = (name, id, data) => (id ? update(name, id, data).then(() => id) : create(name, data));

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
  veterinario: ['dashboard', 'agenda', 'clientes', 'pets', 'prontuarios', 'vacinas', 'produtos', 'fornecedores', 'pdv', 'relatorios'],
  recepcao: ['dashboard', 'agenda', 'clientes', 'pets', 'vacinas', 'produtos', 'pdv', 'financeiro'],
  groomer: ['dashboard', 'agenda', 'clientes', 'pets']
};

export const pode = (rota) => {
  const a = ACESSO[state.perfil?.papel] || [];
  return a === '*' || a.includes(rota);
};

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
  trial:   { nome: 'Teste grátis', preco: 0,      usuarios: 3,  destaque: false, recursos: ['Todos os recursos por 14 dias'] },
  basico:  { nome: 'Básico',       preco: 79.9,   usuarios: 2,  destaque: false, recursos: ['Agenda e cadastro de tutores/pets', 'Prontuário e vacinas', 'PDV e estoque', 'Até 2 usuários'] },
  pro:     { nome: 'Profissional', preco: 149.9,  usuarios: 5,  destaque: true,  recursos: ['Tudo do Básico', 'Financeiro completo', 'Relatórios gerenciais', 'Lembretes por WhatsApp', 'Até 5 usuários'] },
  premium: { nome: 'Premium',      preco: 249.9,  usuarios: 99, destaque: false, recursos: ['Tudo do Profissional', 'Usuários ilimitados', 'Multiunidades', 'Suporte prioritário'] }
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

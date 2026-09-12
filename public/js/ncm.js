// ================= Tabela de NCM (Siscomex) — cache local (IndexedDB) + busca =================
// A tabela completa (~10 mil códigos) é baixada uma vez do backend (que busca na fonte oficial e
// guarda em cache) e fica salva no navegador. As buscas seguintes são instantâneas, offline.
import { chamarFuncao } from './firebase.js';
import { esc, norm } from './ui.js';

const DB_NAME = 'petzy-ncm', STORE = 'itens', VERSAO_KEY = 'pz-ncm-versao';

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'codigo' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let cacheMemoria = null;   // array carregado uma vez por sessão
let carregando = null;     // evita duas cargas/baixas simultâneas

export const versaoLocal = () => localStorage.getItem(VERSAO_KEY) || '';
export const fmtCodigo = (c) => String(c || '').replace(/\D/g, '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');

async function contarLocal() {
  try {
    const db = await abrirDB();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  } catch { return 0; }
}

async function lerLocal() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function salvarLocal(itens, versao) {
  const db = await abrirDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const s = tx.objectStore(STORE);
    s.clear();
    for (const it of itens) s.put(it);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  localStorage.setItem(VERSAO_KEY, versao);
  cacheMemoria = itens;
}

// Baixa a tabela (ou usa o cache do servidor) e grava localmente.
// forcar:true refaz a busca na fonte oficial (Siscomex) — só o admin pode.
export async function atualizarTabela({ forcar = false } = {}) {
  const r = await chamarFuncao('baixarTabelaNcm', { forcar });
  await salvarLocal(r.itens, r.atualizadoEm);
  return { total: r.total, atualizadoEm: r.atualizadoEm, vigencia: r.vigencia, deCache: r.deCache, fonteIndisponivel: r.fonteIndisponivel };
}

// Garante que existe uma cópia local pronta para buscar; baixa em segundo plano na primeira vez.
export async function garantirCache() {
  if (cacheMemoria) return cacheMemoria;
  if (carregando) return carregando;
  carregando = (async () => {
    const n = await contarLocal();
    if (n > 5000) { cacheMemoria = await lerLocal(); return cacheMemoria; }
    try { await atualizarTabela({ forcar: false }); } catch { /* segue sem a tabela completa; buscas ficam vazias até o admin atualizar */ }
    return cacheMemoria || [];
  })();
  try { return await carregando; } finally { carregando = null; }
}

// A tabela usa a terminologia aduaneira oficial, que às vezes diverge da linguagem do dia a dia de
// um petshop (ex.: a Receita Federal escreve "alimentos", nunca "ração"). Esta lista cobre os casos
// mais comuns: cada termo do dia a dia aceita também o(s) termo(s) oficial(is) equivalente(s).
const SINONIMOS = {
  racao: ['alimento'], petisco: ['alimento'], coleira: ['trela'], guia: ['trela'], peitoral: ['trela'],
  antipulgas: ['inseticida', 'parasiticida'], carrapaticida: ['inseticida', 'parasiticida'], vermifugo: ['antihelmintico', 'anti-helmintico'],
  shampoo: ['xampu'], mordedor: ['brinquedo'], brinquedo: ['brinquedo'], caminha: ['almofada'], cama: ['almofada'],
  aquario: ['aquario', 'peixe ornamental'], gaiola: ['gaiola', 'passaro'], areia: ['mineral', 'silicato']
};

// "inclui termo" respeitando início de palavra: sem isso, "trela" "achava" também "esTRELAdo"
// (anis-estrelado), porque é uma substring válida no meio da palavra errada.
function comFronteira(alvo, termo) {
  let i = alvo.indexOf(termo);
  while (i !== -1) {
    if (i === 0 || !/[a-z0-9]/.test(alvo[i - 1])) return true; // início da palavra (o final fica livre: "aliment" bate com "alimentos")
    i = alvo.indexOf(termo, i + 1);
  }
  return false;
}

export function buscar(itens, termo, limite = 40) {
  const q = norm(termo).trim();
  if (!q) return [];
  const digitos = q.replace(/\D/g, '');
  const porCodigo = digitos.length >= 2 && digitos.length === q.replace(/[.\s]/g, '').length;
  const r = [];
  if (porCodigo) {
    for (const it of itens) { if (it.codigo.startsWith(digitos)) { r.push(it); if (r.length >= limite) break; } }
    return r;
  }
  // descrição: todas as palavras digitadas precisam aparecer (em qualquer ordem, aceitando sinônimos), como nas outras buscas do sistema
  const termos = q.split(/\s+/).filter(Boolean).map(t => [t, ...(SINONIMOS[t] || [])]);
  for (const it of itens) {
    const alvo = norm(it.descricao);
    if (termos.every(opcoes => opcoes.some(t => comFronteira(alvo, t)))) { r.push(it); if (r.length >= limite) break; }
  }
  return r;
}

// Liga um <input> de texto a um buscador de NCM: digita, mostra sugestões (código + descrição),
// clique preenche com o código formatado. O <input> mantém seu id/name — só ganha um dropdown ao lado.
export function ligarBuscaNcm(input, { onEscolher } = {}) {
  if (input.dataset.ncmOk) return;
  input.dataset.ncmOk = '1';
  const wrap = document.createElement('div');
  wrap.className = 'sb position-relative';
  input.replaceWith(wrap);
  wrap.appendChild(input);
  input.classList.add('sb-input');
  input.autocomplete = 'off';
  const lista = document.createElement('div');
  lista.className = 'sb-list';
  lista.hidden = true;
  wrap.appendChild(lista);

  garantirCache(); // dispara o carregamento; a busca funciona assim que terminar

  function desenhar() {
    const itens = cacheMemoria || [];
    const r = buscar(itens, input.value);
    lista.innerHTML = r.length ? r.map(it => `<div class="sb-item" data-c="${it.codigo}">
        <strong>${fmtCodigo(it.codigo)}</strong> <span class="text-muted">${esc(it.descricao)}</span></div>`).join('')
      : `<div class="sb-info">${itens.length ? 'Nenhum resultado. A tabela usa termos técnicos da Receita Federal — tente palavras mais genéricas (ex.: "alimento" em vez de "ração") ou use "Sugerir pela categoria".' : 'Carregando tabela de NCM…'}</div>`;
    lista.hidden = false;
  }
  input.addEventListener('focus', desenhar);
  input.addEventListener('input', desenhar);
  input.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; }, 150));
  lista.addEventListener('mousedown', (e) => {
    const it = e.target.closest('[data-c]'); if (!it) return;
    e.preventDefault();
    input.value = fmtCodigo(it.dataset.c);
    lista.hidden = true;
    onEscolher?.(it.dataset.c);
  });
}

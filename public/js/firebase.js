
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile, GoogleAuthProvider, signInWithPopup, signInWithCustomToken
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, writeBatch, increment
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, connectStorageEmulator, ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { firebaseConfig } from './config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Cache persistente (IndexedDB): dados já carregados ficam disponíveis sem internet, e gravações
// feitas offline (ex.: uma venda no PDV) ficam na fila local e sincronizam sozinhas quando a conexão
// voltar — sem isso, cair a internet no meio de uma venda faria a clínica perder aquela venda.
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  console.warn('Cache offline do Firestore indisponível neste navegador; seguindo só online.', e);
  db = getFirestore(app);
}
export { db };
export const storage = getStorage(app);

// Indicador simples de conectividade, usado na barra superior do app e para travar ações
// que dependem de um servidor ao vivo (Cloud Functions) enquanto o navegador está offline.
export const online = { valor: navigator.onLine, ouvintes: new Set() };
function atualizarOnline(v) { online.valor = v; online.ouvintes.forEach(fn => fn(v)); }
window.addEventListener('online', () => atualizarOnline(true));
window.addEventListener('offline', () => atualizarOnline(false));
export const aoMudarConexao = (fn) => { online.ouvintes.add(fn); return () => online.ouvintes.delete(fn); };
// Desenvolvimento: http://localhost:5000/?emu=1 usa os emuladores locais (dados isolados da produção)
export const emulador = ['localhost', '127.0.0.1'].includes(location.hostname) && (new URLSearchParams(location.search).has('emu') || sessionStorage.getItem('pz-emu') === '1');
if (emulador) {
  sessionStorage.setItem('pz-emu', '1');
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

// Cloud Functions (mesma região do backend)
export const functions = getFunctions(app, 'southamerica-east1');
if (emulador) connectFunctionsEmulator(functions, '127.0.0.1', 5001);
export async function chamarFuncao(nome, dados) {
  // Cloud Functions não tem cache offline como o Firestore: sem isso, a chamada trava até o timeout
  // e o usuário só descobre o motivo real numa mensagem genérica de rede.
  if (!online.valor) throw Object.assign(new Error('Você está sem conexão com a internet agora. Esta ação (' + nome.replace(/([A-Z])/g, ' $1').toLowerCase() + ') precisa de internet — tente de novo assim que a conexão voltar.'), { code: 'functions/unavailable' });
  return (await httpsCallable(functions, nome, { timeout: 70000 })(dados)).data;
}

// Mensagem legível para erros das Cloud Functions
export function mensagemErroFuncao(e) {
  const code = String(e?.code || '').replace('functions/', '');
  if (code === 'internal' && /^internal$/i.test(e?.message || '')) return 'O serviço está indisponível no momento. Tente novamente em alguns minutos.';
  if (code === 'deadline-exceeded') return 'O servidor demorou para responder. Tente novamente em instantes.';
  return e?.message || 'Não foi possível concluir a operação.';
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

isSupported().then(ok => ok && getAnalytics(app)).catch(() => {});

export {
  initializeApp, deleteApp, firebaseConfig, getFunctions, httpsCallable,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithCustomToken,
  signOut, sendPasswordResetEmail, updateProfile, signInWithPopup, GoogleAuthProvider, getAuth, connectAuthEmulator,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, writeBatch, increment,
  ref, uploadBytes, getDownloadURL, deleteObject
};

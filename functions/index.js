const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');

initializeApp();
const db = getFirestore();
const tecnospeedApiKey = defineSecret('TECNOSPEED_API_KEY');
const tecnospeedBaseUrl = defineString('TECNOSPEED_API_BASE_URL', {
  default: 'https://api.plugnotas.com.br'
});

const endpoints = { nf: 'nfe', nfe: 'nfe', nfce: 'nfce', nfse: 'nfse' };

function assertPayload(data) {
  if (!data || typeof data !== 'object' || !data.tipo || !data.payload || typeof data.payload !== 'object') {
    throw new HttpsError('invalid-argument', 'Envie tipo e payload fiscal.');
  }
  if (!endpoints[data.tipo]) throw new HttpsError('invalid-argument', 'Tipo fiscal não suportado.');
}

exports.enviarDocumentoTecnoSpeed = onCall({
  region: 'southamerica-east1',
  secrets: [tecnospeedApiKey],
  timeoutSeconds: 60,
  memory: '256MiB'
}, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para emitir documentos.');
  assertPayload(request.data);

  const perfilSnap = await db.doc(`usuarios/${request.auth.uid}`).get();
  const perfil = perfilSnap.data();
  if (!perfil?.clinicaId || !['admin', 'recepcao'].includes(perfil.papel)) {
    throw new HttpsError('permission-denied', 'Apenas administradores e recepção podem emitir documentos.');
  }

  const clinicaRef = db.doc(`clinicas/${perfil.clinicaId}`);
  const clinicaSnap = await clinicaRef.get();
  const clinica = clinicaSnap.data();
  if (clinica?.fiscal?.provedor !== 'tecnospeed') {
    throw new HttpsError('failed-precondition', 'Configure TecnoSpeed em Configurações > Dados.');
  }

  const tipo = request.data.tipo;
  const url = `${tecnospeedBaseUrl.value().replace(/\/$/, '')}/${endpoints[tipo]}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': tecnospeedApiKey.value() },
    body: JSON.stringify(request.data.payload)
  });
  const text = await response.text();
  let retorno;
  try { retorno = JSON.parse(text); } catch { retorno = { resposta: text }; }

  if (!response.ok) {
    throw new HttpsError('failed-precondition', 'TecnoSpeed rejeitou o documento.', { status: response.status, retorno });
  }

  if (request.data.documentoId) {
    await db.doc(`clinicas/${perfil.clinicaId}/fiscal/${request.data.documentoId}`).set({
      status: 'pendente', provedor: 'tecnospeed', protocolo: retorno.id || retorno.protocolo || null,
      retornoTecnoSpeed: retorno, atualizadoEm: FieldValue.serverTimestamp()
    }, { merge: true });
  }
  return { ok: true, tipo, retorno };
});

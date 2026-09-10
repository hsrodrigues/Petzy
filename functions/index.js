const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

initializeApp();
const db = getFirestore();
const tecnospeedApiKey = defineSecret('TECNOSPEED_API_KEY');
const tecnospeedBaseUrl = defineString('TECNOSPEED_API_BASE_URL', {
  default: 'https://api.plugnotas.com.br'
});

const endpoints = { nf: 'nfe', nfe: 'nfe', nfce: 'nfce', nfse: 'nfse' };

exports.configurarTokenTecnoSpeed = onCall({
  region: 'southamerica-east1',
  timeoutSeconds: 30,
  memory: '256MiB'
}, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para configurar o token.');
  const perfilSnap = await db.doc(`usuarios/${request.auth.uid}`).get();
  const perfil = perfilSnap.data();
  if (!perfil?.clinicaId || perfil.papel !== 'admin') throw new HttpsError('permission-denied', 'Apenas o administrador pode configurar o token.');
  const token = String(request.data?.token || '').trim();
  if (token.length < 10 || token.length > 500) throw new HttpsError('invalid-argument', 'Token TecnoSpeed inválido.');

  const secretManager = new SecretManagerServiceClient();
  const projectId = process.env.GCLOUD_PROJECT;
  const secretName = `projects/${projectId}/secrets/TECNOSPEED_API_KEY`;
  try {
    await secretManager.getSecret({ name: secretName });
  } catch (error) {
    await secretManager.createSecret({ parent: `projects/${projectId}`, secretId: 'TECNOSPEED_API_KEY', secret: { replication: { automatic: {} } } });
  }
  await secretManager.addSecretVersion({ parent: secretName, payload: { data: Buffer.from(token, 'utf8') } });
  return { ok: true };
});

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

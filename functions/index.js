// ================= Petzy · Cloud Functions · Integração fiscal (TecnoSpeed / PlugNotas) =================
// Regras de ouro:
//  - o navegador nunca vê a API key e nunca monta o documento fiscal: o servidor lê a nota do
//    Firestore e força o CNPJ do emitente da própria clínica (isolamento entre clínicas);
//  - o token da plataforma só pode ser trocado pelo superadmin;
//  - o ambiente escolhido pela clínica é respeitado ("teste" = sandbox, sem valor fiscal);
//  - NCM/CFOP são validados aqui: o sandbox da PlugNotas autoriza até NCM inválido.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { randomUUID } = require('crypto');
// Bibliotecas pesadas (Secret Manager, Storage) são carregadas sob demanda, só quando usadas.

initializeApp();
const db = getFirestore();

// Declarado nas funções para que o deploy conceda leitura do segredo à conta de serviço.
// O valor é lido na hora (versão "latest"), então trocar o token pelo painel vale sem novo deploy.
const SEGREDO = 'TECNOSPEED_API_KEY';
const TECNOSPEED_API_KEY = defineSecret(SEGREDO);
const NAO_CONFIGURADO = 'NAO_CONFIGURADO';
// Chave gratuita da Groq (console.groq.com, sem cartão) — usada só pelo gerador de laudo com IA.
// Configurada uma vez via `firebase functions:secrets:set GROQ_API_KEY`.
const GROQ_API_KEY = defineSecret('GROQ_API_KEY');

const PRODUCAO_URL = 'https://api.plugnotas.com.br';
// Sandbox público da PlugNotas: empresa de demonstração, notas SEM valor fiscal.
const SANDBOX = { url: 'https://api.sandbox.plugnotas.com.br', chave: '2da392a6-79d2-4304-a8b7-959572c7e44d', cnpjDemo: '08187168000160' };

// Cosmos Bluesoft: base de produtos brasileira (cosmos.bluesoft.com.br, nível gratuito com token).
// Usada como segunda tentativa quando a Open Food Facts (internacional, sem token) não encontra o
// código — cobre bem mais marca nacional de petshop. Enquanto o token não estiver configurado, essa
// segunda tentativa é simplesmente pulada (a busca continua funcionando só com a primeira fonte).
const COSMOS_API_KEY = defineSecret('COSMOS_API_KEY');

const OPCOES = { region: 'southamerica-east1', timeoutSeconds: 60, memory: '256MiB' };
const COM_SEGREDO = { ...OPCOES, secrets: [TECNOSPEED_API_KEY] };
const COM_GROQ = { ...OPCOES, timeoutSeconds: 30, secrets: [GROQ_API_KEY] };
const COM_COSMOS = { ...OPCOES, timeoutSeconds: 20, secrets: [COSMOS_API_KEY] };
const PROVEDORES = ['tecnospeed', 'plugnotas'];
const MOTIVOS_CANCELAMENTO = { 1: 'Erro na emissão', 2: 'Serviço não prestado', 4: 'Duplicidade da nota' };
const NOMES = { nfse: 'NFS-e', nfce: 'NFC-e', nfe: 'NF-e' };

// Rotas da PlugNotas por tipo (confirmadas no sandbox)
const ROTAS = {
  emitir: (t) => `/${t}`,
  consultar: (t, n) => t === 'nfse' ? `/nfse/consultar/${encodeURIComponent(n.protocolo)}` : `/${t}/${n.idProvedor}/resumo`,
  arquivo: (t, id, fmt) => t === 'nfse' ? `/nfse/${fmt}/${id}` : `/${t}/${id}/${fmt}`,
  cancelar: (t, id) => t === 'nfse' ? `/nfse/cancelar/${id}` : `/${t}/${id}/cancelamento`
};

// Meios de pagamento da SEFAZ (tPag)
const MEIOS = { 'Dinheiro': '01', 'Cheque': '02', 'Cartão de crédito': '03', 'Cartão de débito': '04', 'Fiado (a receber)': '05', 'Crediário': '05', 'Boleto': '15', 'PIX': '17', 'Transferência': '18' };
const UNIDADES = { un: 'UN', kg: 'KG', g: 'G', ml: 'ML', l: 'L', cx: 'CX', pct: 'PCT' };

const digitos = (s) => String(s || '').replace(/\D/g, '');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const agora = () => FieldValue.serverTimestamp();
const projeto = () => process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
const idValido = (id) => /^[A-Za-z0-9]{10,40}$/.test(id);

// ---------------- segredo ----------------
let cacheChave = { valor: null, ate: 0 };
let secretClient = null;
const sm = () => {
  if (!secretClient) {
    const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
    secretClient = new SecretManagerServiceClient();
  }
  return secretClient;
};

async function chaveProducao() {
  if (cacheChave.valor && Date.now() < cacheChave.ate) return cacheChave.valor;
  let valor = '';
  try {
    const [versao] = await sm().accessSecretVersion({ name: `projects/${projeto()}/secrets/${SEGREDO}/versions/latest` });
    valor = versao.payload.data.toString('utf8').trim();
  } catch (e) {
    logger.warn('Secret Manager indisponível; usando o valor fixado no deploy.', { erro: e.message });
    valor = String(process.env[SEGREDO] || '').trim();
  }
  if (!valor || valor === NAO_CONFIGURADO) {
    throw new HttpsError('failed-precondition', 'A integração com a TecnoSpeed ainda não foi ativada pelo administrador do Petzy.');
  }
  cacheChave = { valor, ate: Date.now() + 60_000 };
  return valor;
}

// ---------------- contexto e permissões ----------------
// Contexto leve: só confere que o usuário está logado e ativo (sem exigir o módulo fiscal nem licença).
// Usado pela tabela de NCM, que não é específica de nenhum módulo.
async function contextoBase(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
  const perfil = (await db.doc(`usuarios/${request.auth.uid}`).get()).data();
  if (!perfil?.clinicaId || perfil.ativo !== true) throw new HttpsError('permission-denied', 'Seu acesso está inativo.');
  return { uid: request.auth.uid, perfil };
}

async function contexto(request, { exigirLicenca = true, exigirProvedor = true } = {}) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
  const perfil = (await db.doc(`usuarios/${request.auth.uid}`).get()).data();
  if (!perfil?.clinicaId || perfil.ativo !== true) throw new HttpsError('permission-denied', 'Seu acesso está inativo.');
  const extras = Array.isArray(perfil.modulosExtras) ? perfil.modulosExtras : [];
  const bloqueados = Array.isArray(perfil.modulosBloqueados) ? perfil.modulosBloqueados : [];
  const podeFiscal = (['admin', 'recepcao'].includes(perfil.papel) || extras.includes('fiscal') || extras.includes('pdv')) && !bloqueados.includes('fiscal');
  if (!podeFiscal) throw new HttpsError('permission-denied', 'Seu perfil não tem acesso ao módulo fiscal.');

  const clinica = (await db.doc(`clinicas/${perfil.clinicaId}`).get()).data() || {};
  if (exigirLicenca && !(['trial', 'ativo'].includes(clinica.status) && clinica.validoAteMs > Date.now())) {
    throw new HttpsError('failed-precondition', 'Licença vencida: regularize a assinatura para emitir notas.');
  }
  const fiscal = clinica.fiscal || {};
  if (exigirProvedor && !PROVEDORES.includes(fiscal.provedor)) {
    throw new HttpsError('failed-precondition', 'Selecione "TecnoSpeed / PlugNotas" em Configurações > Dados > Integração fiscal.');
  }
  return { uid: request.auth.uid, perfil, cid: perfil.clinicaId, clinica, fiscal };
}

async function conexao(ambiente) {
  if (ambiente === 'teste') return { url: SANDBOX.url, chave: SANDBOX.chave, teste: true };
  return { url: PRODUCAO_URL, chave: await chaveProducao(), teste: false };
}

// ---------------- cliente HTTP da PlugNotas ----------------
async function chamar(con, metodo, caminho, corpo, { binario = false } = {}) {
  let resp;
  try {
    resp = await fetch(con.url + caminho, {
      method: metodo,
      headers: { 'x-api-key': con.chave, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(25_000)
    });
  } catch (e) {
    const erro = new Error('Não foi possível falar com a TecnoSpeed agora. Tente novamente em instantes.');
    erro.transitorio = true;
    throw erro;
  }
  if (binario && resp.ok) return Buffer.from(await resp.arrayBuffer());
  const texto = await resp.text();
  let json;
  try { json = JSON.parse(texto); } catch { json = { message: texto.slice(0, 300) }; }
  if (!resp.ok) {
    const campos = json?.error?.data?.fields;
    const detalhe = campos ? Object.entries(campos).map(([k, v]) => `${k.replace(/^documento\[\d+\]\./, '')}: ${v}`).join('; ') : '';
    let msg = json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || json?.message || `HTTP ${resp.status}`;
    if (resp.status === 401 || resp.status === 403) msg = 'Token da TecnoSpeed inválido ou sem permissão.';
    const erro = new Error(detalhe ? `${msg} (${detalhe})` : msg);
    erro.status = resp.status;
    erro.transitorio = resp.status >= 500 || resp.status === 429;
    throw erro;
  }
  return json;
}

const paraHttps = (e) => e instanceof HttpsError ? e
  : new HttpsError(e.transitorio ? 'unavailable' : (e.status === 401 || e.status === 403) ? 'failed-precondition' : 'invalid-argument', e.message);

function cnpjEmitente(clinica, fiscal, teste) {
  const cnpj = teste ? SANDBOX.cnpjDemo : digitos(fiscal.cnpj || clinica.cnpj);
  if (![11, 14].includes(cnpj.length)) throw new HttpsError('failed-precondition', 'Informe o CNPJ do emitente em Configurações > Dados > Integração fiscal.');
  return cnpj;
}

// ---------------- NFS-e (serviços) ----------------
function montarNfse({ idIntegracao, nota, clinica, fiscal, destDoc, teste }) {
  const cnpj = cnpjEmitente(clinica, fiscal, teste);
  const valor = r2(nota.valor);
  if (!(valor > 0)) throw new HttpsError('invalid-argument', 'O valor da nota deve ser maior que zero.');
  const discriminacao = String(nota.descricao || '').trim();
  if (discriminacao.length < 3) throw new HttpsError('invalid-argument', 'Descreva os serviços prestados.');

  const tipoTributacao = Number(fiscal.tipoTributacao) || 6;
  const isento = [1, 2, 3, 4].includes(tipoTributacao);
  const aliquota = fiscal.aliquotaIss === '' || fiscal.aliquotaIss == null ? (teste ? 2 : null) : Number(fiscal.aliquotaIss);
  if (!isento && !(aliquota >= 0)) throw new HttpsError('failed-precondition', 'Configure a alíquota de ISS em Configurações > Dados > Integração fiscal.');

  const t = destDoc || {};
  const tomador = { razaoSocial: String(t.nome || nota.tomadorNome || 'Consumidor final').slice(0, 115) };
  const doc = digitos(t.cpf || t.cnpj || nota.tomadorCpf);
  if (doc) tomador.cpfCnpj = doc;
  if (t.email) tomador.email = t.email;
  if (t.ibge && t.cep && t.endereco) tomador.endereco = enderecoDe(t);

  return {
    total: valor,
    payload: [{
      idIntegracao,
      prestador: { cpfCnpj: cnpj },
      tomador,
      servico: [{
        codigo: fiscal.codigoServico || '05.01', // LC 116: 5.01 medicina veterinária e zootecnia
        cnae: digitos(fiscal.cnae) || '7500100',  // CNAE 7500-1/00 atividades veterinárias
        discriminacao: discriminacao.slice(0, 2000),
        iss: { tipoTributacao, exigibilidade: 1, aliquota: isento ? 0 : aliquota },
        valor: { servico: valor }
      }]
    }]
  };
}

const enderecoDe = (t) => ({
  logradouro: t.endereco, numero: t.numero || 'S/N', bairro: t.bairro || 'Centro',
  codigoCidade: String(t.ibge), descricaoCidade: t.cidade || '', estado: String(t.uf || '').toUpperCase(), cep: digitos(t.cep)
});

// ---------------- NF-e / NFC-e (produtos) ----------------
function icmsDoItem(simples, origem, situacao, base, fiscal) {
  if (simples) return { origem, cst: situacao }; // CSOSN (Simples Nacional)
  if (situacao === '00') {
    const aliquota = Number(fiscal.aliquotaIcms ?? 17);
    return { origem, cst: '00', baseCalculo: { modalidadeDeterminacao: 3, valor: r2(base) }, aliquota, valor: r2(base * aliquota / 100) };
  }
  return { origem, cst: situacao }; // 40/41/60: isenta, não tributada, ST cobrada anteriormente
}

function montarItens(nota, fiscal, simples) {
  const itens = Array.isArray(nota.itens) ? nota.itens : [];
  if (!itens.length) throw new HttpsError('invalid-argument', 'Adicione ao menos um produto à nota.');
  if (itens.length > 500) throw new HttpsError('invalid-argument', 'A nota pode ter no máximo 500 itens.');
  const bruto = r2(itens.reduce((s, i) => s + Number(i.qtd) * Number(i.preco), 0));
  const desconto = Math.max(0, Math.min(r2(nota.desconto), r2(bruto - 0.01)));
  let restante = desconto;

  return itens.map((i, idx) => {
    const nome = String(i.nome || '').trim();
    const ncm = digitos(i.ncm);
    if (ncm.length !== 8) throw new HttpsError('failed-precondition', `O produto "${nome || idx + 1}" está sem NCM válido (8 dígitos). Ajuste em Produtos & Serviços.`);
    const cfop = digitos(i.cfop || fiscal.cfopPadrao || '5102');
    if (cfop.length !== 4) throw new HttpsError('failed-precondition', `CFOP inválido no produto "${nome}".`);
    const qtd = Number(i.qtd), preco = r2(i.preco);
    if (!(qtd > 0) || !(preco > 0)) throw new HttpsError('invalid-argument', `Quantidade e preço do produto "${nome}" devem ser maiores que zero.`);
    const valor = r2(qtd * preco);
    const desc = idx === itens.length - 1 ? r2(restante) : r2(desconto * valor / bruto);
    restante = r2(restante - desc);
    const origem = String(i.origem ?? fiscal.origemPadrao ?? '0');
    const situacao = String(i.icmsSituacao || (simples ? (fiscal.csosnPadrao || '102') : (fiscal.cstIcmsPadrao || '00')));
    const pisCofins = String(fiscal.cstPisCofins || (simples ? '49' : '99'));
    const un = UNIDADES[String(i.unidade || 'un').toLowerCase()] || 'UN';
    const item = {
      codigo: String(i.codigo || i.produtoId || idx + 1).slice(0, 60),
      descricao: nome.slice(0, 120), ncm, cfop,
      unidade: { comercial: un, tributavel: un },
      quantidade: { comercial: qtd, tributavel: qtd },
      valorUnitario: { comercial: preco, tributavel: preco },
      valor,
      tributos: {
        icms: icmsDoItem(simples, origem, situacao, valor - desc, fiscal),
        pis: { cst: pisCofins, baseCalculo: { valor: 0, quantidade: 0 }, aliquota: 0, valor: 0 },
        cofins: { cst: pisCofins, baseCalculo: { valor: 0 }, aliquota: 0, valor: 0 }
      }
    };
    if (desc > 0) item.valorDesconto = desc;
    if (digitos(i.cest).length === 7) item.cest = digitos(i.cest);
    return item;
  });
}

function montarProduto({ tipo, idIntegracao, nota, clinica, fiscal, destDoc, teste }) {
  const cnpj = cnpjEmitente(clinica, fiscal, teste);
  const simples = ['simples', 'mei'].includes(fiscal.regimeTributario || 'simples');
  const itens = montarItens(nota, fiscal, simples);
  const total = r2(itens.reduce((s, i) => s + i.valor - (i.valorDesconto || 0), 0));
  const d = destDoc || {};
  const doc = digitos(d.cpf || d.cnpj || nota.tomadorCpf);
  if (doc && ![11, 14].includes(doc.length)) throw new HttpsError('invalid-argument', 'CPF/CNPJ do destinatário inválido.');
  const meio = MEIOS[nota.pagamento] || '01';

  const nf = {
    idIntegracao, natureza: 'VENDA', presencial: true, consumidorFinal: doc.length !== 14,
    emitente: { cpfCnpj: cnpj },
    itens,
    pagamentos: [{ aVista: meio !== '05', meio, valor: total }]
  };
  if (tipo === 'nfe') {
    if (!doc) throw new HttpsError('failed-precondition', 'A NF-e exige o CPF ou CNPJ do destinatário.');
    if (!(d.ibge && d.cep && d.endereco)) throw new HttpsError('failed-precondition', 'A NF-e exige o endereço completo do destinatário. Preencha o CEP no cadastro do tutor para obter o código do município.');
    nf.finalidade = 'NORMAL';
    nf.destinatario = { cpfCnpj: doc, razaoSocial: String(d.nome || nota.tomadorNome || '').slice(0, 60), ...(d.email ? { email: d.email } : {}), endereco: enderecoDe(d) };
  } else if (doc) {
    nf.destinatario = { cpfCnpj: doc, ...(d.nome ? { razaoSocial: String(d.nome).slice(0, 60) } : {}) }; // "CPF na nota"
  }
  return { total, payload: [nf] };
}

// Trava de segurança: o cadastro da empresa na TecnoSpeed diz se ela emite em produção
async function empresaNaTecnoSpeed(con, cnpj) {
  try {
    const e = await chamar(con, 'GET', `/empresa/${cnpj}`);
    if (digitos(e?.cpfCnpj) !== cnpj) return null;
    const tipo = (t) => ({ ativo: e[t]?.ativo !== false && !!e[t], producao: e[t]?.config?.producao === true });
    return { razaoSocial: e.razaoSocial || '', tipos: { nfse: tipo('nfse'), nfce: tipo('nfce'), nfe: tipo('nfe') } };
  } catch (e) {
    if (e.status === 404 || e.status === 400) return null;
    throw e;
  }
}

async function salvarArquivos(con, cid, id, idProvedor, tipo, formatos = ['pdf', 'xml']) {
  const { getStorage } = require('firebase-admin/storage');
  const bucket = getStorage().bucket();
  const saida = {};
  for (const [fmt, mime] of [['pdf', 'application/pdf'], ['xml', 'application/xml']].filter(([f]) => formatos.includes(f))) {
    try {
      const conteudo = await chamar(con, 'GET', ROTAS.arquivo(tipo, idProvedor, fmt), null, { binario: true });
      const caminho = `clinicas/${cid}/fiscal/${id}.${fmt}`;
      await bucket.file(caminho).save(conteudo, {
        resumable: false, contentType: mime,
        metadata: { cacheControl: 'private, max-age=0', metadata: { firebaseStorageDownloadTokens: randomUUID() } }
      });
      saida[`${fmt}Path`] = caminho;
    } catch (e) {
      logger.warn(`Falha ao arquivar ${fmt} da nota ${id}`, { erro: e.message });
    }
  }
  return saida;
}

// ================= Funções chamadas pelo app =================

exports.emitirNotaFiscal = onCall(COM_SEGREDO, async (request) => {
  const ctx = await contexto(request);
  const id = String(request.data?.documentoId || '');
  if (!idValido(id)) throw new HttpsError('invalid-argument', 'Documento inválido.');
  const ref = db.doc(`clinicas/${ctx.cid}/fiscal/${id}`);

  // trava contra clique duplo / duas abas e contra duas NFC-e para a mesma venda
  const { nota, anterior } = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'Nota não encontrada.');
    const n = s.data();
    if (!NOMES[n.tipo]) throw new HttpsError('invalid-argument', 'Tipo de nota não suportado.');
    const status = n.status || 'rascunho';
    if (!['rascunho', 'rejeitada'].includes(status)) throw new HttpsError('failed-precondition', `Esta nota já está "${status}".`);

    let vendaRef = null;
    if (n.vendaId) {
      vendaRef = db.doc(`clinicas/${ctx.cid}/vendas/${n.vendaId}`);
      const venda = (await tx.get(vendaRef)).data();
      if (!venda) throw new HttpsError('not-found', 'Venda de origem não encontrada.');
      if (venda.nfceId && venda.nfceId !== id) {
        const outra = (await tx.get(db.doc(`clinicas/${ctx.cid}/fiscal/${venda.nfceId}`))).data();
        if (outra && ['enviando', 'processando', 'emitida', 'cancelando'].includes(outra.status)) {
          throw new HttpsError('failed-precondition', 'Esta venda já possui uma nota fiscal emitida ou em processamento.');
        }
      }
    }

    // nova tentativa só após rejeição do provedor; em falha de comunicação reaproveita o mesmo id (evita nota duplicada)
    const tentativa = status === 'rejeitada' ? (n.tentativas || 1) + 1 : (n.tentativas || 1);
    const idIntegracao = `PZ${id}${tentativa}`;
    tx.update(ref, { status: 'enviando', integracao: true, tentativas: tentativa, idIntegracao, atualizadoEm: agora() });
    if (vendaRef) tx.update(vendaRef, { nfceId: id, nfceStatus: 'enviando' });
    return { nota: { ...n, tentativas: tentativa, idIntegracao }, anterior: status };
  });

  const vendaRef = nota.vendaId ? db.doc(`clinicas/${ctx.cid}/vendas/${nota.vendaId}`) : null;
  try {
    const ambiente = ['teste', 'homologacao', 'producao'].includes(ctx.fiscal.ambiente) ? ctx.fiscal.ambiente : 'homologacao';
    const con = await conexao(ambiente);
    const destDoc = nota.clienteId ? (await db.doc(`clinicas/${ctx.cid}/clientes/${nota.clienteId}`).get()).data() : null;
    const args = { tipo: nota.tipo, idIntegracao: nota.idIntegracao, nota, clinica: ctx.clinica, fiscal: ctx.fiscal, destDoc, teste: con.teste };
    const { payload, total } = nota.tipo === 'nfse' ? montarNfse(args) : montarProduto(args);
    const emitenteCnpj = nota.tipo === 'nfse' ? payload[0].prestador.cpfCnpj : payload[0].emitente.cpfCnpj;

    let semValorFiscal = con.teste;
    if (!con.teste) {
      // dados de exemplo (CPFs gerados) nunca viram nota com valor fiscal
      const vendaDemo = nota.vendaId ? (await db.doc(`clinicas/${ctx.cid}/vendas/${nota.vendaId}`).get()).data()?.demo === true : false;
      if (nota.demo === true || destDoc?.demo === true || vendaDemo) {
        throw new HttpsError('failed-precondition', 'Dados de exemplo só podem gerar notas no modo teste (sem valor fiscal). Use tutores e vendas reais em homologação ou produção.');
      }
      const empresa = await empresaNaTecnoSpeed(con, emitenteCnpj);
      if (!empresa) throw new HttpsError('failed-precondition', 'O CNPJ da clínica ainda não está cadastrado na TecnoSpeed (empresa + certificado digital).');
      const cfg = empresa.tipos[nota.tipo];
      if (!cfg.ativo) throw new HttpsError('failed-precondition', `A emissão de ${NOMES[nota.tipo]} não está habilitada para esta empresa na TecnoSpeed.`);
      if (ambiente === 'homologacao' && cfg.producao) throw new HttpsError('failed-precondition', `A clínica está em homologação no Petzy, mas a ${NOMES[nota.tipo]} está em PRODUÇÃO na TecnoSpeed. Ajuste um dos dois antes de emitir.`);
      semValorFiscal = !cfg.producao;
    }

    const r = await chamar(con, 'POST', ROTAS.emitir(nota.tipo), payload);
    const doc = r?.documents?.[0] || {};
    await ref.update({
      status: 'processando', provedor: 'tecnospeed', ambiente, semValorFiscal, valor: total,
      idProvedor: doc.id || null, protocolo: r?.protocol || null, mensagem: r?.message || 'Nota em processamento',
      prestadorCnpj: emitenteCnpj, enviadaEm: agora(), enviadaPor: ctx.uid, atualizadoEm: agora()
    });
    if (vendaRef) await vendaRef.update({ nfceStatus: 'processando' });
    return { status: 'processando', semValorFiscal, total };
  } catch (e) {
    const rejeitada = !(e instanceof HttpsError) && !e.transitorio && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403;
    const novo = rejeitada ? 'rejeitada' : anterior;
    await ref.update({ status: novo, mensagem: e.message, atualizadoEm: agora() });
    if (vendaRef) await vendaRef.update({ nfceStatus: novo }).catch(() => {});
    logger.warn('Emissão não concluída', { cid: ctx.cid, id, tipo: nota.tipo, erro: e.message, status: e.status });
    throw paraHttps(e);
  }
});

exports.consultarNotaFiscal = onCall(COM_SEGREDO, async (request) => {
  const ctx = await contexto(request, { exigirLicenca: false, exigirProvedor: false });
  const id = String(request.data?.documentoId || '');
  if (!idValido(id)) throw new HttpsError('invalid-argument', 'Documento inválido.');
  const ref = db.doc(`clinicas/${ctx.cid}/fiscal/${id}`);
  const n = (await ref.get()).data();
  if (!n) throw new HttpsError('not-found', 'Nota não encontrada.');
  if (!n.integracao || !n.protocolo || !n.idProvedor) throw new HttpsError('failed-precondition', 'Esta nota ainda não foi transmitida.');

  try {
    const con = await conexao(n.ambiente); // usa o ambiente em que a nota foi emitida
    const lista = await chamar(con, 'GET', ROTAS.consultar(n.tipo, n));
    const itens = Array.isArray(lista) ? lista : [lista];
    const r = itens.find(x => x?.id === n.idProvedor) || itens[0] || {};
    const situacao = String(r.situacao || r.status || '').toUpperCase();
    const patch = { situacaoProvedor: situacao || null, mensagem: r.mensagem || n.mensagem || null, atualizadoEm: agora() };

    if (situacao === 'CONCLUIDO' && n.status !== 'cancelando') {
      Object.assign(patch, {
        status: 'emitida', numero: String(r.numeroNfse || r.numero || n.numero || ''), serie: String(r.serie || n.serie || ''),
        chave: r.chave || n.chave || null, codigoVerificacao: r.codigoVerificacao || null,
        protocoloAutorizacao: n.tipo === 'nfse' ? null : (r.protocolo || null),
        dataAutorizacao: r.autorizacao || r.dataAutorizacao || null, emitidaEm: n.emitidaEm || new Date().toISOString()
      });
      if (!n.pdfPath) Object.assign(patch, await salvarArquivos(con, ctx.cid, id, n.idProvedor, n.tipo));
    } else if (situacao === 'CANCELADO') {
      patch.status = 'cancelada';
      patch.canceladaEm = n.canceladaEm || new Date().toISOString();
    } else if (['REJEITADO', 'DENEGADO', 'ERRO'].includes(situacao)) {
      patch.status = n.status === 'cancelando' ? 'emitida' : 'rejeitada'; // cancelamento negado mantém a nota emitida
    }
    await ref.update(patch);
    if (n.vendaId && patch.status) {
      await db.doc(`clinicas/${ctx.cid}/vendas/${n.vendaId}`).update({ nfceStatus: patch.status, ...(patch.numero ? { nfceNumero: patch.numero } : {}) }).catch(() => {});
    }
    return { status: patch.status || n.status, situacao, mensagem: patch.mensagem };
  } catch (e) {
    throw paraHttps(e);
  }
});

exports.cancelarNotaFiscal = onCall(COM_SEGREDO, async (request) => {
  const ctx = await contexto(request, { exigirProvedor: false });
  const id = String(request.data?.documentoId || '');
  const codigo = Number(request.data?.codigo);
  const motivo = String(request.data?.motivo || '').trim();
  if (!idValido(id)) throw new HttpsError('invalid-argument', 'Documento inválido.');
  if (motivo.length < 15 || motivo.length > 255) throw new HttpsError('invalid-argument', 'A justificativa do cancelamento deve ter entre 15 e 255 caracteres.');
  const ref = db.doc(`clinicas/${ctx.cid}/fiscal/${id}`);

  const n = await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (!d) throw new HttpsError('not-found', 'Nota não encontrada.');
    if (!d.integracao || d.status !== 'emitida' || !d.idProvedor) throw new HttpsError('failed-precondition', 'Só é possível cancelar notas emitidas pelo Petzy.');
    if (d.tipo === 'nfse' && !MOTIVOS_CANCELAMENTO[codigo]) throw new HttpsError('invalid-argument', 'Escolha o motivo do cancelamento.');
    tx.update(ref, { status: 'cancelando', atualizadoEm: agora() });
    return d;
  });

  try {
    const con = await conexao(n.ambiente);
    const corpo = n.tipo === 'nfse' ? { codigo: String(codigo), motivo } : { justificativa: motivo };
    const r = await chamar(con, 'POST', ROTAS.cancelar(n.tipo, n.idProvedor), corpo);
    await ref.update({
      cancelamentoProtocolo: r?.data?.protocol || null, cancelamentoCodigo: n.tipo === 'nfse' ? codigo : null, cancelamentoMotivo: motivo,
      canceladaPor: ctx.uid, mensagem: r?.message || 'Cancelamento em processamento', atualizadoEm: agora()
    });
    return { status: 'cancelando' };
  } catch (e) {
    await ref.update({ status: 'emitida', mensagem: `Cancelamento não enviado: ${e.message}`, atualizadoEm: agora() });
    throw paraHttps(e);
  }
});

// Link seguro para o PDF/XML da nota. A permissão é checada aqui (membro da clínica),
// sem depender das regras do Storage; se o arquivo ainda não foi arquivado, busca na TecnoSpeed.
exports.linkArquivoNotaFiscal = onCall(COM_SEGREDO, async (request) => {
  const ctx = await contexto(request, { exigirLicenca: false, exigirProvedor: false });
  const id = String(request.data?.documentoId || '');
  const formato = request.data?.formato === 'xml' ? 'xml' : 'pdf';
  if (!idValido(id)) throw new HttpsError('invalid-argument', 'Documento inválido.');
  const ref = db.doc(`clinicas/${ctx.cid}/fiscal/${id}`);
  const n = (await ref.get()).data();
  if (!n) throw new HttpsError('not-found', 'Nota não encontrada.');

  const { getStorage } = require('firebase-admin/storage');
  const bucket = getStorage().bucket();
  let caminho = n[`${formato}Path`];
  const existe = caminho ? (await bucket.file(caminho).exists())[0] : false;
  if (!existe) {
    if (!n.integracao || !n.idProvedor || !['emitida', 'cancelada'].includes(n.status)) {
      throw new HttpsError('failed-precondition', 'O arquivo fica disponível depois que a nota é autorizada.');
    }
    try {
      const salvos = await salvarArquivos(await conexao(n.ambiente), ctx.cid, id, n.idProvedor, n.tipo, [formato]);
      caminho = salvos[`${formato}Path`];
      if (!caminho) throw new Error('A TecnoSpeed ainda não liberou o arquivo. Tente novamente em instantes.');
      await ref.update({ ...salvos, atualizadoEm: agora() });
    } catch (e) { throw paraHttps(e); }
  }

  const arquivo = bucket.file(caminho);
  const [meta] = await arquivo.getMetadata();
  let token = String(meta.metadata?.firebaseStorageDownloadTokens || '').split(',')[0];
  if (!token) {
    token = randomUUID();
    await arquivo.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
  }
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : 'https://firebasestorage.googleapis.com';
  return { url: `${host}/v0/b/${bucket.name}/o/${encodeURIComponent(caminho)}?alt=media&token=${token}` };
});

// Diagnóstico para a tela de configuração: o CNPJ está cadastrado? Quais notas estão habilitadas?
exports.verificarEmpresaFiscal = onCall(COM_SEGREDO, async (request) => {
  const ctx = await contexto(request, { exigirLicenca: false });
  if (ctx.perfil.papel !== 'admin') throw new HttpsError('permission-denied', 'Apenas o administrador da clínica pode verificar a integração.');
  try {
    const ambiente = ctx.fiscal.ambiente || 'homologacao';
    const con = await conexao(ambiente);
    const cnpj = cnpjEmitente(ctx.clinica, ctx.fiscal, con.teste);
    const empresa = await empresaNaTecnoSpeed(con, cnpj);
    return {
      ambiente, teste: con.teste, cnpj, cadastrada: !!empresa, razaoSocial: empresa?.razaoSocial || '', tipos: empresa?.tipos || null,
      nfseAtiva: empresa?.tipos.nfse.ativo || false, producao: empresa?.tipos.nfse.producao || false
    };
  } catch (e) {
    throw paraHttps(e);
  }
});

// ================= Tabela de NCM (classificação fiscal dos produtos) =================
// Fonte oficial: Siscomex (Receita Federal / Comex Stat). O download não libera CORS para o navegador,
// então o servidor busca, filtra e guarda em cache (Storage + Firestore) para as clínicas usarem offline.
const SISCOMEX_NCM_URL = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json';
const NCM_CACHE_PATH = 'sistema/ncm.json';
const NCM_CACHE_VALIDADE_MS = 24 * 3600 * 1000; // o Siscomex atualiza a tabela raramente; 1x por dia já cobre

async function lerCacheNcm(bucket) {
  const [buf] = await bucket.file(NCM_CACHE_PATH).download();
  return JSON.parse(buf.toString('utf8'));
}

// Metadados (data e tamanho da última atualização): leitura barata, sem baixar os ~10 mil códigos.
exports.metaTabelaNcm = onCall(OPCOES, async (request) => {
  await contextoBase(request);
  const meta = (await db.doc('sistema/ncmMeta').get()).data();
  return meta ? { atualizadoEm: meta.atualizadoEm, total: meta.total, vigencia: meta.vigencia || null } : null;
});

// Devolve a tabela completa (código de 8 dígitos + descrição). Com cache válido, serve do Storage;
// forcar:true refaz a busca na fonte oficial (só o administrador da clínica pode forçar).
exports.baixarTabelaNcm = onCall({ ...OPCOES, timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const ctx = await contextoBase(request);
  const forcar = request.data?.forcar === true;
  if (forcar && ctx.perfil.papel !== 'admin') throw new HttpsError('permission-denied', 'Apenas o administrador pode atualizar a tabela de NCM.');

  const { getStorage } = require('firebase-admin/storage');
  const bucket = getStorage().bucket();
  const metaRef = db.doc('sistema/ncmMeta');
  const meta = (await metaRef.get()).data();
  const cacheValido = meta && !forcar && (Date.now() - (meta.atualizadoMs || 0) < NCM_CACHE_VALIDADE_MS);

  if (cacheValido) {
    try {
      return { itens: await lerCacheNcm(bucket), atualizadoEm: meta.atualizadoEm, total: meta.total, vigencia: meta.vigencia || null, deCache: true };
    } catch (e) { logger.warn('Cache do NCM ilegível; buscando na fonte oficial.', { erro: e.message }); }
  }

  let resp;
  try {
    resp = await fetch(SISCOMEX_NCM_URL, { signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    if (meta) return { itens: await lerCacheNcm(bucket), atualizadoEm: meta.atualizadoEm, total: meta.total, vigencia: meta.vigencia || null, deCache: true, fonteIndisponivel: true };
    throw new HttpsError('unavailable', 'Não foi possível acessar a tabela oficial do Siscomex agora. Tente novamente mais tarde.');
  }
  if (!resp.ok) {
    if (meta) return { itens: await lerCacheNcm(bucket), atualizadoEm: meta.atualizadoEm, total: meta.total, vigencia: meta.vigencia || null, deCache: true, fonteIndisponivel: true };
    throw new HttpsError('unavailable', `O Siscomex respondeu com erro (HTTP ${resp.status}).`);
  }

  const json = await resp.json();
  const brutos = Array.isArray(json.Nomenclaturas) ? json.Nomenclaturas : [];
  // Muitos códigos "folha" (8 dígitos) têm descrição genérica ("Outros"): o texto útil para buscar
  // (ex. "trelas, coleiras, guias, focinheiras...") está na posição/subposição (4 e 6 dígitos) acima na hierarquia.
  const porCodigo = new Map();
  for (const it of brutos) porCodigo.set(digitos(it.Codigo), String(it.Descricao || '').trim());
  const vistos = new Set();
  const itens = [];
  for (const it of brutos) {
    const codigo = digitos(it.Codigo);
    if (codigo.length !== 8 || vistos.has(codigo)) continue; // só os códigos "folha" (completos), sem duplicar
    vistos.add(codigo);
    const partes = [];
    for (const len of [4, 6]) {
      const desc = porCodigo.get(codigo.slice(0, len));
      if (desc && !partes.includes(desc)) partes.push(desc);
    }
    const propria = porCodigo.get(codigo) || '';
    if (propria && !partes.includes(propria)) partes.push(propria);
    itens.push({ codigo, descricao: (partes.join(' · ') || propria).slice(0, 240) });
  }
  if (itens.length < 5000) { // a tabela real tem ~10 mil códigos; um número muito menor indica falha na fonte
    if (meta) return { itens: await lerCacheNcm(bucket), atualizadoEm: meta.atualizadoEm, total: meta.total, vigencia: meta.vigencia || null, deCache: true, fonteIndisponivel: true };
    throw new HttpsError('internal', 'A tabela recebida do Siscomex veio incompleta. Nada foi alterado.');
  }

  await bucket.file(NCM_CACHE_PATH).save(Buffer.from(JSON.stringify(itens)), { resumable: false, contentType: 'application/json' });
  const atualizadoEm = new Date().toISOString();
  const vigencia = json.Data_Ultima_Atualizacao_NCM || null;
  await metaRef.set({ atualizadoEm, atualizadoMs: Date.now(), total: itens.length, vigencia, ato: json.Ato || null, atualizadoPor: ctx.uid });
  return { itens, atualizadoEm, total: itens.length, vigencia, deCache: false };
});

// Token da conta PlugNotas da plataforma: somente o superadmin (dono do Petzy)
exports.configurarTokenTecnoSpeed = onCall({ ...OPCOES, timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
  if (!(await db.doc(`superadmins/${request.auth.uid}`).get()).exists) {
    throw new HttpsError('permission-denied', 'Somente o administrador do Petzy pode configurar o token da plataforma.');
  }
  const token = String(request.data?.token || '').trim();
  if (!/^[A-Za-z0-9._-]{10,200}$/.test(token)) throw new HttpsError('invalid-argument', 'Token com formato inválido.');

  // valida o token na API de produção antes de gravar (401 = token recusado)
  try {
    await chamar({ url: PRODUCAO_URL, chave: token }, 'GET', '/nfse/consultar/00000000-0000-0000-0000-000000000000');
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new HttpsError('invalid-argument', 'A TecnoSpeed recusou este token. Confira se é o token de PRODUÇÃO da conta PlugNotas.');
    if (e.transitorio) throw paraHttps(e);
  }

  const pai = `projects/${projeto()}`;
  const nome = `${pai}/secrets/${SEGREDO}`;
  try {
    try { await sm().getSecret({ name: nome }); }
    catch (e) {
      if (e.code !== 5) throw e; // 5 = NOT_FOUND
      await sm().createSecret({ parent: pai, secretId: SEGREDO, secret: { replication: { automatic: {} } } });
    }
    await sm().addSecretVersion({ parent: nome, payload: { data: Buffer.from(token, 'utf8') } });
  } catch (e) {
    logger.error('Falha ao gravar token no Secret Manager', { erro: e.message, code: e.code });
    if (e.code === 7) throw new HttpsError('failed-precondition', 'A conta de serviço das funções não tem permissão no Secret Manager. Rode no terminal: firebase functions:secrets:set TECNOSPEED_API_KEY');
    throw new HttpsError('internal', 'Não foi possível gravar o token agora.');
  }
  cacheChave = { valor: null, ate: 0 };
  await db.doc('admin/integracaoFiscal').set({ tokenConfiguradoEm: agora(), tokenConfiguradoPor: request.auth.uid }, { merge: true });
  return { ok: true };
});

// ================= Portal do tutor =================
// O tutor nunca acessa o Firestore diretamente: tudo passa por estas funções, que leem/gravam
// com o Admin SDK (sem depender das regras de segurança) e filtram exatamente o que é devolvido.
// O login por telefone + CPF gera um token do Firebase só para autenticar essas chamadas — ele NÃO
// dá nenhum acesso ao Firestore (o tutor não tem doc em /usuarios, então as regras normais nunca o veem).
const normDigitos = (s) => String(s || '').replace(/\D/g, '');

// trava simples contra força bruta: no máximo 30 tentativas de login por clínica a cada hora
async function limitarTentativasPortal(cid) {
  const janela = new Date().toISOString().slice(0, 13); // AAAA-MM-DDTHH
  const ref = db.doc(`clinicas/${cid}/portalTentativas/${janela}`);
  const liberado = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const n = (s.data()?.n || 0) + 1;
    tx.set(ref, { n, atualizadoEm: agora() }, { merge: true });
    return n <= 30;
  });
  if (!liberado) throw new HttpsError('resource-exhausted', 'Muitas tentativas de login. Tente novamente em alguns minutos.');
}

// Tela de login do portal: mostra nome/logo da clínica ANTES de autenticar. Isso não pode ler
// /clinicas/{cid} direto pelo app (as regras exigem ser membro da clínica), então devolvemos aqui,
// pelo Admin SDK, só os dois campos de exibição — nunca dados sensíveis (status, licença, ownerUid...).
exports.portalInfo = onCall(OPCOES, async (request) => {
  const clinicaId = String(request.data?.clinicaId || '');
  if (!clinicaId) throw new HttpsError('invalid-argument', 'Link de acesso inválido.');
  const snap = await db.doc(`clinicas/${clinicaId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Clínica não encontrada.');
  const c = snap.data();
  return { nome: c.nome || 'Petzy', logo: c.logo || null };
});

exports.portalLogin = onCall(OPCOES, async (request) => {
  const clinicaId = String(request.data?.clinicaId || '');
  const telefone = normDigitos(request.data?.telefone);
  const cpf = normDigitos(request.data?.cpf);
  if (!clinicaId) throw new HttpsError('invalid-argument', 'Link de acesso inválido.');
  if (telefone.length < 10 || cpf.length !== 11) throw new HttpsError('invalid-argument', 'Informe um telefone e um CPF válidos.');
  await limitarTentativasPortal(clinicaId);

  const clinicaSnap = await db.doc(`clinicas/${clinicaId}`).get();
  if (!clinicaSnap.exists) throw new HttpsError('not-found', 'Clínica não encontrada.');
  const clinica = clinicaSnap.data();
  if (!(['trial', 'ativo'].includes(clinica.status) && clinica.validoAteMs > Date.now())) {
    throw new HttpsError('failed-precondition', 'O portal desta clínica está temporariamente indisponível.');
  }

  // busca em memória: evita depender de campos normalizados que cadastros antigos não têm.
  // O telefone é comparado pelos últimos 8 dígitos (não pelo número inteiro): isso tolera as
  // variações mais comuns de digitação/cadastro antigo — com ou sem o "55" do Brasil na frente,
  // com ou sem o "9" extra do celular — sem abrir mão do CPF como segundo fator de segurança.
  const bateTelefone = (a, b) => a.length >= 8 && b.length >= 8 && a.slice(-8) === b.slice(-8);
  const clientesSnap = await db.collection(`clinicas/${clinicaId}/clientes`).get();
  const clienteDoc = clientesSnap.docs.find(d => {
    const c = d.data();
    const cpfCadastrado = normDigitos(c.cpf);
    // CPF é opcional no cadastro do tutor (ver clientes.js): cliente antigo sem CPF preenchido
    // não pode ficar impedido de entrar no portal só porque o campo nunca foi coletado.
    return bateTelefone(normDigitos(c.telefone), telefone) && (!cpfCadastrado || cpfCadastrado === cpf);
  });
  // mensagem genérica: não revela se o telefone existe mas o CPF está errado (ou vice-versa)
  if (!clienteDoc) throw new HttpsError('not-found', 'Não encontramos um cadastro com esse telefone e CPF nesta clínica. Confira os dados ou fale com a recepção.');

  const { getAuth } = require('firebase-admin/auth');
  const uid = `portal_${clinicaId}_${clienteDoc.id}`;
  const token = await getAuth().createCustomToken(uid, { portal: true, cid: clinicaId, clienteId: clienteDoc.id });
  return { token, nome: clienteDoc.data().nome || '', clinicaNome: clinica.nome || 'Petzy' };
});

function exigirPortal(request) {
  const t = request.auth?.token;
  if (!t?.portal || !t.cid || !t.clienteId) throw new HttpsError('unauthenticated', 'Sua sessão expirou. Entre novamente.');
  return { cid: t.cid, clienteId: t.clienteId };
}

// Firestore "in" aceita no máximo 30 valores por consulta
async function buscarPorPets(caminho, petIds, campos) {
  if (!petIds.length) return [];
  const grupos = []; for (let i = 0; i < petIds.length; i += 30) grupos.push(petIds.slice(i, i + 30));
  const snaps = await Promise.all(grupos.map(g => db.collection(caminho).where('petId', 'in', g).get()));
  return snaps.flatMap(s => s.docs.map(d => {
    const x = d.data(); const out = { id: d.id };
    for (const c of campos) out[c] = x[c] ?? null;
    return out;
  }));
}

exports.portalDados = onCall(OPCOES, async (request) => {
  const { cid, clienteId } = exigirPortal(request);
  const base = `clinicas/${cid}`;
  const [clienteSnap, clinicaSnap, petsSnap] = await Promise.all([
    db.doc(`${base}/clientes/${clienteId}`).get(),
    db.doc(`clinicas/${cid}`).get(),
    db.collection(`${base}/pets`).where('clienteId', '==', clienteId).get()
  ]);
  if (!clienteSnap.exists) throw new HttpsError('not-found', 'Cadastro não encontrado.');
  const pets = petsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const petIds = pets.map(p => p.id);

  const [vacinas, atendimentos, agendamentos] = await Promise.all([
    buscarPorPets(`${base}/vacinas`, petIds, ['petId', 'nome', 'dataAplicacao', 'proximaDose', 'fabricante', 'lote']),
    // só os campos clínicos relevantes ao tutor: nada de anexos, nada administrativo
    buscarPorPets(`${base}/atendimentos`, petIds, ['petId', 'data', 'tipo', 'diagnostico', 'orientacoes', 'receitaObs', 'vetNome', 'retorno']),
    buscarPorPets(`${base}/agendamentos`, petIds, ['petId', 'inicio', 'tipo', 'status'])
  ]);

  const clinica = clinicaSnap.data() || {};
  return {
    cliente: { nome: clienteSnap.data().nome || '', telefone: clienteSnap.data().telefone || '' },
    clinica: { nome: clinica.nome || 'Petzy', telefone: clinica.telefone || '', endereco: clinica.endereco || '', logo: clinica.logo || null },
    pets: pets.map(p => ({ id: p.id, nome: p.nome, especie: p.especie, raca: p.raca || '', sexo: p.sexo || '', nascimento: p.nascimento || '', peso: p.peso || null, foto: p.foto || null, castrado: !!p.castrado })),
    vacinas, atendimentos,
    agendamentos: agendamentos.filter(a => !['cancelado', 'faltou'].includes(a.status) && a.inicio >= new Date().toISOString().slice(0, 10))
  };
});

exports.portalSolicitarAgendamento = onCall(OPCOES, async (request) => {
  const { cid, clienteId } = exigirPortal(request);
  const petId = String(request.data?.petId || '');
  const motivo = String(request.data?.motivo || '').trim().slice(0, 300);
  const horario = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(request.data?.horario || '') ? request.data.horario : '';
  const preferencia = String(request.data?.preferencia || '').trim().slice(0, 200);
  if (!petId) throw new HttpsError('invalid-argument', 'Escolha o pet.');
  if (motivo.length < 3) throw new HttpsError('invalid-argument', 'Descreva o motivo da consulta.');

  const [petSnap, clinicaSnap] = await Promise.all([db.doc(`clinicas/${cid}/pets/${petId}`).get(), db.doc(`clinicas/${cid}`).get()]);
  if (!petSnap.exists || petSnap.data().clienteId !== clienteId) throw new HttpsError('permission-denied', 'Pet inválido.');
  const clinica = clinicaSnap.data() || {};
  if (!(['trial', 'ativo'].includes(clinica.status) && clinica.validoAteMs > Date.now())) throw new HttpsError('failed-precondition', 'A clínica está temporariamente indisponível.');

  const ref = await db.collection(`clinicas/${cid}/solicitacoesPortal`).add({
    petId, clienteId, petNome: petSnap.data().nome || '', motivo, horario, preferencia, status: 'pendente', criadoEm: agora()
  });
  return { ok: true, id: ref.id };
});

// ================= Agendamento online público =================
// Página pública (agendar.html): qualquer visitante pode pedir um horário SEM já ter cadastro na
// clínica. Cai na mesma fila de pedidos do portal do tutor (solicitacoesPortal), só que sem petId/
// clienteId — a equipe confirma o cadastro do tutor/pet na hora de transformar o pedido em agenda.
const BR_OFFSET_MS_AG = -3 * 3600 * 1000; // Brasil não observa horário de verão desde 2019
function agoraBR() { return new Date(Date.now() + BR_OFFSET_MS_AG); }
function diaISO(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }

// Grade de horários livres dos próximos dias, para o visitante escolher em vez de digitar uma
// preferência solta. Visão simplificada de propósito: não separa por profissional (a página pública
// não pede pra escolher um veterinário) — um horário só é considerado ocupado se JÁ existir qualquer
// agendamento (de qualquer profissional) exatamente naquele minuto.
exports.agendamentoPublicoHorarios = onCall(OPCOES, async (request) => {
  const clinicaId = String(request.data?.clinicaId || '');
  if (!clinicaId) throw new HttpsError('invalid-argument', 'Link de agendamento inválido.');
  const clinicaSnap = await db.doc(`clinicas/${clinicaId}`).get();
  if (!clinicaSnap.exists) throw new HttpsError('not-found', 'Clínica não encontrada.');
  const clinica = clinicaSnap.data();
  if (!(['trial', 'ativo'].includes(clinica.status) && clinica.validoAteMs > Date.now())) {
    throw new HttpsError('failed-precondition', 'Esta clínica não está aceitando pedidos de agendamento no momento.');
  }
  const cfg = clinica.config || {};
  const H0 = cfg.horaInicio ?? 8, H1 = cfg.horaFim ?? 19, intervalo = cfg.intervalo ?? 30;
  const DIAS = 7;
  const agora_ = agoraBR();
  const inicioJanela = diaISO(agora_), fimJanela = diaISO(new Date(agora_.getTime() + DIAS * 86400000));

  const agSnap = await db.collection(`clinicas/${clinicaId}/agendamentos`)
    .where('inicio', '>=', inicioJanela).where('inicio', '<', fimJanela + 'T99')
    .where('status', 'not-in', ['cancelado', 'faltou']).get();
  const ocupados = new Set(agSnap.docs.map(d => d.data().inicio?.slice(0, 16)).filter(Boolean));
  const agoraHHMM = `${String(agora_.getUTCHours()).padStart(2, '0')}:${String(agora_.getUTCMinutes()).padStart(2, '0')}`;

  const dias = [];
  for (let i = 0; i < DIAS; i++) {
    const d = new Date(agora_.getTime() + i * 86400000);
    const chaveDia = diaISO(d);
    const slots = [];
    for (let h = H0; h < H1; h++) {
      for (let m = 0; m < 60; m += intervalo) {
        const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        if (i === 0 && hhmm <= agoraHHMM) continue; // hoje: não oferece horário que já passou
        if (!ocupados.has(`${chaveDia}T${hhmm}`)) slots.push(hhmm);
      }
    }
    if (slots.length) dias.push({ data: chaveDia, slots });
  }
  return { dias };
});

exports.agendamentoPublicoSolicitar = onCall(OPCOES, async (request) => {
  const clinicaId = String(request.data?.clinicaId || '');
  const nome = String(request.data?.nome || '').trim().slice(0, 120);
  const telefone = normDigitos(request.data?.telefone);
  const petNome = String(request.data?.petNome || '').trim().slice(0, 80);
  const tipoServico = String(request.data?.tipoServico || '').trim().slice(0, 60);
  const horario = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(request.data?.horario || '') ? request.data.horario : '';
  const preferencia = String(request.data?.preferencia || '').trim().slice(0, 200);
  const motivo = String(request.data?.motivo || '').trim().slice(0, 300);
  if (!clinicaId) throw new HttpsError('invalid-argument', 'Link de agendamento inválido.');
  if (nome.length < 2) throw new HttpsError('invalid-argument', 'Informe seu nome.');
  if (telefone.length < 10) throw new HttpsError('invalid-argument', 'Informe um telefone válido para contato.');
  await limitarTentativasPortal(clinicaId);

  const clinicaSnap = await db.doc(`clinicas/${clinicaId}`).get();
  if (!clinicaSnap.exists) throw new HttpsError('not-found', 'Clínica não encontrada.');
  const clinica = clinicaSnap.data();
  if (!(['trial', 'ativo'].includes(clinica.status) && clinica.validoAteMs > Date.now())) {
    throw new HttpsError('failed-precondition', 'Esta clínica não está aceitando pedidos de agendamento no momento.');
  }

  const ref = await db.collection(`clinicas/${clinicaId}/solicitacoesPortal`).add({
    origem: 'publico', nomeContato: nome, telefoneContato: telefone, petNome, tipoServico, horario, preferencia, motivo,
    status: 'pendente', criadoEm: agora()
  });
  return { ok: true, id: ref.id, clinicaNome: clinica.nome || 'Petzy' };
});

// ================= Multiunidade (rede) =================
// Só numeros agregados cruzam a fronteira entre clinicas — nunca dados operacionais (clientes,
// pets, prontuarios). O agrupamento em rede (campo redeId) só o superadmin define, nas regras do
// Firestore; aqui só lemos e confirmamos que quem pediu o resumo é admin de uma unidade da rede.
const BR_OFFSET_MS = -3 * 3600 * 1000; // Brasil não observa horário de verão desde 2019
function chaveMesBR(offsetMeses = 0) {
  const agoraBR = new Date(Date.now() + BR_OFFSET_MS);
  const d = new Date(Date.UTC(agoraBR.getUTCFullYear(), agoraBR.getUTCMonth() + offsetMeses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

exports.redeResumo = onCall(OPCOES, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
  const perfil = (await db.doc(`usuarios/${request.auth.uid}`).get()).data();
  if (!perfil?.clinicaId || perfil.papel !== 'admin' || perfil.ativo !== true) throw new HttpsError('permission-denied', 'Apenas o administrador da clínica pode ver o resumo da rede.');

  const minhaClinica = (await db.doc(`clinicas/${perfil.clinicaId}`).get()).data();
  const redeId = minhaClinica?.redeId;
  if (!redeId) throw new HttpsError('failed-precondition', 'Esta clínica ainda não faz parte de uma rede. Fale com o suporte do Petzy.');

  const clinicasSnap = await db.collection('clinicas').where('redeId', '==', redeId).get();
  const unidades = clinicasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!unidades.some(u => u.id === perfil.clinicaId)) throw new HttpsError('permission-denied', 'Sua clínica não pertence a esta rede.');

  const mesAtual = chaveMesBR(0), mesPassado = chaveMesBR(-1);
  async function somaMes(cid, chave) {
    const snap = await db.collection(`clinicas/${cid}/financeiro`)
      .where('vencimento', '>=', `${chave}-01`).where('vencimento', '<', `${chave}-32`).get(); // "-32" nunca existe: cobre o mês inteiro em ordenação de string
    let receita = 0, despesa = 0;
    snap.forEach(doc => {
      const f = doc.data(); if (!f.pago) return;
      if (f.tipo === 'receita') receita += Number(f.valor) || 0; else if (f.tipo === 'despesa') despesa += Number(f.valor) || 0;
    });
    return { receita, despesa };
  }

  const porUnidade = await Promise.all(unidades.map(async (u) => {
    const [atual, passado] = await Promise.all([somaMes(u.id, mesAtual), somaMes(u.id, mesPassado)]);
    return { id: u.id, nome: u.nome || u.id, atual, passado, souEu: u.id === perfil.clinicaId };
  }));
  const total = porUnidade.reduce((acc, u) => ({ receita: acc.receita + u.atual.receita, despesa: acc.despesa + u.atual.despesa }), { receita: 0, despesa: 0 });
  porUnidade.sort((a, b) => b.atual.receita - a.atual.receita);
  return { unidades: porUnidade, total, mesAtual, mesPassado };
});

// ================= Laudo com IA (Groq, nível gratuito) =================
// A IA reescreve os apontamentos do veterinário em linguagem técnica e, a partir deles, RASCUNHA uma
// conclusão e recomendações — mas só com base no que foi informado, nunca inventando achado novo.
// É sempre um rascunho: o veterinário revisa e edita livremente antes de emitir o documento oficial.
exports.redigirLaudoIA = onCall(COM_GROQ, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
  const perfil = (await db.doc(`usuarios/${request.auth.uid}`).get()).data();
  if (!perfil?.clinicaId || perfil.ativo !== true) throw new HttpsError('permission-denied', 'Sem acesso.');
  const clinica = (await db.doc(`clinicas/${perfil.clinicaId}`).get()).data() || {};
  if (!(['trial', 'ativo'].includes(clinica.status) && clinica.validoAteMs > Date.now())) {
    throw new HttpsError('failed-precondition', 'Licença vencida: renove a assinatura para usar a IA.');
  }

  const achados = String(request.data?.achados || '').trim().slice(0, 4000);
  const tipoExame = String(request.data?.tipoExame || '').trim().slice(0, 60);
  const especie = String(request.data?.especie || '').trim().slice(0, 40);
  if (achados.length < 5) throw new HttpsError('invalid-argument', 'Escreva ao menos um apontamento antes de pedir a redação com IA.');

  const prompt = `Você ajuda veterinários a redigir laudos técnicos formais em português do Brasil.
A partir dos apontamentos abaixo — que podem estar em bullet points soltos, abreviados ou informais — produza um laudo completo com três partes:
1. "achados": os apontamentos reescritos como texto corrido, em terceira pessoa, tom técnico e objetivo. REGRA MAIS IMPORTANTE: não adicione nenhum achado, medida ou número que não conste explicitamente no original; se algo for ambíguo, mantenha a ambiguidade em vez de supor.
2. "conclusao": uma impressão diagnóstica curta e direta, coerente SOMENTE com os achados informados (não invente achado novo para justificar a conclusão).
3. "recomendacoes": sugestões objetivas de conduta/acompanhamento coerentes com os achados (ex.: reavaliação em X dias, exame complementar, encaminhamento) — sempre como sugestão a critério do veterinário responsável, nunca como prescrição fechada.
Tipo de exame: ${tipoExame || 'não informado'}
Espécie do paciente: ${especie || 'não informada'}
Apontamentos do veterinário:
"""
${achados}
"""
Responda APENAS com um JSON válido no formato {"achados":"...","conclusao":"...","recomendacoes":"..."}, sem markdown, sem texto fora do JSON.`;

  let resp;
  try {
    resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY.value()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3, max_tokens: 2000, reasoning_effort: 'low',
        response_format: { type: 'json_object' }
      })
    });
  } catch (e) {
    logger.error('Falha de rede ao chamar a Groq', { erro: e.message });
    throw new HttpsError('unavailable', 'Não foi possível falar com o serviço de IA agora. Tente novamente.');
  }
  if (!resp.ok) {
    logger.error('Groq API retornou erro', { status: resp.status, body: (await resp.text()).slice(0, 500) });
    throw new HttpsError('internal', 'Não foi possível gerar o texto agora. Tente novamente em instantes.');
  }
  const json = await resp.json();
  const bruto = (json.choices?.[0]?.message?.content || '').trim();
  let laudo;
  try { laudo = JSON.parse(bruto); } catch {
    logger.error('Groq retornou JSON inválido', { bruto: bruto.slice(0, 500) });
    throw new HttpsError('internal', 'A IA não retornou um laudo válido. Tente novamente.');
  }
  if (!laudo.achados) throw new HttpsError('internal', 'A IA não retornou texto. Tente reformular os apontamentos.');
  return { achados: String(laudo.achados || '').trim(), conclusao: String(laudo.conclusao || '').trim(), recomendacoes: String(laudo.recomendacoes || '').trim() };
});

// ================= Busca de produto por código de barras (EAN) =================
// Duas fontes, nessa ordem: Open Food Facts (mundial, gratuita, sem token — boa pra alimentos/marcas
// grandes) e, se não achar, Cosmos Bluesoft (nacional, gratuita mas com COTA por token — melhor
// cobertura de marca brasileira de petshop). A Cosmos não oferece uma base completa pra baixar (like
// o NCM da Receita Federal) — o plano gratuito é só consulta por código, uma de cada vez. Por isso,
// todo código já ENCONTRADO fica salvo em /eanCache: a próxima clínica que buscar o mesmo código (e a
// mesma clínica, numa próxima vez) não gasta cota de novo — o cache é compartilhado entre todas.
exports.buscarProdutoPorEan = onCall(COM_COSMOS, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
  const codigo = digitos(request.data?.codigo);
  if (codigo.length < 8) throw new HttpsError('invalid-argument', 'Código de barras inválido.');

  const cacheRef = db.doc(`eanCache/${codigo}`);
  const cache = (await cacheRef.get()).data();
  if (cache) return { encontrado: true, nome: cache.nome, fonte: cache.fonte + ' (cache)' };

  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${codigo}.json?fields=product_name,brands,quantity,status`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j.status === 1 && j.product?.product_name) {
      const marca = (j.product.brands || '').split(',')[0].trim();
      const nome = [j.product.product_name, marca, j.product.quantity].filter(Boolean).join(' - ');
      await cacheRef.set({ nome, fonte: 'Open Food Facts', criadoEm: agora() });
      return { encontrado: true, nome, fonte: 'Open Food Facts' };
    }
  } catch (e) { logger.warn('Open Food Facts indisponível', { erro: e.message }); }

  const tokenCosmos = COSMOS_API_KEY.value();
  if (tokenCosmos && tokenCosmos !== 'NAO_CONFIGURADO') {
    try {
      const r = await fetch(`https://api.cosmos.bluesoft.com.br/gtins/${codigo}.json`, {
        headers: { 'X-Cosmos-Token': tokenCosmos, 'User-Agent': 'Petzy/1.0 (petzy@app)' },
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) {
        const j = await r.json();
        if (j.description) {
          const marca = j.brand?.name || '';
          const nome = [j.description, marca].filter(Boolean).join(' - ');
          await cacheRef.set({ nome, fonte: 'Cosmos Bluesoft', criadoEm: agora() });
          return { encontrado: true, nome, fonte: 'Cosmos Bluesoft' };
        }
      }
    } catch (e) { logger.warn('Cosmos Bluesoft indisponível', { erro: e.message }); }
  }

  return { encontrado: false };
});

// ================= Gestão de superadmins =================
// Lista todos os administradores do Petzy — o Firestore só deixa cada um ler o próprio documento em
// /superadmins (de propósito), então listar todos também precisa passar pelo Admin SDK.
exports.listarSuperadmins = onCall(OPCOES, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
  if (!(await db.doc(`superadmins/${request.auth.uid}`).get()).exists) {
    throw new HttpsError('permission-denied', 'Somente um administrador do Petzy pode ver esta lista.');
  }
  const snap = await db.collection('superadmins').get();
  return { lista: snap.docs.map(d => { const x = d.data(); return { uid: d.id, email: x.email || '', nome: x.nome || '', concedidoEm: x.concedidoEm?.toDate?.().toISOString() || null }; }) };
});

// /superadmins/{uid} tem "allow write: if false" no Firestore — de propósito, pra ninguém conseguir
// se promover a dono do SaaS só editando o banco pelo app. A única porta de entrada é esta função,
// que só um superadmin já existente pode chamar (Admin SDK, nunca passa pelas regras do cliente).
exports.gerenciarSuperadmin = onCall(OPCOES, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
  if (!(await db.doc(`superadmins/${request.auth.uid}`).get()).exists) {
    throw new HttpsError('permission-denied', 'Somente um administrador do Petzy pode gerenciar outros administradores.');
  }
  const email = String(request.data?.email || '').trim().toLowerCase();
  const acao = request.data?.acao === 'revogar' ? 'revogar' : 'conceder';
  if (!email) throw new HttpsError('invalid-argument', 'Informe o e-mail da pessoa.');

  const { getAuth } = require('firebase-admin/auth');
  let usuario;
  try { usuario = await getAuth().getUserByEmail(email); }
  catch { throw new HttpsError('not-found', 'Não existe nenhuma conta com este e-mail no Petzy. A pessoa precisa se cadastrar primeiro.'); }

  if (acao === 'revogar') {
    const restantes = await db.collection('superadmins').count().get();
    if (restantes.data().count <= 1) throw new HttpsError('failed-precondition', 'Não é possível remover o único administrador do Petzy restante.');
    await db.doc(`superadmins/${usuario.uid}`).delete();
    return { ok: true, acao, nome: usuario.displayName || usuario.email };
  }

  await db.doc(`superadmins/${usuario.uid}`).set({
    email: usuario.email, nome: usuario.displayName || '', concedidoPor: request.auth.uid, concedidoEm: agora()
  });
  return { ok: true, acao, nome: usuario.displayName || usuario.email };
});

// ================= PIX: BR Code (copia e cola) + QR Code =================
// Padrão EMV/BR Code do Banco Central para PIX estático com valor.

const campo = (id, valor) => id + String(valor.length).padStart(2, '0') + valor;

// bancos só aceitam ASCII sem acento nos campos de nome/cidade/descrição
const ascii = (s, max) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9 .\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

// CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF)
export function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// CPF/CNPJ -> só dígitos, telefone -> +55DDDNUMERO, e-mail -> minúsculo, aleatória -> como está
export function normalizarChave(chave) {
  const k = String(chave || '').trim();
  if (k.includes('@')) return k.toLowerCase();
  if (k.startsWith('+') || k.includes('(')) {
    const d = k.replace(/\D/g, '');
    return '+' + (d.length <= 11 ? '55' + d : d);
  }
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(k) || /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(k)) return k.replace(/\D/g, '');
  return k;
}

export function pixPayload({ chave, nome, cidade, valor, txid, descricao }) {
  let conta = campo('00', 'br.gov.bcb.pix') + campo('01', normalizarChave(chave));
  const livre = 99 - conta.length - 4; // o campo 26 inteiro tem no máximo 99 caracteres
  const desc = ascii(descricao, Math.min(livre, 40));
  if (desc) conta += campo('02', desc);

  let p = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986');
  if (Number(valor) > 0) p += campo('54', Number(valor).toFixed(2));
  p += campo('58', 'BR') + campo('59', ascii(nome, 25) || 'PETZY') + campo('60', ascii(cidade, 15) || 'SAO PAULO');
  p += campo('62', campo('05', String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'));
  p += '6304';
  return p + crc16(p);
}

// identificador da cobrança (aparece no extrato do PIX e ajuda na conciliação)
export const txid = (clinicaId, plano, meses) => ('PZ' + String(clinicaId || '').slice(0, 12) + String(plano || '').slice(0, 3) + (meses || 1))
  .replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 25);

// link da página pública de pagamento
export function linkPagamento({ plano, meses = 1, clinicaId = '', nome = '', valor }) {
  const u = new URL('pagar.html', location.href);
  u.searchParams.set('p', plano);
  u.searchParams.set('m', meses);
  if (clinicaId) u.searchParams.set('c', clinicaId);
  if (nome) u.searchParams.set('n', nome);
  if (valor) u.searchParams.set('v', Number(valor).toFixed(2));
  return u.toString();
}

export async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); }
  catch {
    const t = document.createElement('textarea');
    t.value = texto; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
}

// ---------- QR Code (biblioteca carregada só quando precisa) ----------
let lib = null;
function carregarLib() {
  return lib ??= new Promise((ok, erro) => {
    if (window.qrcode) return ok(window.qrcode);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    s.onload = () => ok(window.qrcode);
    s.onerror = () => { lib = null; erro(new Error('Não foi possível carregar o gerador de QR Code.')); };
    document.head.appendChild(s);
  });
}

export async function qrDataURL(texto) {
  const qrcode = await carregarLib();
  const q = qrcode(0, 'M');
  q.addData(texto);
  q.make();
  return q.createDataURL(8, 16);
}

const escAttr = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Desenha QR Code + copia e cola dentro de `el`. Retorna o código gerado.
export async function renderPix(el, dados) {
  const codigo = pixPayload(dados);
  const copiaCola = `
    <label class="form-label fs-7 mb-1">PIX copia e cola</label>
    <div class="input-group">
      <input class="form-control font-monospace" style="font-size:.72rem" readonly value="${escAttr(codigo)}">
      <button type="button" class="btn btn-primary" data-copiar-pix><i class="bi bi-clipboard me-1"></i>Copiar</button>
    </div>`;
  el.innerHTML = '<div class="text-center py-4"><div class="spinner-border"></div></div>';
  try {
    const img = await qrDataURL(codigo);
    el.innerHTML = `
      <div class="text-center">
        <img src="${img}" alt="QR Code PIX" class="border rounded-3 bg-white p-1 mb-2" style="width:230px;max-width:100%;image-rendering:pixelated">
        <div class="fs-8 text-muted mb-3">Abra o app do seu banco › <strong>PIX</strong> › <strong>Ler QR Code</strong></div>
      </div>${copiaCola}`;
  } catch (e) {
    el.innerHTML = `<div class="alert alert-warning fs-7">${escAttr(e.message)} Use o código abaixo.</div>${copiaCola}`;
  }
  const btn = el.querySelector('[data-copiar-pix]');
  btn.onclick = async () => {
    await copiar(codigo);
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Copiado!';
    setTimeout(() => { btn.innerHTML = '<i class="bi bi-clipboard me-1"></i>Copiar'; }, 2000);
  };
  return codigo;
}

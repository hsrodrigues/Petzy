// ================= Utilitários de interface =================

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const num = (n, d = 0) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toISODateTime = (d = new Date()) => `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const today = () => toISODate();
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const parseISO = (s) => (s ? new Date(s.length === 10 ? s + 'T00:00' : s) : null);

export function fmtDate(s) { const d = parseISO(s); return d ? d.toLocaleDateString('pt-BR') : '—'; }
export function fmtDateTime(s) { const d = parseISO(s); return d ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'; }
export function fmtTime(s) { const d = parseISO(s); return d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''; }

export function idade(nasc) {
  const d = parseISO(nasc); if (!d) return '—';
  const now = new Date();
  let m = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
  if (now.getDate() < d.getDate()) m--;
  if (m < 1) return 'filhote';
  if (m < 12) return `${m} ${m === 1 ? 'mês' : 'meses'}`;
  const a = Math.floor(m / 12);
  return `${a} ${a === 1 ? 'ano' : 'anos'}`;
}

export const initials = (n = '') => n.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- Toast ----------
export function toast(msg, type = 'success') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.className = 'toast-container position-fixed top-0 end-0 p-3';
    document.body.appendChild(box);
  }
  const icons = { success: 'check-circle-fill', danger: 'x-circle-fill', warning: 'exclamation-triangle-fill', info: 'info-circle-fill' };
  const el = document.createElement('div');
  el.className = 'toast align-items-center toast-' + type;
el.setAttribute('role', type === 'danger' ? 'alert' : 'status');
  el.innerHTML = `<div class="d-flex"><div class="toast-body d-flex gap-2 align-items-center">
    <i class="bi bi-${icons[type] || icons.info} text-${type} fs-5"></i><span>${esc(msg)}</span></div>
    <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  box.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 3500 });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  t.show();
}

// ---------- Modal genérico ----------
export function modal({ title, body, size = 'lg', footer = '', onShown }) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="modal fade" tabindex="-1"><div class="modal-dialog modal-${size} modal-dialog-centered modal-dialog-scrollable">
    <div class="modal-content border-0 rounded-4">
      <div class="modal-header border-0 pb-0"><h5 class="modal-title fw-bold">${title}</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer border-0">${footer}</div>` : ''}
    </div></div></div>`;
  const el = wrap.firstElementChild;
  document.body.appendChild(el);
  const m = new bootstrap.Modal(el);
  el.addEventListener('hidden.bs.modal', () => { m.dispose(); el.remove(); });
  if (onShown) el.addEventListener('shown.bs.modal', () => onShown(el, m), { once: true });
  m.show();
  return { el, m, close: () => m.hide() };
}

export function confirmar(msg, { title = 'Confirmar', ok = 'Confirmar', danger = true } = {}) {
  return new Promise(resolve => {
    let done = false;
    const { el, close } = modal({
      title, size: 'sm', body: `<p class="mb-0">${msg}</p>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Cancelar</button>
               <button class="btn btn-${danger ? 'danger' : 'primary'}" data-ok>${ok}</button>`
    });
    $('[data-ok]', el).onclick = () => { done = true; resolve(true); close(); };
    el.addEventListener('hidden.bs.modal', () => !done && resolve(false));
  });
}

// ---------- Formulário a partir de definição de campos ----------
export function fieldHtml(f, v) {
  const col = f.col || 'col-md-6';
  const req = f.required ? 'required' : '';
  const val = v ?? f.default ?? '';
  const lbl = f.label ? `<label class="form-label">${f.label}${f.required ? ' <span class="text-danger">*</span>' : ''}</label>` : '';
  const attrs = `name="${f.name}" ${req} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.attrs || ''}`;
  switch (f.type) {
    case 'section':
      return `<div class="col-12"><h6 class="fw-bold text-primary mt-2 mb-0">${f.label}</h6></div>`;
    case 'custom':
      return `<div class="${col}">${f.html}</div>`;
    case 'textarea':
      return `<div class="${col}">${lbl}<textarea class="form-control" rows="${f.rows || 3}" ${attrs}>${esc(val)}</textarea></div>`;
    case 'select': {
      const opts = (f.options || []).map(o => {
        const [ov, ol] = typeof o === 'object' ? [o.value, o.label] : [o, o];
        return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}${o?.busca ? ` data-busca="${esc(o.busca)}"` : ''}>${esc(ol)}</option>`;
      }).join('');
      return `<div class="${col}">${lbl}<select class="form-select" ${attrs}${f.search ? ' data-busca-select' : ''}>${f.required ? '' : '<option value="">—</option>'}${opts}</select></div>`;
    }
    case 'checkbox':
      return `<div class="${col} d-flex align-items-end"><div class="form-check form-switch mb-2">
        <input class="form-check-input" type="checkbox" ${attrs} ${val ? 'checked' : ''}><label class="form-check-label">${f.label}</label></div></div>`;
    case 'money':
      return `<div class="${col}">${lbl}<div class="input-group"><span class="input-group-text">R$</span>
        <input class="form-control" type="number" step="0.01" min="0" ${attrs} value="${esc(val)}"></div></div>`;
    default:
      return `<div class="${col}">${lbl}<input class="form-control" type="${f.type || 'text'}" ${f.step ? `step="${f.step}"` : ''} ${attrs} value="${esc(val)}"></div>`;
  }
}

export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (!f.name || f.type === 'section' || f.type === 'custom') continue;
    const inp = form.elements[f.name];
    if (!inp) continue;
    if (f.type === 'checkbox') out[f.name] = inp.checked;
    else if (f.type === 'number' || f.type === 'money') out[f.name] = inp.value === '' ? null : Number(inp.value);
    else out[f.name] = inp.value.trim();
  }
  return out;
}

export function formModal({ title, fields, values = {}, size = 'lg', submit = 'Salvar', onSubmit, onShown }) {
  const body = `<form novalidate id="pzForm"><div class="row g-3">${fields.map(f => fieldHtml(f, values[f.name])).join('')}</div></form>`;
  const footer = `<button class="btn btn-light" data-bs-dismiss="modal">Cancelar</button>
    <button class="btn btn-primary px-4" data-submit><span class="spinner-border spinner-border-sm me-2 d-none"></span>${submit}</button>`;
  const ctx = modal({ title, body, size, footer, onShown });
  const form = $('form', ctx.el);
  ativarBusca(ctx.el);
  const btn = $('[data-submit]', ctx.el);
  const go = async (e) => {
    e?.preventDefault();
    if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
    btn.disabled = true; $('.spinner-border', btn).classList.remove('d-none');
    try { await onSubmit(readForm(form, fields), form); ctx.close(); }
    catch (err) { console.error(err); toast(err.message || 'Erro ao salvar', 'danger'); }
    finally { btn.disabled = false; $('.spinner-border', btn).classList.add('d-none'); }
  };
  btn.onclick = go;
  form.onsubmit = go;
  return { ...ctx, form };
}

// ---------- Blocos visuais ----------
export const loading = () => `<div class="loading"><div class="spinner-border"></div></div>`;

export const empty = (icon, text, action = '') =>
  `<div class="empty-state"><i class="bi bi-${icon}"></i><p class="mb-3">${text}</p>${action}</div>`;

export const pageHeader = (title, sub = '', actions = '') =>
  `<div class="page-header"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="d-flex gap-2 flex-wrap">${actions}</div></div>`;

export const kpi = (icon, label, value, color = 'primary') =>
  `<div class="card h-100"><div class="card-body kpi">
    <div class="kpi-icon badge-soft-${color}"><i class="bi bi-${icon}"></i></div>
    <div><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div></div></div>`;

export const badge = (text, color = 'secondary') => `<span class="badge badge-soft-${color}">${esc(text)}</span>`;

export function exportCSV(filename, rows) {
  if (!rows.length) return toast('Nada para exportar', 'warning');
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(';'), ...rows.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Máscaras ----------
export function mask(input, type) {
  const fmt = {
    cpf: v => v.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'),
    cnpj: v => v.replace(/\D/g, '').slice(0, 14).replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2'),
    tel: v => { const d = v.replace(/\D/g, '').slice(0, 11); return d.length > 10 ? d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3') : d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').replace(/[-\s(]+$/, ''); },
    cep: v => v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
  }[type];
  if (input && fmt) input.addEventListener('input', () => { input.value = fmt(input.value); });
}

// Redimensiona a imagem no navegador e devolve um data URL (PNG mantém a transparência)
export function comprimirImagem(file, max = 400, tipo) {
  tipo ||= file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL(tipo, 0.82));
    };
    img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Select com busca (listas grandes: pets, tutores...) ----------
// O <select> original fica escondido: valor, validação e eventos 'change' continuam funcionando.
export function selectBusca(sel) {
  if (sel.dataset.sbOk) return;
  sel.dataset.sbOk = '1';
  const wrap = document.createElement('div');
  wrap.className = 'sb position-relative';
  wrap.innerHTML = `<i class="bi bi-search sb-ico"></i>
    <input type="text" class="form-control sb-input" autocomplete="off" placeholder="${esc(sel.dataset.placeholder || 'Digite para buscar...')}">
    <button type="button" class="btn-close sb-clear" aria-label="Limpar" hidden></button>
    <div class="sb-list" hidden></div>`;
  sel.after(wrap);
  sel.classList.add('sb-native');
  sel.tabIndex = -1;
  const inp = wrap.querySelector('input'), lista = wrap.querySelector('.sb-list'), limpar = wrap.querySelector('.sb-clear');
  const MAX = 80;
  let visiveis = [], ativo = 0;
  const rotulo = () => (sel.value && sel.selectedOptions[0]?.textContent) || '';
  const sincronizar = () => { inp.value = rotulo(); limpar.hidden = !sel.value; };

  function abrir() {
    const termos = norm(inp.value === rotulo() ? '' : inp.value).split(/\s+/).filter(Boolean);
    visiveis = [...sel.options].filter(o => o.value && termos.every(t => norm(o.textContent + ' ' + (o.dataset.busca || '')).includes(t)));
    ativo = Math.max(0, visiveis.findIndex(o => o.value === sel.value));
    lista.innerHTML = visiveis.length
      ? visiveis.slice(0, MAX).map((o, i) => `<div class="sb-item ${i === ativo ? 'ativo' : ''} ${o.value === sel.value ? 'sel' : ''}" data-i="${i}">${esc(o.textContent)}</div>`).join('')
        + (visiveis.length > MAX ? `<div class="sb-info">+${visiveis.length - MAX} resultados, continue digitando…</div>` : '')
      : '<div class="sb-info">Nenhum resultado</div>';
    lista.hidden = false;
    lista.querySelector('.ativo')?.scrollIntoView({ block: 'nearest' });
  }
  function escolher(o) {
    sel.value = o ? o.value : '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sincronizar();
    lista.hidden = true;
  }
  inp.addEventListener('focus', () => { inp.select(); abrir(); });
  inp.addEventListener('input', abrir);
  inp.addEventListener('keydown', (e) => {
    const n = Math.min(visiveis.length, MAX);
    if (e.key === 'Escape') { if (!lista.hidden) { e.stopPropagation(); lista.hidden = true; sincronizar(); } return; }
    if (e.key === 'Enter') { e.preventDefault(); if (!lista.hidden && visiveis[ativo]) escolher(visiveis[ativo]); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (lista.hidden) return abrir();
    if (!n) return;
    ativo = (ativo + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    lista.querySelectorAll('.sb-item').forEach((x, i) => x.classList.toggle('ativo', i === ativo));
    lista.querySelector('.ativo')?.scrollIntoView({ block: 'nearest' });
  });
  lista.addEventListener('mousedown', (e) => {
    const it = e.target.closest('.sb-item');
    if (it) { e.preventDefault(); escolher(visiveis[Number(it.dataset.i)]); }
  });
  inp.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; sincronizar(); }, 150));
  limpar.onclick = () => { escolher(null); inp.focus(); };
  sel.addEventListener('change', sincronizar);
  sincronizar();
}

export function ativarBusca(root) { root.querySelectorAll('select[data-busca-select]').forEach(selectBusca); }

import { state, PLANOS, licenca, db } from '../store.js';
import { collection, doc, getDoc, getDocs, addDoc, query, where } from '../firebase.js';
import { $, esc, pageHeader, money, fmtDate, badge, toast, modal, empty } from '../ui.js';

export async function render(view) {
  const L = licenca();
  const c = state.clinica;
  const admin = state.perfil.papel === 'admin';

  const [cfgSnap, fatSnap, solSnap] = await Promise.all([
    getDoc(doc(db, 'sistema', 'config')).catch(() => null),
    getDocs(collection(db, 'clinicas', state.clinicaId, 'faturas')).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'solicitacoes'), where('clinicaId', '==', state.clinicaId))).catch(() => ({ docs: [] }))
  ]);
  const cfg = cfgSnap?.exists() ? cfgSnap.data() : {};
  const faturas = fatSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const pendente = solSnap.docs.map(d => d.data()).find(s => s.status === 'pendente');

  const statusBadge = L.ativa ? badge(L.plano === 'trial' ? 'Em teste' : 'Ativa', 'success') : badge(L.status === 'bloqueado' ? 'Bloqueada' : 'Vencida', 'danger');

  view.innerHTML = `
    ${pageHeader('Assinatura', 'Plano, licença e pagamentos do Petzy')}
    <div class="card mb-4"><div class="card-body d-flex flex-wrap gap-4 align-items-center">
      <div class="kpi-icon badge-soft-primary" style="width:64px;height:64px;font-size:1.8rem"><i class="bi bi-gem"></i></div>
      <div class="flex-fill">
        <div class="text-muted fs-7">Plano atual</div>
        <h3 class="fw-bold mb-1">${esc(PLANOS[L.plano]?.nome || L.plano)} ${statusBadge}</h3>
        <div class="text-muted">${L.validoAte ? (L.ativa ? `Válida até <strong>${L.validoAte.toLocaleDateString('pt-BR')}</strong> · ${L.dias} dia(s) restantes` : `Venceu em ${L.validoAte.toLocaleDateString('pt-BR')}`) : ''}</div>
      </div>
      ${pendente ? `<div class="alert alert-info mb-0 fs-7"><i class="bi bi-hourglass-split me-1"></i>Pagamento do plano <strong>${esc(PLANOS[pendente.plano]?.nome)}</strong> em análise. A liberação é feita em até 1 dia útil.</div>` : ''}
    </div></div>

    <h5 class="fw-bold mb-3">Escolha seu plano</h5>
    <div class="row g-3 mb-4">
      ${['basico', 'pro', 'premium'].map(k => { const p = PLANOS[k]; const atual = L.plano === k && L.ativa; return `
      <div class="col-md-4"><div class="price-card ${p.destaque ? 'featured' : ''}">
        ${p.destaque ? '<span class="badge bg-primary position-absolute top-0 start-50 translate-middle">Mais escolhido</span>' : ''}
        <h5 class="fw-bold">${p.nome}</h5>
        <div class="price">${money(p.preco)}<span class="fs-6 text-muted fw-normal">/mês</span></div>
        <ul>${p.recursos.map(r => `<li><i class="bi bi-check-circle-fill"></i>${r}</li>`).join('')}</ul>
        <button class="btn ${p.destaque ? 'btn-primary' : 'btn-outline-primary'} w-100" data-plano="${k}" ${!admin || atual ? 'disabled' : ''}>
          ${atual ? 'Plano atual' : L.plano === k ? 'Renovar' : 'Assinar'}</button>
      </div></div>`; }).join('')}
    </div>
    ${admin ? '' : '<p class="text-muted fs-7">Apenas o administrador da clínica pode alterar a assinatura.</p>'}

    <div class="card"><div class="card-header">Histórico de pagamentos</div>
      <div class="table-responsive"><table class="table"><thead><tr><th>Data</th><th>Plano</th><th>Período</th><th>Forma</th><th class="text-end">Valor</th></tr></thead><tbody>
      ${faturas.length ? faturas.map(f => `<tr><td class="fs-7">${fmtDate(f.data)}</td><td>${esc(PLANOS[f.plano]?.nome || f.plano)}</td><td class="fs-7">${f.meses} mês(es) · até ${fmtDate(f.validoAte)}</td><td class="fs-7">${esc(f.forma || '')}</td><td class="text-end fw-semibold">${money(f.valor)}</td></tr>`).join('')
        : `<tr><td colspan="5">${empty('receipt', 'Nenhum pagamento registrado ainda.')}</td></tr>`}
      </tbody></table></div></div>`;

  view.querySelectorAll('[data-plano]').forEach(b => b.onclick = () => pagar(b.dataset.plano, cfg, c));
}

function pagar(plano, cfg, c) {
  const p = PLANOS[plano];
  const link = cfg.links?.[plano];
  const { el, close } = modal({
    title: `Assinar plano ${p.nome}`, size: 'md',
    body: `
      <div class="text-center mb-3"><div class="text-muted fs-7">Valor mensal</div><div class="pdv-total text-primary">${money(p.preco)}</div></div>
      ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener" class="btn btn-primary btn-lg w-100 mb-3"><i class="bi bi-credit-card me-1"></i>Pagar com cartão, PIX ou boleto</a>` : ''}
      ${cfg.pixChave ? `
        <div class="bg-light rounded-3 p-3 mb-3">
          <div class="fw-semibold mb-1"><i class="bi bi-qr-code me-1"></i>PIX</div>
          <div class="fs-7 text-muted mb-2">Favorecido: ${esc(cfg.pixNome || 'Petzy')}</div>
          <div class="input-group"><input class="form-control" readonly value="${esc(cfg.pixChave)}" id="pixKey"><button class="btn btn-outline-primary" id="copiar"><i class="bi bi-clipboard"></i> Copiar</button></div>
        </div>` : ''}
      ${!link && !cfg.pixChave ? '<div class="alert alert-warning fs-7">O administrador do Petzy ainda não configurou as formas de pagamento. Fale com o suporte.</div>' : ''}
      <p class="fs-7 text-muted mb-0">Depois de pagar, clique em <strong>"Já paguei"</strong>. Sua licença é liberada assim que o pagamento for confirmado.
      ${cfg.whatsapp ? `Dúvidas? <a target="_blank" href="https://wa.me/${cfg.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Sou da ${c.nome} e quero assinar o plano ${p.nome} do Petzy.`)}">Chame no WhatsApp</a>.` : ''}</p>`,
    footer: `<button class="btn btn-light" data-bs-dismiss="modal">Fechar</button><button class="btn btn-success" id="jaPaguei"><i class="bi bi-check2 me-1"></i>Já paguei</button>`
  });
  $('#copiar', el)?.addEventListener('click', () => { navigator.clipboard.writeText(cfg.pixChave); toast('Chave PIX copiada'); });
  $('#jaPaguei', el).onclick = async () => {
    try {
      await addDoc(collection(db, 'solicitacoes'), {
        clinicaId: state.clinicaId, clinicaNome: c.nome, plano, valor: p.preco, status: 'pendente',
        solicitanteUid: state.user.uid, solicitanteEmail: state.user.email, criadoEm: new Date().toISOString()
      });
      toast('Recebemos seu aviso de pagamento! Liberação em breve.');
      close(); location.reload();
    } catch (e) { toast(e.message, 'danger'); }
  };
}

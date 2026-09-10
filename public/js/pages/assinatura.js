import { state, PLANOS, licenca, db } from '../store.js';
import { collection, doc, getDoc, getDocs, addDoc, query, where } from '../firebase.js';
import { $, esc, pageHeader, money, fmtDate, badge, toast, modal, empty } from '../ui.js';
import { renderPix, txid, linkPagamento, copiar } from '../pix.js';

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
        <button class="btn ${p.destaque ? 'btn-primary' : 'btn-outline-primary'} w-100" data-plano="${k}" ${admin ? '' : 'disabled'}>
          ${atual ? 'Renovar / adiantar' : L.plano === k ? 'Renovar' : 'Assinar'}</button>
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
  const whats = (cfg.whatsapp || '').replace(/\D/g, '');
  let meses = 1;

  const { el, close } = modal({
    title: `Assinar plano ${p.nome}`, size: 'md',
    body: `
      <div class="fs-8 text-muted text-uppercase fw-semibold mb-2">Período</div>
      <div class="d-flex gap-2 mb-3" id="meses">
        ${[1, 3, 6, 12].map(m => `<button type="button" class="btn btn-sm flex-fill ${m === 1 ? 'btn-primary' : 'btn-light border'}" data-m="${m}">${m} ${m === 1 ? 'mês' : 'meses'}</button>`).join('')}
      </div>
      <div class="text-center mb-3"><div class="text-muted fs-7">Total a pagar</div><div class="pdv-total text-primary" id="valor"></div></div>
      ${cfg.pixChave ? '<div id="pixBox" class="mb-3"></div>' : ''}
      ${link ? `${cfg.pixChave ? '<div class="d-flex align-items-center gap-3 my-3 text-muted fs-8"><hr class="flex-fill">ou<hr class="flex-fill"></div>' : ''}
        <a href="${esc(link)}" target="_blank" rel="noopener" class="btn btn-outline-primary w-100 mb-3"><i class="bi bi-credit-card me-1"></i>Pagar com cartão ou boleto <span class="fs-8">(mensal)</span></a>` : ''}
      ${!link && !cfg.pixChave ? '<div class="alert alert-warning fs-7">O administrador do Petzy ainda não configurou as formas de pagamento. Fale com o suporte.</div>' : ''}
      <div class="bg-light rounded-3 p-2 px-3 mb-3 fs-8 d-flex align-items-center gap-2">
        <i class="bi bi-link-45deg fs-5 text-primary"></i>
        <span class="flex-fill">Outra pessoa faz os pagamentos? Envie o link desta cobrança.</span>
        <button type="button" class="btn btn-sm btn-light border text-nowrap" id="copiarLink"><i class="bi bi-clipboard me-1"></i>Copiar link</button>
      </div>
      <p class="fs-7 text-muted mb-0">Depois de pagar, clique em <strong>"Já paguei"</strong>. A licença é liberada assim que o pagamento for confirmado.
      ${whats ? `Dúvidas? <a target="_blank" href="https://wa.me/${whats}?text=${encodeURIComponent(`Olá! Sou da ${c.nome} e quero assinar o plano ${p.nome} do Petzy.`)}">Chame no WhatsApp</a>.` : ''}</p>`,
    footer: `<button class="btn btn-light" data-bs-dismiss="modal">Fechar</button><button class="btn btn-success" id="jaPaguei"><i class="bi bi-check2 me-1"></i>Já paguei</button>`
  });

  const valor = () => p.preco * meses;

  function atualizar() {
    $('#valor', el).textContent = money(valor());
    if (cfg.pixChave) renderPix($('#pixBox', el), {
      chave: cfg.pixChave, nome: cfg.pixNome, cidade: cfg.pixCidade, valor: valor(),
      txid: txid(state.clinicaId, plano, meses), descricao: `Petzy ${p.nome} ${meses}m`
    });
  }

  $('#meses', el).onclick = (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    meses = Number(b.dataset.m);
    el.querySelectorAll('#meses button').forEach(x => { x.className = `btn btn-sm flex-fill ${x === b ? 'btn-primary' : 'btn-light border'}`; });
    atualizar();
  };

  $('#copiarLink', el).onclick = async () => {
    await copiar(linkPagamento({ plano, meses, clinicaId: state.clinicaId, nome: c.nome }));
    toast('Link de pagamento copiado');
  };

  $('#jaPaguei', el).onclick = async () => {
    try {
      await addDoc(collection(db, 'solicitacoes'), {
        clinicaId: state.clinicaId, clinicaNome: c.nome, plano, meses, valor: valor(), status: 'pendente',
        solicitanteUid: state.user.uid, solicitanteEmail: state.user.email, criadoEm: new Date().toISOString()
      });
      toast('Recebemos seu aviso de pagamento! Liberação em breve.');
      close(); location.reload();
    } catch (e) { toast(e.message, 'danger'); }
  };

  atualizar();
}

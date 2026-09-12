import { chamarFuncao, mensagemErroFuncao } from '../firebase.js';
import { $, esc, pageHeader, money, kpi, empty, toast, loading } from '../ui.js';

export async function render(view) {
  view.innerHTML = pageHeader('Rede', 'Resumo consolidado das unidades da sua rede') + loading();
  let r;
  try {
    r = await chamarFuncao('redeResumo', {});
  } catch (e) {
    view.innerHTML = pageHeader('Rede', 'Resumo consolidado das unidades da sua rede') +
      `<div class="card">${empty('diagram-3', mensagemErroFuncao(e))}</div>`;
    return;
  }

  const pct = (atual, anterior) => {
    if (!anterior) return atual ? '<span class="badge-soft-success badge">novo no mês</span>' : '';
    const p = Math.round(((atual - anterior) / anterior) * 100);
    return `<span class="badge ${p >= 0 ? 'badge-soft-success' : 'badge-soft-danger'}">${p >= 0 ? '+' : ''}${p}% vs mês passado</span>`;
  };

  view.innerHTML = `
    ${pageHeader('Rede', `Resumo consolidado de ${r.unidades.length} unidades · ${r.mesAtual.split('-').reverse().join('/')}`)}
    <div class="row g-3 mb-4">
      <div class="col-6 col-lg-4">${kpi('shop', 'Unidades na rede', r.unidades.length, 'primary')}</div>
      <div class="col-6 col-lg-4">${kpi('graph-up-arrow', 'Receita consolidada do mês', money(r.total.receita), 'success')}</div>
      <div class="col-6 col-lg-4">${kpi('piggy-bank', 'Lucro consolidado do mês', money(r.total.receita - r.total.despesa), r.total.receita - r.total.despesa >= 0 ? 'primary' : 'danger')}</div>
    </div>
    <div class="card">
      <div class="card-header">Desempenho por unidade</div>
      <div class="table-responsive"><table class="table table-hover">
        <thead><tr><th>Unidade</th><th class="text-end">Receita do mês</th><th class="text-end">Despesas do mês</th><th class="text-end">Lucro</th><th>Tendência</th></tr></thead>
        <tbody>${r.unidades.map(u => `<tr class="${u.souEu ? 'table-primary bg-opacity-10' : ''}">
          <td class="fw-semibold">${esc(u.nome)}${u.souEu ? ' <span class="text-muted fw-normal fs-8">(esta unidade)</span>' : ''}</td>
          <td class="text-end">${money(u.atual.receita)}</td>
          <td class="text-end text-danger">${money(u.atual.despesa)}</td>
          <td class="text-end fw-semibold ${u.atual.receita - u.atual.despesa >= 0 ? 'text-success' : 'text-danger'}">${money(u.atual.receita - u.atual.despesa)}</td>
          <td>${pct(u.atual.receita, u.passado.receita)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <p class="text-muted fs-8 mt-3"><i class="bi bi-shield-lock me-1"></i>Só os números agregados são compartilhados entre unidades — tutores, pets e prontuários continuam isolados por clínica.</p>`;
}

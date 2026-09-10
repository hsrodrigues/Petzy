import { state, list, loadTutoresPets, where } from '../store.js';
import { esc, money, kpi, pageHeader, fmtTime, fmtDate, today, toISODate, addDays, badge, empty } from '../ui.js';

const TIPO_COR = { consulta: 'primary', banho: 'info', tosa: 'info', vacina: 'success', cirurgia: 'danger', retorno: 'warning', exame: 'warning' };
const STATUS_COR = { agendado: 'secondary', confirmado: 'primary', em_atendimento: 'warning', concluido: 'success', cancelado: 'danger', faltou: 'danger' };

export async function render(view) {
  const hoje = today();
  const inicioMes = hoje.slice(0, 8) + '01';
  const seisMeses = toISODate(new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1));
  const em30 = toISODate(addDays(new Date(), 30));

  const [{ clientes, pets, C, P }, agHoje, fin, produtos, vacinas] = await Promise.all([
    loadTutoresPets(),
    list('agendamentos', where('inicio', '>=', hoje), where('inicio', '<', hoje + 'T99')),
    list('financeiro', where('vencimento', '>=', seisMeses)),
    list('produtos'),
    list('vacinas', where('proximaDose', '>=', hoje), where('proximaDose', '<=', em30))
  ]);

  agHoje.sort((a, b) => a.inicio.localeCompare(b.inicio));
  const doMes = fin.filter(f => f.vencimento >= inicioMes);
  const receitaMes = doMes.filter(f => f.tipo === 'receita' && f.pago).reduce((s, f) => s + (f.valor || 0), 0);
  const despesaMes = doMes.filter(f => f.tipo === 'despesa' && f.pago).reduce((s, f) => s + (f.valor || 0), 0);
  const estoqueBaixo = produtos.filter(p => p.tipo !== 'servico' && (p.estoque ?? 0) <= (p.estoqueMinimo ?? 0));
  const mesHoje = hoje.slice(5);
  const aniversariantes = pets.filter(p => p.nascimento?.slice(5) === mesHoje);

  const hora = new Date().getHours();
  const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  view.innerHTML = `
    ${pageHeader(`${saud}, ${esc((state.perfil.nome || '').split(' ')[0])}! 👋`, `Resumo de hoje, ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`,
      `<a href="#/pdv" class="btn btn-light border"><i class="bi bi-cart3 me-1"></i>Nova venda</a>
       <a href="#/agenda" class="btn btn-primary"><i class="bi bi-plus-lg me-1"></i>Agendar</a>`)}

    <div class="row g-3 mb-4">
      <div class="col-6 col-xl-3">${kpi('calendar-check', 'Agendamentos hoje', agHoje.filter(a => !['cancelado', 'faltou'].includes(a.status)).length)}</div>
      <div class="col-6 col-xl-3">${kpi('graph-up-arrow', 'Receita do mês', money(receitaMes), 'success')}</div>
      <div class="col-6 col-xl-3">${kpi('people', 'Tutores cadastrados', clientes.length, 'info')}</div>
      <div class="col-6 col-xl-3">${kpi('heart', 'Pets cadastrados', pets.length, 'warning')}</div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-lg-8">
        <div class="card h-100">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span>Receitas x Despesas <span class="text-muted fw-normal fs-7">· últimos 6 meses</span></span>
            <span class="fs-7 text-muted">Saldo do mês: <strong class="${receitaMes - despesaMes >= 0 ? 'text-success' : 'text-danger'}">${money(receitaMes - despesaMes)}</strong></span>
          </div>
          <div class="card-body"><canvas id="chFin" height="120"></canvas></div>
        </div>
      </div>
      <div class="col-lg-4">
        <div class="card h-100">
          <div class="card-header">Atendimentos por tipo <span class="text-muted fw-normal fs-7">· hoje</span></div>
          <div class="card-body d-flex align-items-center justify-content-center">
            ${agHoje.length ? '<canvas id="chTipo"></canvas>' : empty('pie-chart', 'Sem atendimentos hoje')}
          </div>
        </div>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-lg-7">
        <div class="card h-100">
          <div class="card-header d-flex justify-content-between"><span>Agenda de hoje</span><a href="#/agenda" class="fs-7">Ver agenda completa →</a></div>
          <div class="list-group list-group-flush">
            ${agHoje.length ? agHoje.map(a => `
              <a href="#/agenda" class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3">
                <div class="text-center" style="min-width:52px"><div class="fw-bold">${fmtTime(a.inicio)}</div></div>
                <div class="flex-fill">
                  <div class="fw-semibold">${esc(P[a.petId]?.nome || 'Pet removido')} <span class="text-muted fw-normal fs-7">· ${esc(C[a.clienteId]?.nome || '')}</span></div>
                  <div class="fs-7">${badge(a.tipo, TIPO_COR[a.tipo])} ${a.obs ? `<span class="text-muted ms-1">${esc(a.obs)}</span>` : ''}</div>
                </div>
                ${badge((a.status || 'agendado').replace('_', ' '), STATUS_COR[a.status] || 'secondary')}
              </a>`).join('') : empty('calendar2', 'Nenhum agendamento para hoje', '<a href="#/agenda" class="btn btn-soft btn-sm">Abrir agenda</a>')}
          </div>
        </div>
      </div>
      <div class="col-lg-5 d-flex flex-column gap-3">
        <div class="card">
          <div class="card-header d-flex justify-content-between"><span><i class="bi bi-shield-plus text-success me-1"></i>Vacinas nos próximos 30 dias</span><a href="#/vacinas" class="fs-7">Ver todas</a></div>
          <div class="list-group list-group-flush">
            ${vacinas.length ? vacinas.sort((a, b) => a.proximaDose.localeCompare(b.proximaDose)).slice(0, 5).map(v => `
              <div class="list-group-item d-flex justify-content-between align-items-center">
                <div><div class="fw-semibold fs-7">${esc(P[v.petId]?.nome || '—')} · ${esc(v.nome)}</div>
                <div class="text-muted fs-8">${esc(C[P[v.petId]?.clienteId]?.telefone || '')}</div></div>
                ${badge(fmtDate(v.proximaDose), v.proximaDose <= toISODate(addDays(new Date(), 7)) ? 'warning' : 'info')}
              </div>`).join('') : '<div class="p-3 text-muted fs-7">Nenhuma dose prevista.</div>'}
          </div>
        </div>
        <div class="card">
          <div class="card-header d-flex justify-content-between"><span><i class="bi bi-exclamation-triangle text-warning me-1"></i>Estoque baixo</span><a href="#/produtos" class="fs-7">Produtos</a></div>
          <div class="list-group list-group-flush">
            ${estoqueBaixo.length ? estoqueBaixo.slice(0, 5).map(p => `
              <div class="list-group-item d-flex justify-content-between"><span class="fs-7">${esc(p.nome)}</span>${badge(`${p.estoque ?? 0} ${p.unidade || 'un'}`, 'danger')}</div>`).join('')
              : '<div class="p-3 text-muted fs-7">Tudo em ordem 👍</div>'}
          </div>
        </div>
        ${aniversariantes.length ? `<div class="card bg-primary-soft border-0"><div class="card-body">
          <div class="fw-semibold mb-1">🎂 Aniversariantes de hoje</div>
          <div class="fs-7">${aniversariantes.map(p => `${esc(p.nome)} <span class="text-muted">(${esc(C[p.clienteId]?.nome || '')})</span>`).join(', ')}</div>
        </div></div>` : ''}
      </div>
    </div>`;

  // ---------- Gráficos ----------
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
    meses.push({ k: toISODate(d).slice(0, 7), l: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') });
  }
  const soma = (tipo, k) => fin.filter(f => f.tipo === tipo && f.pago && f.vencimento?.startsWith(k)).reduce((s, f) => s + (f.valor || 0), 0);

  new Chart(document.getElementById('chFin'), {
    type: 'bar',
    data: {
      labels: meses.map(m => m.l),
      datasets: [
        { label: 'Receitas', data: meses.map(m => soma('receita', m.k)), backgroundColor: '#6c5ce7', borderRadius: 8, maxBarThickness: 34 },
        { label: 'Despesas', data: meses.map(m => soma('despesa', m.k)), backgroundColor: '#ffb4a2', borderRadius: 8, maxBarThickness: 34 }
      ]
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.raw)}` } } },
      scales: { y: { beginAtZero: true, grid: { color: '#f0f0f6' }, ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR') } }, x: { grid: { display: false } } }
    }
  });

  if (agHoje.length) {
    const cont = {};
    agHoje.forEach(a => { cont[a.tipo] = (cont[a.tipo] || 0) + 1; });
    new Chart(document.getElementById('chTipo'), {
      type: 'doughnut',
      data: { labels: Object.keys(cont), datasets: [{ data: Object.values(cont), backgroundColor: ['#6c5ce7', '#0ea5e9', '#00b894', '#f59e0b', '#ef4444', '#a855f7', '#94a3b8'], borderWidth: 0 }] },
      options: { cutout: '68%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } } }
    });
  }
}

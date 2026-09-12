import { state, list, loadTutoresPets, where, limit } from '../store.js';
import { db, doc, updateDoc } from '../firebase.js';
import { $, esc, money, kpiTrend, pageHeader, fmtTime, fmtDate, today, toISODate, addDays, badge, empty, toast } from '../ui.js';
import { emoji } from './pets.js';

const TIPO_COR = { consulta: 'primary', banho: 'info', tosa: 'info', vacina: 'success', cirurgia: 'danger', retorno: 'warning', exame: 'warning' };
const STATUS_COR = { agendado: 'secondary', confirmado: 'primary', em_atendimento: 'warning', concluido: 'success', cancelado: 'danger', faltou: 'danger' };

// Comparação com o período anterior: `subiu` decide a seta, `bom` decide a cor.
// invertido=true para métricas em que crescer é ruim (despesas).
function tendencia(atual, anterior, invertido = false) {
  if (!anterior) {
    if (!atual) return null;
    return { text: 'novo no mês', subiu: true, bom: !invertido };
  }
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  const subiu = pct >= 0;
  return { text: `${subiu ? '+' : ''}${pct}% vs mês passado`, subiu, bom: invertido ? !subiu : subiu };
}

export async function render(view) {
  const hoje = today();
  // Mês em formato "YYYY-MM": nunca passar essa string por `new Date(...)` para achar o mês seguinte —
  // o JS interpreta "YYYY-MM-DD" como UTC, e no fuso do Brasil (UTC-3) isso "volta" um dia (ou um mês
  // inteiro, perto da virada), zerando o intervalo. `chaveMes` monta a data a partir de um Date local.
  const chaveMes = (offset) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return toISODate(d).slice(0, 7); };
  const mesAtualChave = chaveMes(0), mesPassadoChave = chaveMes(-1);
  const seisMeses = toISODate(new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1));
  const em30 = toISODate(addDays(new Date(), 30));

  const [{ clientes, pets, C, P }, agHoje, fin, produtos, vacinas, vendaExiste, agConcluidoExiste] = await Promise.all([
    loadTutoresPets(),
    list('agendamentos', where('inicio', '>=', hoje), where('inicio', '<', hoje + 'T99')),
    list('financeiro', where('vencimento', '>=', seisMeses)),
    list('produtos'),
    list('vacinas', where('proximaDose', '>=', hoje), where('proximaDose', '<=', em30)),
    list('vendas', limit(1)),
    list('agendamentos', where('status', '==', 'concluido'), limit(1))
  ]);

  agHoje.sort((a, b) => a.inicio.localeCompare(b.inicio));
  const ativosHoje = agHoje.filter(a => !['cancelado', 'faltou'].includes(a.status));
  const concluidosHoje = agHoje.filter(a => a.status === 'concluido').length;

  const somaMes = (chave, tipo) => fin.filter(f => f.tipo === tipo && f.pago && f.vencimento?.startsWith(chave)).reduce((s, f) => s + (f.valor || 0), 0);
  const receitaMes = somaMes(mesAtualChave, 'receita'), despesaMes = somaMes(mesAtualChave, 'despesa');
  const receitaPassada = somaMes(mesPassadoChave, 'receita'), despesaPassada = somaMes(mesPassadoChave, 'despesa');
  const lucroMes = receitaMes - despesaMes, lucroPassado = receitaPassada - despesaPassada;

  const estoqueBaixo = produtos.filter(p => p.tipo !== 'servico' && (p.estoque ?? 0) <= (p.estoqueMinimo ?? 0));
  const vencendo = produtos.filter(p => p.tipo !== 'servico' && p.validade && p.validade <= em30).sort((a, b) => a.validade.localeCompare(b.validade));
  const mesHoje = hoje.slice(5);
  const aniversariantes = pets.filter(p => p.nascimento?.slice(5) === mesHoje);

  const hora = new Date().getHours();
  const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  // ---------- checklist de primeiros passos ----------
  // Some sozinha quando os 5 passos são cumpridos, ou se o admin dispensar. A dispensa fica gravada
  // na própria clínica (não no navegador) pra não reaparecer noutro dispositivo/usuário.
  const PASSOS = [
    { id: 'tutor', label: 'Cadastre seu primeiro tutor', feito: clientes.length > 0, href: '#/clientes?novo=1' },
    { id: 'pet', label: 'Cadastre o pet do tutor', feito: pets.length > 0, href: '#/pets?novo=1' },
    { id: 'produto', label: 'Cadastre um produto ou serviço', feito: produtos.length > 0, href: '#/produtos' },
    { id: 'venda', label: 'Faça sua primeira venda ou atendimento', feito: vendaExiste.length > 0 || agConcluidoExiste.length > 0, href: '#/pdv' },
    { id: 'dados', label: 'Complete os dados da clínica (logo, CNPJ)', feito: Boolean(state.clinica?.logo || state.clinica?.cnpj), href: '#/configuracoes' }
  ];
  const concluidos = PASSOS.filter(p => p.feito).length;
  const mostrarChecklist = state.perfil.papel === 'admin' && !state.clinica?.onboardingDispensado && concluidos < PASSOS.length;

  view.innerHTML = `
    ${pageHeader(`${saud}, ${esc((state.perfil.nome || '').split(' ')[0])}! 👋`, `Resumo de hoje, ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`)}

    ${mostrarChecklist ? `
    <div class="card mb-4 border-primary" id="cardChecklist">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div><h5 class="fw-bold mb-1"><i class="bi bi-rocket-takeoff text-primary me-1"></i>Primeiros passos no Petzy</h5>
          <p class="text-muted fs-7 mb-0">${concluidos} de ${PASSOS.length} concluídos — leva menos de 5 minutos.</p></div>
          <button class="btn btn-sm btn-light border" id="btnDispensarChecklist" title="Dispensar"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="progress mb-3" style="height:6px"><div class="progress-bar bg-primary" style="width:${(concluidos / PASSOS.length) * 100}%"></div></div>
        <div class="d-flex flex-wrap gap-2">
          ${PASSOS.map(p => `<a href="${p.href}" class="btn btn-sm ${p.feito ? 'btn-light border text-success disabled' : 'btn-light border'}"><i class="bi bi-${p.feito ? 'check-circle-fill' : 'circle'} me-1"></i>${esc(p.label)}</a>`).join('')}
        </div>
      </div>
    </div>` : ''}

    <div class="qa-row mb-4">
      <a href="#/agenda" class="qa-tile"><span class="qa-ico badge-soft-primary"><i class="bi bi-calendar-plus"></i></span>Agendar</a>
      <a href="#/pdv" class="qa-tile"><span class="qa-ico badge-soft-success"><i class="bi bi-cart3"></i></span>Nova venda</a>
      <a href="#/clientes?novo=1" class="qa-tile"><span class="qa-ico badge-soft-info"><i class="bi bi-person-plus"></i></span>Novo tutor</a>
      <a href="#/pets?novo=1" class="qa-tile"><span class="qa-ico badge-soft-warning"><i class="bi bi-heart"></i></span>Novo pet</a>
      <a href="#/prontuarios" class="qa-tile"><span class="qa-ico badge-soft-danger"><i class="bi bi-clipboard2-plus"></i></span>Atendimento</a>
    </div>

    <div class="row g-3 mb-3">
      <div class="col-6 col-xl-3">${kpiTrend({ icon: 'calendar-check', label: 'Agendamentos hoje', value: ativosHoje.length, sub: `${concluidosHoje} concluído${concluidosHoje === 1 ? '' : 's'}` })}</div>
      <div class="col-6 col-xl-3">${kpiTrend({ icon: 'graph-up-arrow', label: 'Receita do mês', value: money(receitaMes), color: 'success', trend: tendencia(receitaMes, receitaPassada) })}</div>
      <div class="col-6 col-xl-3">${kpiTrend({ icon: 'graph-down-arrow', label: 'Despesas do mês', value: money(despesaMes), color: 'danger', trend: tendencia(despesaMes, despesaPassada, true) })}</div>
      <div class="col-6 col-xl-3">${kpiTrend({ icon: 'wallet2', label: 'Lucro do mês', value: `<span class="${lucroMes >= 0 ? '' : 'text-danger'}">${money(lucroMes)}</span>`, color: lucroMes >= 0 ? 'primary' : 'danger', trend: tendencia(lucroMes, lucroPassado) })}</div>
    </div>

    <div class="d-flex flex-wrap gap-3 mb-4 dash-resumo">
      <a href="#/clientes"><i class="bi bi-people text-info"></i> <strong>${clientes.length}</strong> tutores</a>
      <a href="#/pets"><i class="bi bi-heart text-warning"></i> <strong>${pets.length}</strong> pets</a>
      <a href="#/vacinas"><i class="bi bi-shield-plus text-success"></i> <strong>${vacinas.length}</strong> vacina${vacinas.length === 1 ? '' : 's'} a vencer</a>
      <a href="#/produtos"><i class="bi bi-exclamation-triangle ${estoqueBaixo.length ? 'text-danger' : 'text-muted'}"></i> <strong>${estoqueBaixo.length}</strong> com estoque baixo</a>
      <a href="#/produtos"><i class="bi bi-calendar-x ${vencendo.length ? 'text-danger' : 'text-muted'}"></i> <strong>${vencendo.length}</strong> produto${vencendo.length === 1 ? '' : 's'} vencendo</a>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-lg-8">
        <div class="card h-100">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span>Receitas x Despesas <span class="text-muted fw-normal fs-7">· últimos 6 meses</span></span>
            <span class="fs-7 text-muted">Saldo do mês: <strong class="${lucroMes >= 0 ? 'text-success' : 'text-danger'}">${money(lucroMes)}</strong></span>
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
                  <div class="fw-semibold">${emoji(P[a.petId]?.especie)} ${esc(P[a.petId]?.nome || 'Pet removido')} <span class="text-muted fw-normal fs-7">· ${esc(C[a.clienteId]?.nome || '')}</span></div>
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
                <div><div class="fw-semibold fs-7">${emoji(P[v.petId]?.especie)} ${esc(P[v.petId]?.nome || '—')} · ${esc(v.nome)}</div>
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

  $('#btnDispensarChecklist', view)?.addEventListener('click', async () => {
    await updateDoc(doc(db, 'clinicas', state.clinicaId), { onboardingDispensado: true });
    state.clinica.onboardingDispensado = true;
    $('#cardChecklist', view).remove();
    toast('Checklist dispensado — você pode acessar os mesmos passos a qualquer momento pelos atalhos abaixo.');
  });
}

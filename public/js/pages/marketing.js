// ================= Central de Marketing (plano Profissional ou superior) =================
// Segmenta a base de tutores (aniversariantes do mês, inativos, fiado em aberto, vacina vencendo) e
// gera o link do WhatsApp pronto para cada contato do segmento. Não existe "disparo em massa"
// automático de verdade aqui — isso exigiria a API oficial do WhatsApp Business (paga à parte) — o
// que a tela faz é organizar a lista e abrir o wa.me de cada contato com a mensagem já escrita.
import { list, create, loadTutoresPets, where } from '../store.js';
import { $, esc, pageHeader, empty, toast, fmtDate, today, addDays, toISODate, modal } from '../ui.js';
import { emoji } from './pets.js';

const DIAS_INATIVO = 90;

const SEGMENTOS = {
  aniversario: {
    label: 'Aniversariantes do mês', icone: 'gift',
    padrao: (nome, pet) => `Oi ${nome}! 🎉 Esse mês é aniversário do(a) ${pet}! Que tal aproveitar pra agendar um check-up ou um banho especial? Responda aqui que a gente já vê um horário.`
  },
  inativos: {
    label: `Sem visita há ${DIAS_INATIVO}+ dias`, icone: 'arrow-repeat',
    padrao: (nome, pet) => `Oi ${nome}! Faz tempo que a gente não vê o(a) ${pet} por aqui 🐾 Vamos agendar um retorno?`
  },
  fiado: {
    label: 'Fiado em aberto', icone: 'cash-stack',
    padrao: (nome) => `Oi ${nome}! Passando para lembrar de uma pendência em aberto na clínica. Qualquer dúvida sobre o valor, é só chamar por aqui. 🐾`
  },
  vacina: {
    label: 'Vacina vencendo em 30 dias', icone: 'shield-plus',
    padrao: (nome, pet) => `Oi ${nome}! A vacina do(a) ${pet} vence em breve. Vamos agendar a aplicação? 💉`
  }
};

export async function render(view) {
  view.innerHTML = pageHeader('Marketing', 'Campanhas segmentadas para reativar e fidelizar tutores') + '<div class="loading"><div class="spinner-border"></div></div>';

  const em30 = toISODate(addDays(new Date(), 30));
  const limiteInativo = toISODate(addDays(new Date(), -DIAS_INATIVO));
  const mesHoje = today().slice(5, 7);

  const [{ clientes, pets, C }, vendas, ags, atend, fin, vacinas, campanhas] = await Promise.all([
    loadTutoresPets(), list('vendas'), list('agendamentos', where('status', '==', 'concluido')), list('atendimentos'),
    list('financeiro', where('tipo', '==', 'receita'), where('pago', '==', false)),
    list('vacinas', where('proximaDose', '>=', today()), where('proximaDose', '<=', em30)),
    list('campanhas')
  ]);
  const petsPor = (cid) => pets.filter(p => p.clienteId === cid);

  const ultimaVisita = {};
  const marca = (cid, data) => { if (cid && data && (!ultimaVisita[cid] || data > ultimaVisita[cid])) ultimaVisita[cid] = data; };
  vendas.forEach(v => marca(v.clienteId, v.data));
  ags.forEach(a => marca(a.clienteId, a.inicio));
  atend.forEach(a => marca(a.clienteId, a.data));

  const listas = {
    aniversario: pets.filter(p => p.nascimento?.slice(5, 7) === mesHoje).map(p => ({ clienteId: p.clienteId, petNome: p.nome })),
    inativos: clientes.filter(c => petsPor(c.id).length && (!ultimaVisita[c.id] || ultimaVisita[c.id] < limiteInativo))
      .map(c => ({ clienteId: c.id, petNome: petsPor(c.id).map(p => p.nome).join(' e ') })),
    fiado: [...new Map(fin.filter(f => f.clienteId).map(f => [f.clienteId, f])).values()].map(f => ({ clienteId: f.clienteId, petNome: '' })),
    vacina: vacinas.map(v => ({ clienteId: pets.find(p => p.id === v.petId)?.clienteId, petNome: pets.find(p => p.id === v.petId)?.nome || '' })).filter(x => x.clienteId)
  };

  view.innerHTML = `
    ${pageHeader('Marketing', 'Campanhas segmentadas para reativar e fidelizar tutores')}
    <div class="row g-3 mb-4" id="segmentos"></div>
    <div class="card">
      <div class="card-header">Histórico de campanhas</div>
      <div class="table-responsive"><table class="table"><thead><tr><th>Quando</th><th>Segmento</th><th class="text-end">Contatos</th></tr></thead>
      <tbody id="tbHistorico"></tbody></table></div>
    </div>`;

  $('#segmentos', view).innerHTML = Object.entries(SEGMENTOS).map(([k, s]) => `
    <div class="col-md-6 col-xl-3"><div class="card h-100">
      <div class="card-body d-flex flex-column">
        <div class="d-flex align-items-center gap-2 mb-2"><i class="bi bi-${s.icone} fs-4 text-primary"></i><span class="fw-semibold">${esc(s.label)}</span></div>
        <div class="fs-2 fw-bold mb-2">${listas[k].length}</div>
        <button class="btn btn-soft btn-sm mt-auto" data-abrir="${k}" ${listas[k].length ? '' : 'disabled'}>Ver contatos</button>
      </div>
    </div></div>`).join('');

  $('#tbHistorico', view).innerHTML = campanhas.length
    ? campanhas.sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || '')).slice(0, 30).map(c => `
      <tr><td class="fs-7">${fmtDate((c.criadoEm || '').slice(0, 10))}</td><td class="fs-7">${esc(SEGMENTOS[c.segmento]?.label || c.segmento)}</td><td class="text-end fs-7">${c.quantidade}</td></tr>`).join('')
    : `<tr><td colspan="3">${empty('megaphone', 'Nenhuma campanha disparada ainda.')}</td></tr>`;

  function abrirSegmento(chave) {
    const s = SEGMENTOS[chave];
    const contatos = listas[chave].filter((x, i, arr) => arr.findIndex(y => y.clienteId === x.clienteId) === i)
      .map(x => ({ ...x, cliente: C[x.clienteId] })).filter(x => x.cliente);
    const { el } = modal({
      title: `${s.label} (${contatos.length})`, size: 'lg',
      body: `
        <label class="form-label">Mensagem (edite se quiser — {{nome}} e {{pet}} são preenchidos automaticamente)</label>
        <textarea class="form-control mb-3" id="msgCampanha" rows="3"></textarea>
        <div class="list-group list-group-flush" style="max-height:40vh;overflow:auto">${contatos.map(c => {
          const whats = (c.cliente.telefone || '').replace(/\D/g, '');
          return `<div class="list-group-item d-flex justify-content-between align-items-center">
            <span class="fs-7">${esc(c.cliente.nome)}${c.petNome ? ' · ' + esc(c.petNome) : ''}</span>
            ${whats ? `<a class="btn btn-sm btn-success" target="_blank" data-whats="${c.clienteId}" data-pet="${esc(c.petNome)}" href="#"><i class="bi bi-whatsapp me-1"></i>Chamar</a>` : '<span class="text-muted fs-8">Sem telefone</span>'}
          </div>`;
        }).join('') || '<div class="p-3 text-muted fs-7">Nenhum contato neste segmento.</div>'}</div>`,
      footer: '<button class="btn btn-light" data-bs-dismiss="modal">Fechar</button><button class="btn btn-primary" id="okCampanha"><i class="bi bi-check2 me-1"></i>Marcar campanha como iniciada</button>'
    });
    const campo = $('#msgCampanha', el);
    campo.value = s.padrao('{{nome}}', '{{pet}}');
    el.querySelectorAll('[data-whats]').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      const c = contatos.find(x => x.clienteId === a.dataset.whats);
      const whats = (c.cliente.telefone || '').replace(/\D/g, '');
      const texto = campo.value.replace(/\{\{nome\}\}/g, c.cliente.nome?.split(' ')[0] || '').replace(/\{\{pet\}\}/g, a.dataset.pet || 'seu pet');
      window.open(`https://wa.me/55${whats}?text=${encodeURIComponent(texto)}`, '_blank');
    }));
    $('#okCampanha', el).onclick = async () => {
      await create('campanhas', { segmento: chave, mensagem: campo.value, quantidade: contatos.length });
      toast('Campanha registrada no histórico');
      render(view);
    };
  }

  $('#segmentos', view).onclick = (e) => { const b = e.target.closest('[data-abrir]'); if (b) abrirSegmento(b.dataset.abrir); };
}

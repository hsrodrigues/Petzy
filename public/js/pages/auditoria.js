// ================= Auditoria: quem mexeu em quê =================
// Lista as últimas ações registradas automaticamente pelo js/store.js a cada criação/edição/exclusão.
// É só leitura (as regras do Firestore proíbem editar ou apagar um registro já gravado).
import { list, orderBy, limit } from '../store.js';
import { $, esc, pageHeader, empty, fmtDateTime, debounce, norm } from '../ui.js';

const LABEL_COLECAO = {
  clientes: 'Tutor', pets: 'Pet', prontuarios: 'Prontuário', atendimentos: 'Atendimento', vacinas: 'Vacina',
  agendamentos: 'Agendamento', produtos: 'Produto/Serviço', fornecedores: 'Fornecedor', financeiro: 'Financeiro',
  vendas: 'Venda (PDV)', fiscal: 'Nota fiscal', internacoes: 'Internação', modelos: 'Modelo de receita'
};
const ACAO = {
  criar: { l: 'Criou', c: 'success', i: 'plus-circle' },
  editar: { l: 'Editou', c: 'info', i: 'pencil' },
  excluir: { l: 'Excluiu', c: 'danger', i: 'trash' }
};

export async function render(view) {
  view.innerHTML = pageHeader('Auditoria', 'Últimas 300 ações registradas na sua clínica') + '<div class="loading"><div class="spinner-border"></div></div>';
  const registros = (await list('auditoria', orderBy('criadoEm', 'desc'), limit(300)));

  view.innerHTML = `
    ${pageHeader('Auditoria', 'Últimas 300 ações registradas na sua clínica · leitura apenas, ninguém pode apagar o histórico')}
    <div class="card">
      <div class="card-header d-flex gap-2 flex-wrap align-items-center">
        <input class="form-control" style="max-width:320px" id="busca" placeholder="Usuário, cadastro ou resumo...">
        <select class="form-select w-auto" id="fAcao"><option value="">Todas as ações</option>
          ${Object.entries(ACAO).map(([k, a]) => `<option value="${k}">${a.l}</option>`).join('')}</select>
        <button class="btn btn-light border ms-auto" id="limparFiltros" title="Limpar filtros"><i class="bi bi-x-circle me-1"></i>Limpar</button>
      </div>
      <div class="table-responsive"><table class="table table-hover">
        <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Cadastro</th><th>Resumo</th></tr></thead>
        <tbody id="tbody"></tbody>
      </table></div>
    </div>`;

  function desenhar() {
    const q = norm($('#busca', view).value), fa = $('#fAcao', view).value;
    const rows = registros.filter(r => (!fa || r.acao === fa) &&
      (!q || norm([r.usuarioNome, r.colecao, r.resumo].join(' ')).includes(q)));
    $('#tbody', view).innerHTML = rows.length ? rows.map(r => {
      const a = ACAO[r.acao] || { l: r.acao, c: 'secondary', i: 'question' };
      return `<tr>
        <td class="fs-7 text-nowrap">${fmtDateTime(r.criadoEm)}</td>
        <td class="fs-7">${esc(r.usuarioNome || '—')}</td>
        <td><span class="badge badge-soft-${a.c}"><i class="bi bi-${a.i} me-1"></i>${esc(a.l)}</span></td>
        <td class="fs-7">${esc(LABEL_COLECAO[r.colecao] || r.colecao)}</td>
        <td class="fs-7 text-muted">${esc(r.resumo || '—')}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="5">${empty('shield-check', 'Nenhum registro encontrado.')}</td></tr>`;
  }

  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#fAcao', view).onchange = desenhar;
  $('#limparFiltros', view).onclick = () => { $('#busca', view).value = ''; $('#fAcao', view).value = ''; desenhar(); };
  desenhar();
}

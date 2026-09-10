import { list, save, remove, create, bumpEstoque } from '../store.js';
import { $, esc, pageHeader, empty, formModal, confirmar, toast, money, num, badge, kpi, norm, debounce, exportCSV } from '../ui.js';
import { exigirLicenca } from '../app.js';

const CATEGORIAS = {
  produto: ['Ração', 'Petiscos', 'Medicamentos', 'Higiene', 'Acessórios', 'Brinquedos', 'Farmácia', 'Outros'],
  servico: ['Consulta', 'Vacina', 'Exame', 'Cirurgia', 'Banho', 'Tosa', 'Hospedagem', 'Outros']
};

export async function render(view) {
  let itens = await list('produtos');
  let aba = 'produto';

  view.innerHTML = `
    ${pageHeader('Produtos & Serviços', 'Catálogo, preços e controle de estoque',
      `<button class="btn btn-light border" id="btnCsv"><i class="bi bi-download me-1"></i>Exportar</button>
       <button class="btn btn-primary" id="btnNovo"><i class="bi bi-plus-lg me-1"></i>Novo item</button>`)}
    <div class="row g-3 mb-3" id="kpis"></div>
    <div class="card">
      <div class="card-header d-flex gap-2 flex-wrap align-items-center">
        <ul class="nav nav-pills gap-1" id="abas">
          <li class="nav-item"><button class="nav-link active" data-a="produto"><i class="bi bi-box-seam me-1"></i>Produtos</button></li>
          <li class="nav-item"><button class="nav-link" data-a="servico"><i class="bi bi-scissors me-1"></i>Serviços</button></li>
        </ul>
        <select class="form-select w-auto ms-auto" id="fCat"></select>
        <input class="form-control" style="max-width:260px" id="busca" placeholder="Nome ou código...">
        <div class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" id="fBaixo"><label class="form-check-label fs-7">Estoque baixo</label></div>
      </div>
      <div class="table-responsive"><table class="table table-hover">
        <thead id="thead"></thead><tbody id="tbody"></tbody>
      </table></div>
    </div>`;

  const baixo = (p) => p.tipo !== 'servico' && (p.estoque ?? 0) <= (p.estoqueMinimo ?? 0);

  function desenhar() {
    const prods = itens.filter(i => i.tipo !== 'servico');
    const valorEstoque = prods.reduce((s, p) => s + (p.estoque || 0) * (p.precoCusto || 0), 0);
    $('#kpis', view).innerHTML = `
      <div class="col-6 col-lg-3">${kpi('box-seam', 'Produtos', prods.length)}</div>
      <div class="col-6 col-lg-3">${kpi('scissors', 'Serviços', itens.length - prods.length, 'info')}</div>
      <div class="col-6 col-lg-3">${kpi('safe', 'Valor em estoque (custo)', money(valorEstoque), 'success')}</div>
      <div class="col-6 col-lg-3">${kpi('exclamation-triangle', 'Estoque baixo', prods.filter(baixo).length, 'danger')}</div>`;

    const cat = $('#fCat', view).value, q = norm($('#busca', view).value), sóBaixo = $('#fBaixo', view).checked;
    const rows = itens.filter(i => (aba === 'servico' ? i.tipo === 'servico' : i.tipo !== 'servico') && (!cat || i.categoria === cat) &&
      (!q || norm([i.nome, i.codigo].join(' ')).includes(q)) && (!sóBaixo || baixo(i))).sort((a, b) => a.nome.localeCompare(b.nome));

    $('#thead', view).innerHTML = aba === 'produto'
      ? '<tr><th>Produto</th><th>Categoria</th><th class="text-end">Custo</th><th class="text-end">Venda</th><th class="text-end">Margem</th><th class="text-center">Estoque</th><th class="text-end">Ações</th></tr>'
      : '<tr><th>Serviço</th><th>Categoria</th><th class="text-end">Duração</th><th class="text-end">Preço</th><th class="text-end">Ações</th></tr>';

    $('#tbody', view).innerHTML = rows.length ? rows.map(i => {
      const margem = i.precoVenda && i.precoCusto ? ((i.precoVenda - i.precoCusto) / i.precoVenda) * 100 : null;
      const acoes = `<td class="text-end text-nowrap">
        ${aba === 'produto' ? `<button class="btn btn-icon btn-light" title="Movimentar estoque" data-mov="${i.id}"><i class="bi bi-arrow-down-up"></i></button>` : ''}
        <button class="btn btn-icon btn-light" data-edit="${i.id}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-icon btn-light" data-del="${i.id}"><i class="bi bi-trash text-danger"></i></button></td>`;
      const nome = `<td><div class="fw-semibold">${esc(i.nome)} ${i.ativo === false ? badge('inativo', 'secondary') : ''}</div><div class="text-muted fs-8">${esc(i.codigo || '')}</div></td>`;
      return aba === 'produto'
        ? `<tr>${nome}<td class="fs-7">${esc(i.categoria || '—')}</td><td class="text-end fs-7">${money(i.precoCusto)}</td>
            <td class="text-end fw-semibold">${money(i.precoVenda)}</td>
            <td class="text-end fs-7 ${margem != null && margem < 20 ? 'text-danger' : 'text-success'}">${margem != null ? num(margem, 0) + '%' : '—'}</td>
            <td class="text-center">${badge(`${num(i.estoque || 0)} ${i.unidade || 'un'}`, baixo(i) ? 'danger' : 'success')}</td>${acoes}</tr>`
        : `<tr>${nome}<td class="fs-7">${esc(i.categoria || '—')}</td><td class="text-end fs-7">${i.duracao ? i.duracao + ' min' : '—'}</td>
            <td class="text-end fw-semibold">${money(i.precoVenda)}</td>${acoes}</tr>`;
    }).join('') : `<tr><td colspan="7">${empty(aba === 'produto' ? 'box-seam' : 'scissors', 'Nenhum item encontrado.')}</td></tr>`;
  }

  function trocarAba(a) {
    aba = a;
    $('#abas', view).querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.a === a));
    $('#fCat', view).innerHTML = `<option value="">Todas as categorias</option>${CATEGORIAS[a].map(c => `<option>${c}</option>`).join('')}`;
    $('#fBaixo', view).closest('.form-check').classList.toggle('d-none', a === 'servico');
    desenhar();
  }

  async function recarregar() { itens = await list('produtos'); desenhar(); }

  function abrirForm(i = { tipo: aba, ativo: true, unidade: 'un' }) {
    if (!exigirLicenca()) return;
    const serv = i.tipo === 'servico';
    formModal({
      title: i.id ? `Editar ${serv ? 'serviço' : 'produto'}` : `Novo ${serv ? 'serviço' : 'produto'}`, values: i,
      fields: [
        { name: 'nome', label: 'Nome', required: true, col: 'col-md-8' },
        { name: 'codigo', label: serv ? 'Código' : 'Código / EAN', col: 'col-md-4' },
        { name: 'categoria', label: 'Categoria', type: 'select', options: CATEGORIAS[i.tipo === 'servico' ? 'servico' : 'produto'], col: 'col-md-6' },
        serv ? { name: 'duracao', label: 'Duração (min)', type: 'number', col: 'col-md-6' }
             : { name: 'unidade', label: 'Unidade', type: 'select', options: ['un', 'kg', 'g', 'ml', 'L', 'cx', 'pct'], col: 'col-md-6' },
        ...(serv ? [] : [{ name: 'precoCusto', label: 'Preço de custo', type: 'money', col: 'col-md-6' }]),
        { name: 'precoVenda', label: serv ? 'Preço' : 'Preço de venda', type: 'money', required: true, col: 'col-md-6' },
        ...(serv ? [] : [
          { name: 'estoque', label: 'Estoque atual', type: 'number', step: '0.01', col: 'col-md-6', attrs: i.id ? 'readonly title="Use a movimentação de estoque"' : '' },
          { name: 'estoqueMinimo', label: 'Estoque mínimo', type: 'number', step: '0.01', col: 'col-md-6' },
          { name: 'validade', label: 'Validade (lote atual)', type: 'date', col: 'col-md-6' }
        ]),
        { name: 'ativo', label: 'Ativo (aparece no PDV)', type: 'checkbox', col: 'col-12' }
      ],
      onSubmit: async (d) => {
        d.tipo = i.tipo || aba;
        if (i.id) delete d.estoque; // estoque só muda via movimentação
        await save('produtos', i.id, d);
        toast('Item salvo'); await recarregar();
      }
    });
  }

  function movimentar(p) {
    if (!exigirLicenca()) return;
    formModal({
      title: `Movimentar estoque · ${esc(p.nome)}`, size: 'md', values: { tipo: 'entrada' },
      fields: [
        { type: 'custom', col: 'col-12', html: `<div class="bg-light rounded-3 p-3 text-center">Estoque atual: <strong class="fs-5">${num(p.estoque || 0)} ${p.unidade || 'un'}</strong></div>` },
        { name: 'tipo', label: 'Tipo', type: 'select', required: true, options: [{ value: 'entrada', label: 'Entrada (compra)' }, { value: 'saida', label: 'Saída (perda/uso interno)' }, { value: 'ajuste', label: 'Ajuste (definir quantidade)' }], col: 'col-md-6' },
        { name: 'quantidade', label: 'Quantidade', type: 'number', step: '0.01', required: true, col: 'col-md-6' },
        { name: 'motivo', label: 'Observação / fornecedor / NF', col: 'col-12' }
      ],
      onSubmit: async (d) => {
        const atual = p.estoque || 0;
        const delta = d.tipo === 'entrada' ? d.quantidade : d.tipo === 'saida' ? -d.quantidade : d.quantidade - atual;
        await bumpEstoque(p.id, delta);
        await create('movimentacoes', { produtoId: p.id, produto: p.nome, tipo: d.tipo, quantidade: delta, motivo: d.motivo, data: new Date().toISOString() });
        toast('Estoque atualizado'); await recarregar();
      }
    });
  }

  $('#abas', view).onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) trocarAba(b.dataset.a); };
  $('#fCat', view).onchange = desenhar;
  $('#fBaixo', view).onchange = desenhar;
  $('#busca', view).addEventListener('input', debounce(desenhar, 150));
  $('#btnNovo', view).onclick = () => abrirForm();
  $('#btnCsv', view).onclick = () => exportCSV('produtos.csv', itens.map(i => ({
    Nome: i.nome, Tipo: i.tipo, Categoria: i.categoria, Codigo: i.codigo, Custo: i.precoCusto, Venda: i.precoVenda, Estoque: i.estoque, Minimo: i.estoqueMinimo
  })));
  $('#tbody', view).onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const i = itens.find(x => x.id === (b.dataset.edit || b.dataset.del || b.dataset.mov));
    if (b.dataset.edit) abrirForm(i);
    if (b.dataset.mov) movimentar(i);
    if (b.dataset.del && exigirLicenca() && await confirmar(`Excluir <strong>${esc(i.nome)}</strong>?`)) { await remove('produtos', i.id); toast('Item excluído'); recarregar(); }
  };

  trocarAba('produto');
}

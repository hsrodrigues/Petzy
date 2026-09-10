import { state, list, create, PAPEIS, PLANOS, db, writeBatch, col } from '../store.js';
import {
  doc, setDoc, updateDoc, initializeApp, deleteApp, getAuth, createUserWithEmailAndPassword, signOut, firebaseConfig
} from '../firebase.js';
import { $, esc, pageHeader, formModal, toast, confirmar, initials, badge, mask, readForm, toISODate, toISODateTime, addDays } from '../ui.js';
import { recarregarClinica, exigirLicenca } from '../app.js';

export async function render(view) {
  const admin = state.perfil.papel === 'admin';
  const c = state.clinica;

  view.innerHTML = `
    ${pageHeader('Configurações', 'Dados da clínica, equipe e preferências')}
    <ul class="nav nav-pills mb-3 gap-1">
      <li class="nav-item"><button class="nav-link active" data-bs-toggle="pill" data-bs-target="#tClinica"><i class="bi bi-building me-1"></i>Clínica</button></li>
      <li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tEquipe"><i class="bi bi-people me-1"></i>Equipe</button></li>
      <li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tPerfil"><i class="bi bi-person me-1"></i>Meu perfil</button></li>
      ${admin ? '<li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tDemo"><i class="bi bi-magic me-1"></i>Dados de exemplo</button></li>' : ''}
    </ul>
    <div class="tab-content">
      <div class="tab-pane fade show active" id="tClinica"><div class="card"><div class="card-body">
        <form id="fClinica" class="row g-3">
          <div class="col-md-6"><label class="form-label">Nome da clínica</label><input class="form-control" name="nome" required value="${esc(c.nome)}"></div>
          <div class="col-md-3"><label class="form-label">CNPJ</label><input class="form-control" name="cnpj" value="${esc(c.cnpj || '')}"></div>
          <div class="col-md-3"><label class="form-label">Tipo</label><select class="form-select" name="tipo">
            ${[['clinica', 'Clínica veterinária'], ['petshop', 'Petshop'], ['ambos', 'Clínica + Petshop']].map(([v, l]) => `<option value="${v}" ${c.tipo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="col-md-4"><label class="form-label">Telefone / WhatsApp</label><input class="form-control" name="telefone" value="${esc(c.telefone || '')}"></div>
          <div class="col-md-4"><label class="form-label">E-mail</label><input class="form-control" type="email" name="email" value="${esc(c.email || '')}"></div>
          <div class="col-md-4"><label class="form-label">Responsável técnico (CRMV)</label><input class="form-control" name="responsavel" value="${esc(c.responsavel || '')}"></div>
          <div class="col-12"><label class="form-label">Endereço completo</label><input class="form-control" name="endereco" value="${esc(c.endereco || '')}"></div>
          <div class="col-12"><h6 class="fw-bold text-primary mt-2 mb-0">Agenda</h6></div>
          <div class="col-md-3"><label class="form-label">Abre às</label><select class="form-select" name="horaInicio">${[...Array(24).keys()].map(h => `<option value="${h}" ${(c.config?.horaInicio ?? 8) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
          <div class="col-md-3"><label class="form-label">Fecha às</label><select class="form-select" name="horaFim">${[...Array(24).keys()].map(h => h + 1).map(h => `<option value="${h}" ${(c.config?.horaFim ?? 19) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
          <div class="col-12 text-end"><button class="btn btn-primary px-4" ${admin ? '' : 'disabled'}>Salvar alterações</button></div>
        </form>
      </div></div></div>

      <div class="tab-pane fade" id="tEquipe"><div class="card">
        <div class="card-header d-flex justify-content-between align-items-center"><span id="equipeInfo">Equipe</span>
          ${admin ? '<button class="btn btn-primary btn-sm" id="btnMembro"><i class="bi bi-person-plus me-1"></i>Adicionar membro</button>' : ''}</div>
        <div class="table-responsive"><table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Status</th>${admin ? '<th class="text-end">Ações</th>' : ''}</tr></thead><tbody id="tbEquipe"></tbody></table></div>
      </div></div>

      <div class="tab-pane fade" id="tPerfil"><div class="card"><div class="card-body">
        <form id="fPerfil" class="row g-3" style="max-width:640px">
          <div class="col-md-8"><label class="form-label">Nome</label><input class="form-control" name="nome" required value="${esc(state.perfil.nome || '')}"></div>
          <div class="col-md-4"><label class="form-label">CRMV (sai na receita)</label><input class="form-control" name="crmv" value="${esc(state.perfil.crmv || '')}"></div>
          <div class="col-12"><label class="form-label">E-mail de acesso</label><input class="form-control" value="${esc(state.user.email)}" disabled></div>
          <div class="col-12"><button class="btn btn-primary">Salvar perfil</button></div>
        </form>
      </div></div></div>

      ${admin ? `<div class="tab-pane fade" id="tDemo"><div class="card"><div class="card-body">
        <h5 class="fw-bold">Popular com dados de demonstração</h5>
        <p class="text-muted">Cria tutores, pets, produtos, serviços, agendamentos desta semana, prontuários, vacinas, vendas e lançamentos financeiros dos últimos meses. Ótimo para conhecer o sistema ou apresentar a clientes.</p>
        <button class="btn btn-gradient" id="btnDemo"><i class="bi bi-magic me-1"></i>Gerar dados de exemplo</button>
      </div></div></div>` : ''}
    </div>`;

  mask($('[name=cnpj]', view), 'cnpj'); mask($('[name=telefone]', view), 'tel');

  // ---------- clínica ----------
  $('#fClinica', view).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    await updateDoc(doc(db, 'clinicas', state.clinicaId), {
      nome: f.nome.value.trim(), cnpj: f.cnpj.value, tipo: f.tipo.value, telefone: f.telefone.value, email: f.email.value,
      responsavel: f.responsavel.value, endereco: f.endereco.value,
      config: { ...(c.config || {}), horaInicio: Number(f.horaInicio.value), horaFim: Number(f.horaFim.value) }
    });
    await recarregarClinica();
    toast('Dados da clínica atualizados');
  };

  // ---------- perfil ----------
  $('#fPerfil', view).onsubmit = async (e) => {
    e.preventDefault();
    const d = { nome: e.target.nome.value.trim(), crmv: e.target.crmv.value.trim() };
    await updateDoc(doc(db, 'usuarios', state.user.uid), d);
    await updateDoc(doc(db, 'clinicas', state.clinicaId, 'equipe', state.user.uid), d).catch(() => {});
    Object.assign(state.perfil, d);
    $('#userName').textContent = d.nome;
    toast('Perfil atualizado');
  };

  // ---------- equipe ----------
  let equipe = [];
  const limite = PLANOS[c.plano]?.usuarios ?? 2;

  async function carregarEquipe() {
    equipe = await list('equipe');
    const ativos = equipe.filter(m => m.ativo).length;
    $('#equipeInfo', view).innerHTML = `Equipe <span class="text-muted fw-normal fs-7">· ${ativos} de ${limite >= 99 ? 'ilimitados' : limite} usuários do plano</span>`;
    $('#tbEquipe', view).innerHTML = equipe.map(m => `<tr>
      <td><div class="d-flex align-items-center gap-2"><span class="avatar">${initials(m.nome)}</span><span class="fw-semibold">${esc(m.nome)}</span>${m.id === state.user.uid ? badge('você', 'primary') : ''}</div></td>
      <td class="fs-7">${esc(m.email)}</td><td class="fs-7">${PAPEIS[m.papel] || m.papel}</td>
      <td>${m.ativo ? badge('ativo', 'success') : badge('inativo', 'secondary')}</td>
      ${admin ? `<td class="text-end">${m.id === c.ownerUid ? '<span class="text-muted fs-8">proprietário</span>' : `
        <button class="btn btn-sm btn-light border" data-papel="${m.id}">Função</button>
        <button class="btn btn-sm ${m.ativo ? 'btn-outline-danger' : 'btn-outline-success'}" data-toggle="${m.id}">${m.ativo ? 'Desativar' : 'Reativar'}</button>`}</td>` : ''}
    </tr>`).join('');
  }

  async function atualizarMembro(uid, patch) {
    await updateDoc(doc(db, 'usuarios', uid), patch);
    await updateDoc(doc(db, 'clinicas', state.clinicaId, 'equipe', uid), patch);
    await carregarEquipe();
  }

  if (admin) {
    $('#btnMembro', view).onclick = () => {
      if (!exigirLicenca()) return;
      if (equipe.filter(m => m.ativo).length >= limite) return toast(`Seu plano permite ${limite} usuários. Faça upgrade na Assinatura.`, 'warning');
      formModal({
        title: 'Adicionar membro da equipe', size: 'md', submit: 'Criar acesso',
        fields: [
          { name: 'nome', label: 'Nome', required: true, col: 'col-12' },
          { name: 'email', label: 'E-mail', type: 'email', required: true, col: 'col-12' },
          { name: 'senha', label: 'Senha provisória', type: 'text', required: true, col: 'col-md-6', attrs: 'minlength="6"', default: Math.random().toString(36).slice(2, 10) },
          { name: 'papel', label: 'Função', type: 'select', required: true, options: Object.entries(PAPEIS).map(([v, l]) => ({ value: v, label: l })), col: 'col-md-6', default: 'recepcao' },
          { type: 'custom', col: 'col-12', html: '<div class="alert alert-info fs-7 mb-0">Envie o e-mail e a senha provisória para o colaborador. Ele pode trocar a senha em "Esqueci minha senha".</div>' }
        ],
        onSubmit: async (d) => {
          // usa uma instância secundária do Firebase para não deslogar o admin
          const sec = initializeApp(firebaseConfig, 'sec-' + Date.now());
          try {
            const sAuth = getAuth(sec);
            const { user } = await createUserWithEmailAndPassword(sAuth, d.email, d.senha);
            await signOut(sAuth);
            const perfil = { nome: d.nome, email: d.email, papel: d.papel, ativo: true, criadoEm: new Date().toISOString() };
            await setDoc(doc(db, 'usuarios', user.uid), { ...perfil, clinicaId: state.clinicaId });
            await setDoc(doc(db, 'clinicas', state.clinicaId, 'equipe', user.uid), perfil);
            toast(`${d.nome} adicionado(a) à equipe`);
            await carregarEquipe();
          } catch (e) {
            if (e.code === 'auth/email-already-in-use') throw new Error('Este e-mail já tem conta no Petzy.');
            throw e;
          } finally { deleteApp(sec); }
        }
      });
    };

    $('#tbEquipe', view).onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const m = equipe.find(x => x.id === (b.dataset.papel || b.dataset.toggle));
      if (b.dataset.toggle) {
        if (!m.ativo && equipe.filter(x => x.ativo).length >= limite) return toast('Limite de usuários do plano atingido.', 'warning');
        if (m.ativo && !(await confirmar(`Desativar o acesso de <strong>${esc(m.nome)}</strong>?`))) return;
        await atualizarMembro(m.id, { ativo: !m.ativo }); toast('Acesso atualizado');
      }
      if (b.dataset.papel) formModal({
        title: `Função de ${esc(m.nome)}`, size: 'sm', values: m,
        fields: [{ name: 'papel', label: 'Função', type: 'select', required: true, options: Object.entries(PAPEIS).map(([v, l]) => ({ value: v, label: l })), col: 'col-12' }],
        onSubmit: async (d) => { await atualizarMembro(m.id, { papel: d.papel }); toast('Função alterada'); }
      });
    };

    $('#btnDemo', view).onclick = async () => {
      if (!exigirLicenca()) return;
      if (!(await confirmar('Gerar dados de exemplo nesta clínica?', { ok: 'Gerar', danger: false }))) return;
      const b = $('#btnDemo', view); b.disabled = true; b.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Gerando...';
      try { await gerarDemo(); toast('Dados de exemplo criados! 🎉'); location.hash = '#/dashboard'; }
      catch (e) { toast(e.message, 'danger'); b.disabled = false; b.textContent = 'Gerar dados de exemplo'; }
    };
  }

  await carregarEquipe();
}

// ================= Dados de demonstração =================
async function gerarDemo() {
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const now = new Date().toISOString();
  const b = writeBatch(db);
  const novo = (name, data) => { const r = doc(col(name)); b.set(r, { ...data, criadoEm: data.criadoEm || now }); return r.id; };

  const nomes = ['Ana Beatriz Souza', 'Carlos Eduardo Lima', 'Fernanda Oliveira', 'João Pedro Santos', 'Mariana Costa', 'Rafael Almeida', 'Juliana Ferreira', 'Lucas Martins', 'Patrícia Rocha', 'Bruno Carvalho', 'Camila Ribeiro', 'Diego Nascimento'];
  const pets = [['Thor', 'Cão', 'Golden Retriever'], ['Luna', 'Gato', 'Siamês'], ['Mel', 'Cão', 'Shih Tzu'], ['Bob', 'Cão', 'SRD'], ['Nina', 'Gato', 'Persa'], ['Max', 'Cão', 'Labrador'], ['Pipoca', 'Cão', 'Poodle'], ['Frida', 'Gato', 'SRD'], ['Zeus', 'Cão', 'Bulldog Francês'], ['Amora', 'Cão', 'Yorkshire'], ['Simba', 'Gato', 'Maine Coon'], ['Bidu', 'Cão', 'Beagle'], ['Kiara', 'Cão', 'Lhasa Apso'], ['Tom', 'Gato', 'SRD'], ['Paçoca', 'Cão', 'Pinscher'], ['Loki', 'Cão', 'Border Collie']];

  const cIds = nomes.map((n, i) => novo('clientes', { nome: n, telefone: `(11) 9${rint(8000, 9999)}-${rint(1000, 9999)}`, email: n.split(' ')[0].toLowerCase() + '@email.com', cidade: 'São Paulo', uf: 'SP', criadoEm: toISODate(addDays(new Date(), -rint(1, 120))) }));
  const pIds = pets.map(([nome, especie, raca], i) => ({
    id: novo('pets', { nome, especie, raca, clienteId: cIds[i % cIds.length], sexo: rnd(['Macho', 'Fêmea']), peso: especie === 'Gato' ? rint(3, 6) : rint(4, 32), nascimento: toISODate(addDays(new Date(), -rint(200, 4000))), castrado: Math.random() > .4 }),
    cid: cIds[i % cIds.length]
  }));

  const prods = [['Ração Premium Cães 15kg', 'Ração', 189.9, 132, 12], ['Ração Gatos Castrados 10kg', 'Ração', 159.9, 110, 8], ['Petisco Bifinho 500g', 'Petiscos', 29.9, 15, 30], ['Shampoo Neutro 500ml', 'Higiene', 34.9, 17, 3], ['Antipulgas Comprimido', 'Farmácia', 89.9, 55, 20], ['Vermífugo 4 comp.', 'Farmácia', 39.9, 21, 25], ['Coleira Antipulgas', 'Acessórios', 69.9, 38, 2], ['Brinquedo Mordedor', 'Brinquedos', 24.9, 9, 18]]
    .map(([nome, categoria, precoVenda, precoCusto, estoque]) => ({ id: novo('produtos', { nome, categoria, precoVenda, precoCusto, estoque, estoqueMinimo: 5, unidade: 'un', tipo: 'produto', ativo: true }), nome, precoVenda, precoCusto }));
  const servs = [['Consulta clínica', 'Consulta', 150, 30], ['Retorno', 'Consulta', 0, 20], ['Vacina V10', 'Vacina', 120, 15], ['Vacina Antirrábica', 'Vacina', 80, 15], ['Banho - porte pequeno', 'Banho', 60, 60], ['Banho & Tosa - porte médio', 'Tosa', 110, 90], ['Hemograma completo', 'Exame', 90, 20], ['Castração felina', 'Cirurgia', 450, 120]]
    .map(([nome, categoria, precoVenda, duracao]) => ({ id: novo('produtos', { nome, categoria, precoVenda, duracao, tipo: 'servico', ativo: true }), nome, precoVenda, categoria }));

  // agendamentos desta semana
  const tipoMap = { Consulta: 'consulta', Vacina: 'vacina', Banho: 'banho', Tosa: 'tosa', Exame: 'exame', Cirurgia: 'cirurgia' };
  for (let i = 0; i < 22; i++) {
    const d = addDays(new Date(), rint(-3, 4)); d.setHours(rint(8, 17), rnd([0, 30]), 0, 0);
    const s = rnd(servs), p = rnd(pIds), passado = d < new Date();
    novo('agendamentos', { petId: p.id, clienteId: p.cid, tipo: tipoMap[s.categoria] || 'consulta', servicoId: s.id, inicio: toISODateTime(d), duracao: 30, valor: s.precoVenda, profissionalId: state.user.uid, status: passado ? rnd(['concluido', 'concluido', 'concluido', 'faltou']) : rnd(['agendado', 'confirmado']) });
  }
  // prontuários e vacinas
  const diag = ['Otite externa', 'Dermatite alérgica', 'Gastroenterite', 'Check-up anual - saudável', 'Doença periodontal', 'Conjuntivite'];
  pIds.slice(0, 10).forEach((p, i) => {
    novo('atendimentos', { petId: p.id, clienteId: p.cid, tipo: 'Consulta', data: toISODateTime(addDays(new Date(), -rint(1, 90))), queixa: 'Tutor relata coceira e desconforto', diagnostico: rnd(diag), temperatura: 38.5, fc: rint(80, 120), fr: rint(18, 30), prescricao: 'Amoxicilina 250mg - 1 comp. VO a cada 12h por 7 dias', vetId: state.user.uid, vetNome: state.perfil.nome });
    const apl = addDays(new Date(), -rint(200, 380));
    novo('vacinas', { petId: p.id, nome: rnd(['V10 (Polivalente)', 'Antirrábica', 'V4 Felina']), dose: 'Reforço anual', dataAplicacao: toISODate(apl), proximaDose: toISODate(addDays(apl, 365)), fabricante: 'Zoetis', lote: 'L' + rint(10000, 99999), veterinario: state.perfil.nome });
  });
  // vendas e financeiro dos últimos 6 meses
  for (let i = 0; i < 60; i++) {
    const d = addDays(new Date(), -rint(0, 170)), it = rnd(prods), qtd = rint(1, 3), total = it.precoVenda * qtd, pag = rnd(['PIX', 'PIX', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro']);
    const vid = novo('vendas', { itens: [{ id: it.id, nome: it.nome, tipo: 'produto', preco: it.precoVenda, custo: it.precoCusto, qtd }], clienteId: rnd(cIds), total, subtotal: total, desconto: 0, pagamento: pag, status: 'concluida', data: d.toISOString().slice(0, 19), vendedor: state.perfil.nome });
    novo('financeiro', { tipo: 'receita', categoria: 'Vendas PDV', descricao: `Venda PDV #${vid.slice(0, 6).toUpperCase()}`, valor: total, vencimento: toISODate(d), pago: true, pagoEm: toISODate(d), formaPagamento: pag, origem: 'venda', origemId: vid });
  }
  for (let m = 0; m < 6; m++) {
    const base = new Date(); base.setMonth(base.getMonth() - m, 5);
    const pago = m > 0 || new Date().getDate() >= 5;
    [['Aluguel', 'Aluguel', 3500], ['Salários', 'Salários', 8200], ['Energia / Água', 'Energia / Água', rint(600, 900)], ['Fornecedores', 'Compra de ração e medicamentos', rint(2500, 4500)]]
      .forEach(([categoria, descricao, valor]) => novo('financeiro', { tipo: 'despesa', categoria, descricao, valor, vencimento: toISODate(base), pago, pagoEm: pago ? toISODate(base) : null, formaPagamento: 'Boleto' }));
    for (let k = 0; k < rint(25, 40); k++) {
      const d = new Date(base); d.setDate(rint(1, 28)); if (d > new Date()) continue;
      const s = rnd(servs.filter(x => x.precoVenda));
      novo('financeiro', { tipo: 'receita', categoria: ['Banho', 'Tosa'].includes(s.categoria) ? 'Banho & Tosa' : 'Serviços clínicos', descricao: s.nome, valor: s.precoVenda, vencimento: toISODate(d), pago: true, pagoEm: toISODate(d), formaPagamento: rnd(['PIX', 'Cartão de crédito', 'Dinheiro']) });
    }
  }
  await b.commit();
}

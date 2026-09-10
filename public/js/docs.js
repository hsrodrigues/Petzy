// ================= Documentos clínicos (HTML A4 pronto para imprimir/salvar PDF) =================
// Funções puras: recebem dados e devolvem HTML. A pré-visualização fica em documentos.js.
import { esc, fmtDate, fmtDateTime, idade } from './ui.js';

export const VIAS = [
  { value: 'Oral', uso: 'interno' }, { value: 'Subcutânea', uso: 'interno' }, { value: 'Intramuscular', uso: 'interno' },
  { value: 'Intravenosa', uso: 'interno' }, { value: 'Retal', uso: 'interno' }, { value: 'Inalatória', uso: 'interno' },
  { value: 'Tópica', uso: 'externo' }, { value: 'Oftálmica', uso: 'externo' }, { value: 'Otológica', uso: 'externo' },
  { value: 'Transdérmica', uso: 'externo' }
];
export const usoDaVia = (via) => VIAS.find(v => v.value === via)?.uso || 'interno';

export const SISTEMAS = [
  ['tegumentar', 'Pele e anexos'], ['oral', 'Cavidade oral'], ['olhos', 'Olhos'], ['ouvidos', 'Ouvidos'],
  ['linfonodos', 'Linfonodos'], ['cardio', 'Cardiovascular'], ['resp', 'Respiratório'], ['digest', 'Digestório'],
  ['uro', 'Geniturinário'], ['musculo', 'Musculoesquelético'], ['neuro', 'Neurológico']
];

const dataExtenso = (iso) => {
  const d = iso ? new Date(iso.length === 10 ? iso + 'T12:00' : iso) : new Date();
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
};
const txt = (s) => esc(s || '').replace(/\n/g, '<br>');

const CSS = `
@page { size: A4; margin: 12mm 14mm; }
* { box-sizing: border-box; }
body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #1f2335; font-size: 12.5px; line-height: 1.5; margin: 0; }
.pagina { min-height: 270mm; display: flex; flex-direction: column; break-after: page; position: relative; }
.pagina:last-child { break-after: auto; }
header.doc { display: flex; align-items: center; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid var(--cor); }
header.doc img { max-height: 70px; max-width: 170px; object-fit: contain; }
header.doc .marca { width: 58px; height: 58px; border-radius: 14px; background: var(--cor); color: #fff; display: grid; place-items: center; font-size: 28px; flex-shrink: 0; }
header.doc h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -.01em; }
header.doc .info { color: #6b7084; font-size: 11px; line-height: 1.45; }
header.doc .resp { margin-left: auto; text-align: right; font-size: 10.5px; color: #6b7084; }
.titulo { text-align: center; margin: 18px 0 14px; }
.titulo h2 { font-size: 16px; letter-spacing: .14em; text-transform: uppercase; margin: 0; color: var(--cor); }
.titulo .sub { color: #6b7084; font-size: 11px; margin-top: 2px; }
.caixa { border: 1px solid #e3e4ee; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; background: #fafaff; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px 16px; }
.span2 { grid-column: span 2; } .span4 { grid-column: span 4; }
.rot { font-size: 9px; text-transform: uppercase; letter-spacing: .07em; color: #8a8ea3; display: block; line-height: 1.3; }
.val { font-weight: 600; }
h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .09em; color: var(--cor); margin: 16px 0 6px; border-bottom: 1px solid #ececf4; padding-bottom: 3px; }
p { margin: 0 0 6px; }
.uso { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; background: var(--cor); color: #fff; padding: 2px 12px; border-radius: 20px; margin: 8px 0 10px; }
.med { margin: 0 0 14px 2px; break-inside: avoid; }
.med .linha { display: flex; align-items: baseline; gap: 6px; font-weight: 700; font-size: 13.5px; }
.med .pont { flex: 1; border-bottom: 1.5px dotted #a3a6b8; transform: translateY(-4px); }
.med .poso { margin: 3px 0 0 22px; font-size: 13px; }
.med .tag { font-size: 10.5px; color: #6b7084; }
table.t { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 6px; }
table.t th, table.t td { border-bottom: 1px solid #ececf4; padding: 5px 8px; text-align: left; vertical-align: top; }
table.t th { font-size: 9px; text-transform: uppercase; color: #8a8ea3; letter-spacing: .06em; background: #fafaff; }
.vitais { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 4px; }
.vitais div { border: 1px solid #ececf4; border-radius: 8px; padding: 5px 8px; }
.vitais b { display: block; font-size: 13px; }
.checks { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 20px; }
.box { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #444; border-radius: 3px; margin-right: 7px; vertical-align: -2px; text-align: center; line-height: 9px; font-size: 10px; font-weight: 800; }
.linha-preencher { display: inline-block; min-width: 180px; border-bottom: 1px solid #999; }
.espaco { flex: 1; min-height: 20px; }
.local { text-align: right; margin: 22px 0 6px; }
.assin { display: flex; justify-content: space-around; gap: 40px; margin-top: 46px; text-align: center; }
.assin div { flex: 1; max-width: 290px; border-top: 1px solid #333; padding-top: 6px; font-size: 11.5px; }
.assin small { color: #6b7084; display: block; font-size: 10.5px; }
footer.doc { margin-top: 18px; padding-top: 8px; border-top: 1px solid #ececf4; font-size: 9.5px; color: #8a8ea3; display: flex; justify-content: space-between; gap: 10px; }
.controle-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
.controle-grid .caixa { background: #fff; font-size: 11px; line-height: 2; }
.aviso { border-left: 3px solid var(--cor); background: #fafaff; padding: 8px 12px; border-radius: 0 8px 8px 0; font-size: 11.5px; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
@media screen {
  body { background: #e9eaf2; padding: 24px 0; }
  .pagina { background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto 24px; padding: 12mm 14mm; box-shadow: 0 10px 40px rgba(20,21,43,.14); border-radius: 4px; }
}`;

// ---------- blocos ----------
function cabecalho(c) {
  const cidade = c.cidade ? `${c.cidade}${c.uf ? '/' + c.uf : ''}` : '';
  const linhas = [
    [c.cnpj && 'CNPJ ' + c.cnpj].filter(Boolean).join(''),
    [c.endereco, cidade].filter(Boolean).join(' · '),
    [c.telefone, c.email].filter(Boolean).join(' · ')
  ].filter(Boolean);
  return `<header class="doc">
    ${c.logo ? `<img src="${c.logo}" alt="">` : '<div class="marca">🐾</div>'}
    <div><h1>${esc(c.nome)}</h1>${linhas.map(l => `<div class="info">${esc(l)}</div>`).join('')}</div>
    ${c.responsavel ? `<div class="resp">Resp. técnico<br><strong>${esc(c.responsavel)}</strong>${c.responsavelCrmv ? '<br>CRMV ' + esc(c.responsavelCrmv) : ''}</div>` : ''}
  </header>`;
}

export function blocoPaciente(p = {}, t = {}) {
  const end = [t.endereco, t.numero, t.bairro, t.cidade && t.cidade + (t.uf ? '/' + t.uf : '')].filter(Boolean).join(', ');
  return `<div class="caixa"><div class="grid">
    <div class="span2"><span class="rot">Paciente</span><span class="val">${esc(p.nome || '—')}</span></div>
    <div><span class="rot">Espécie</span>${esc(p.especie || '—')}</div>
    <div><span class="rot">Raça</span>${esc(p.raca || '—')}</div>
    <div><span class="rot">Sexo</span>${esc(p.sexo || '—')}${p.castrado ? ' · castrado(a)' : ''}</div>
    <div><span class="rot">Idade</span>${idade(p.nascimento)}${p.nascimento ? ` <span style="color:#8a8ea3">(${fmtDate(p.nascimento)})</span>` : ''}</div>
    <div><span class="rot">Peso</span>${p.peso ? p.peso + ' kg' : '—'}</div>
    <div><span class="rot">Pelagem</span>${esc(p.pelagem || '—')}</div>
    <div class="span2"><span class="rot">Tutor(a)</span><span class="val">${esc(t.nome || '—')}</span></div>
    <div><span class="rot">CPF</span>${esc(t.cpf || '—')}</div>
    <div><span class="rot">Telefone</span>${esc(t.telefone || '—')}</div>
    ${end ? `<div class="span4"><span class="rot">Endereço</span>${esc(end)}</div>` : ''}
    ${p.microchip ? `<div class="span4"><span class="rot">Microchip</span>${esc(p.microchip)}</div>` : ''}
  </div></div>`;
}

const assinVet = (v = {}) => `<div>${esc(v.nome || '')}<small>Médico(a) Veterinário(a)${v.crmv ? ' · CRMV ' + esc(v.crmv) : ''}</small></div>`;

function pagina({ c, titulo, sub, corpo, vet, tutor, assinaTutor, data, semAssinatura }) {
  return `<section class="pagina">
    ${cabecalho(c)}
    <div class="titulo"><h2>${titulo}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    ${corpo}
    <div class="espaco"></div>
    ${semAssinatura ? '' : `<div class="local">${esc(c.cidade ? c.cidade + ', ' : '')}${dataExtenso(data)}.</div>
    <div class="assin">${assinaTutor ? `<div>${esc(tutor?.nome || '')}<small>Tutor(a) responsável${tutor?.cpf ? ' · CPF ' + esc(tutor.cpf) : ''}</small></div>` : ''}${assinVet(vet)}</div>`}
    <footer class="doc"><span>${esc(c.rodape || [c.nome, c.telefone].filter(Boolean).join(' · '))}</span><span>Emitido pelo Petzy em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span></footer>
  </section>`;
}

export function documento(paginas, titulo, c = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>:root{--cor:${/^#[0-9a-f]{6}$/i.test(c.corDocumentos || '') ? c.corDocumentos : '#6c5ce7'}}${CSS}</style></head>
    <body>${paginas.join('')}</body></html>`;
}

export function listaMedicamentos(itens = []) {
  const grupos = { interno: [], externo: [] };
  itens.filter(i => i.medicamento).forEach(i => grupos[i.uso || usoDaVia(i.via)].push(i));
  let n = 0;
  return ['interno', 'externo'].filter(k => grupos[k].length).map(k => `<div class="uso">Uso ${k}</div>` + grupos[k].map(i => `
    <div class="med">
      <div class="linha">${++n}. ${esc(i.medicamento)}${i.concentracao ? ' ' + esc(i.concentracao) : ''}<span class="pont"></span>${esc(i.quantidade || '')}</div>
      <div class="poso">${esc(i.posologia || '')}
        ${i.via ? `<span class="tag"> · via ${esc(i.via.toLowerCase())}</span>` : ''}
        ${i.farmacia && i.farmacia !== 'Veterinária' ? `<span class="tag"> · farmácia ${esc(i.farmacia.toLowerCase())}</span>` : ''}</div>
    </div>`).join('')).join('');
}

// ================= Documentos =================

export function receita({ clinica: c, pet, tutor, vet, itens = [], texto = '', obs = '', data, controle = false }) {
  const meds = listaMedicamentos(itens) || (texto ? `<p>${txt(texto)}</p>` : '<p style="color:#999">Nenhum medicamento prescrito.</p>');
  const corpo = blocoPaciente(pet, tutor) + meds + (obs ? `<h3>Orientações ao tutor</h3><p>${txt(obs)}</p>` : '');
  if (!controle) return documento([pagina({ c, titulo: 'Receituário', corpo, vet, data })], `Receita - ${pet?.nome || ''}`, c);

  const blocoControle = `<div class="controle-grid">
    <div class="caixa"><span class="rot">Identificação do comprador</span>
      Nome: <span class="linha-preencher" style="min-width:75%"></span><br>
      RG: <span class="linha-preencher" style="min-width:35%"></span> Órgão emissor: <span class="linha-preencher" style="min-width:18%"></span><br>
      Endereço: <span class="linha-preencher" style="min-width:70%"></span><br>
      Cidade: <span class="linha-preencher" style="min-width:45%"></span> UF: <span class="linha-preencher" style="min-width:12%"></span><br>
      Telefone: <span class="linha-preencher" style="min-width:60%"></span></div>
    <div class="caixa"><span class="rot">Identificação do fornecedor</span>
      <br><br><br><div style="border-top:1px solid #333;text-align:center;font-size:10px;padding-top:3px">Assinatura do farmacêutico</div>
      Data: ____/____/________</div>
  </div>`;
  return documento(['1ª via · retenção da farmácia', '2ª via · orientação ao tutor'].map(sub =>
    pagina({ c, titulo: 'Receituário de controle especial', sub, corpo: corpo + blocoControle, vet, data })), `Receita controle especial - ${pet?.nome || ''}`, c);
}

export function prontuario({ clinica: c, pet, tutor, vet, atendimento: a }) {
  const vit = [['Peso', a.peso && a.peso + ' kg'], ['Temperatura', a.temperatura && a.temperatura + ' °C'], ['FC', a.fc && a.fc + ' bpm'], ['FR', a.fr && a.fr + ' mpm'],
    ['TPC', a.tpc && a.tpc + ' s'], ['Mucosas', a.mucosas], ['Hidratação', a.hidratacao], ['Escore corporal', a.escore && a.escore + '/9'], ['Dor', a.dor != null && a.dor !== '' ? a.dor + '/10' : ''], ['Estado mental', a.estadoMental]]
    .filter(([, v]) => v);
  const sec = (t, v) => v ? `<h3>${t}</h3><p>${txt(v)}</p>` : '';
  const sis = SISTEMAS.map(([k, l]) => [l, a.exameSistemas?.[k]]).filter(([, s]) => s && (s.status || s.obs));
  const corpo = blocoPaciente(pet, tutor) + `
    <div class="caixa" style="background:#fff"><div class="grid">
      <div><span class="rot">Atendimento</span><span class="val">${esc(a.tipo || 'Consulta')}</span></div>
      <div><span class="rot">Data</span>${fmtDateTime(a.data)}</div>
      <div class="span2"><span class="rot">Médico(a) veterinário(a)</span>${esc(vet?.nome || '')}${vet?.crmv ? ' · CRMV ' + esc(vet.crmv) : ''}</div>
    </div></div>
    ${vit.length ? `<h3>Sinais vitais</h3><div class="vitais">${vit.map(([l, v]) => `<div><span class="rot">${l}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
    ${sec('Queixa principal', a.queixa)}${sec('Histórico / anamnese', a.anamnese)}
    ${[['Alimentação', a.alimentacao], ['Ambiente e contactantes', a.ambiente], ['Medicações em uso', a.medicacoesUso], ['Vacinação / vermifugação', a.vacinacaoEmDia], ['Antecedentes', a.antecedentes]].filter(([, v]) => v).map(([l, v]) => `<p><strong>${l}:</strong> ${txt(v)}</p>`).join('')}
    ${sis.length ? `<h3>Exame físico por sistemas</h3><table class="t"><thead><tr><th style="width:28%">Sistema</th><th style="width:18%">Avaliação</th><th>Observações</th></tr></thead><tbody>
      ${sis.map(([l, s]) => `<tr><td>${l}</td><td>${esc(s.status || '')}</td><td>${esc(s.obs || '')}</td></tr>`).join('')}</tbody></table>` : ''}
    ${sec('Exame físico (observações gerais)', a.exameFisico)}
    ${sec('Diagnóstico presuntivo', a.diagnostico)}${sec('Diagnósticos diferenciais', a.diferenciais)}
    ${a.prognostico ? `<p><strong>Prognóstico:</strong> ${esc(a.prognostico)}</p>` : ''}
    ${sec('Procedimentos realizados', a.procedimentos)}
    ${(a.examesSolicitados?.length || a.exames) ? `<h3>Exames solicitados</h3><p>${esc([...(a.examesSolicitados || []), a.exames].filter(Boolean).join(' · '))}</p>` : ''}
    ${(a.receita?.length || a.prescricao) ? `<h3>Prescrição</h3>${listaMedicamentos(a.receita) || `<p>${txt(a.prescricao)}</p>`}` : ''}
    ${sec('Orientações ao tutor', a.orientacoes || a.receitaObs)}
    ${a.retorno ? `<div class="aviso"><strong>Retorno:</strong> ${fmtDate(a.retorno)}</div>` : ''}`;
  return documento([pagina({ c, titulo: 'Prontuário clínico', sub: `Registro de atendimento · ${fmtDate(a.data?.slice(0, 10))}`, corpo, vet, data: a.data })], `Prontuário - ${pet?.nome || ''}`, c);
}

export const EXAMES = ['Hemograma completo', 'Bioquímico (ALT, FA, ureia, creatinina)', 'Perfil renal', 'Perfil hepático', 'Glicemia', 'Urinálise',
  'Parasitológico de fezes', 'Raio-X', 'Ultrassonografia abdominal', 'Eletrocardiograma', 'Ecocardiograma', 'Citologia',
  'Cultura e antibiograma', 'Teste rápido FIV/FeLV', 'Teste rápido Cinomose/Parvovirose', 'Sorologia Leishmaniose', 'Hemogasometria', 'Histopatológico'];

export function solicitacaoExames({ clinica: c, pet, tutor, vet, exames = [], outros = '', suspeita = '', data }) {
  const todos = [...new Set([...EXAMES, ...exames])];
  const corpo = blocoPaciente(pet, tutor) + `
    <h3>Exames solicitados</h3>
    <div class="checks">${todos.map(e => `<div><span class="box">${exames.includes(e) ? '✓' : ''}</span>${esc(e)}</div>`).join('')}</div>
    ${outros ? `<h3>Outros exames / observações ao laboratório</h3><p>${txt(outros)}</p>` : ''}
    ${suspeita ? `<h3>Suspeita clínica / informações relevantes</h3><p>${txt(suspeita)}</p>` : ''}`;
  return documento([pagina({ c, titulo: 'Solicitação de exames', corpo, vet, data })], `Exames - ${pet?.nome || ''}`, c);
}

export function atestadoSaude({ clinica: c, pet, tutor, vet, finalidade = 'viajar', destino = '', vacinas = [], obs = '', validade = '', data }) {
  const ult = {};
  vacinas.forEach(v => { if (!ult[v.nome] || ult[v.nome].dataAplicacao < v.dataAplicacao) ult[v.nome] = v; });
  const vs = Object.values(ult).sort((a, b) => b.dataAplicacao.localeCompare(a.dataAplicacao));
  const corpo = blocoPaciente(pet, tutor) + `
    <p style="font-size:13.5px;line-height:1.8;text-align:justify;margin:10px 0 14px">Atesto, para os devidos fins, que o animal acima identificado foi por mim examinado nesta data,
    apresentando-se <strong>clinicamente saudável</strong>, sem sinais clínicos de doenças infectocontagiosas e/ou parasitárias,
    estando apto a <strong>${esc(finalidade)}</strong>${destino ? ` com destino a <strong>${esc(destino)}</strong>` : ''}.</p>
    ${vs.length ? `<h3>Vacinas e medicações preventivas</h3><table class="t"><thead><tr><th>Vacina / medicamento</th><th>Aplicação</th><th>Lote / fabricante</th><th>Validade</th></tr></thead><tbody>
      ${vs.map(v => `<tr><td>${esc(v.nome)}</td><td>${fmtDate(v.dataAplicacao)}</td><td>${esc([v.lote, v.fabricante].filter(Boolean).join(' · '))}</td><td>${fmtDate(v.proximaDose)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${obs ? `<h3>Observações</h3><p>${txt(obs)}</p>` : ''}
    ${validade ? `<div class="aviso">Este atestado tem validade de <strong>${esc(validade)}</strong> a partir da data de emissão.</div>` : ''}`;
  return documento([pagina({ c, titulo: 'Atestado de saúde', corpo, vet, data })], `Atestado - ${pet?.nome || ''}`, c);
}

export function termoConsentimento({ clinica: c, pet, tutor = {}, vet, procedimento = '', anestesia = '', riscos = '', valor, data }) {
  const corpo = blocoPaciente(pet, tutor) + `
    <div style="font-size:12.5px;line-height:1.75;text-align:justify">
    <p>Eu, <strong>${esc(tutor.nome || '______________________________')}</strong>, CPF <strong>${esc(tutor.cpf || '______________')}</strong>, na qualidade de tutor(a) responsável pelo animal acima identificado,
    <strong>autorizo</strong> a realização do(s) seguinte(s) procedimento(s): <strong>${esc(procedimento)}</strong>${anestesia && anestesia !== 'Não se aplica' ? `, com uso de <strong>${esc(anestesia.toLowerCase())}</strong>` : ''},
    pela equipe médico-veterinária de ${esc(c.nome)}.</p>
    <p>Declaro ter sido esclarecido(a) sobre os objetivos, benefícios e riscos inerentes ao procedimento e à anestesia, incluindo a possibilidade de
    complicações e, em casos extremos, óbito, bem como sobre os cuidados pré e pós-operatórios necessários, comprometendo-me a segui-los.
    Tive a oportunidade de fazer perguntas, que foram respondidas de forma satisfatória.</p>
    <p>Autorizo ainda a equipe a realizar procedimentos adicionais que se façam necessários em situações de urgência, visando a preservação da vida e do bem-estar do animal.</p>
    ${riscos ? `<p><strong>Riscos específicos informados:</strong> ${txt(riscos)}</p>` : ''}
    ${valor ? `<p><strong>Valor estimado do procedimento:</strong> ${Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, sujeito a alterações em caso de intercorrências.</p>` : ''}
    </div>`;
  return documento([pagina({ c, titulo: 'Termo de consentimento', sub: 'Autorização para procedimento clínico, cirúrgico e/ou anestésico', corpo, vet, tutor, assinaTutor: true, data })], `Termo - ${pet?.nome || ''}`, c);
}

export function carteiraVacinas({ clinica: c, pet, tutor, vacinas = [] }) {
  const vs = [...vacinas].sort((a, b) => (a.dataAplicacao || '').localeCompare(b.dataAplicacao || ''));
  const corpo = blocoPaciente(pet, tutor) + (vs.length ? `<table class="t"><thead><tr><th>Vacina / medicamento</th><th>Dose</th><th>Aplicação</th><th>Lote · fabricante</th><th>Próxima dose</th><th>Aplicado por</th></tr></thead><tbody>
    ${vs.map(v => `<tr><td><strong>${esc(v.nome)}</strong></td><td>${esc(v.dose || '')}</td><td>${fmtDate(v.dataAplicacao)}</td><td>${esc([v.lote, v.fabricante].filter(Boolean).join(' · '))}</td><td>${fmtDate(v.proximaDose)}</td><td>${esc(v.veterinario || '')}</td></tr>`).join('')}
    </tbody></table>` : '<p style="color:#999">Nenhuma vacina registrada.</p>');
  return documento([pagina({ c, titulo: 'Carteira de vacinação', corpo, semAssinatura: true })], `Carteira de vacinação - ${pet?.nome || ''}`, c);
}

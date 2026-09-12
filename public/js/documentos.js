// ================= Emissão de documentos: coleta dados extras, pré-visualiza e imprime =================
import { state, list, where } from './store.js';
import { $, formModal, modal, toast, today } from './ui.js';
import { chamarFuncao, mensagemErroFuncao } from './firebase.js';
import * as D from './docs.js';

export const TIPOS_DOC = {
  receita: { t: 'Receita', i: 'prescription2' },
  receitaControle: { t: 'Receita de controle especial', i: 'file-earmark-lock' },
  prontuario: { t: 'Prontuário completo', i: 'file-earmark-medical' },
  exames: { t: 'Solicitação de exames', i: 'eyedropper' },
  laudo: { t: 'Laudo', i: 'file-earmark-medical' },
  atestado: { t: 'Atestado de saúde', i: 'patch-check' },
  termo: { t: 'Termo de consentimento', i: 'pen' },
  carteira: { t: 'Carteira de vacinação', i: 'shield-check' }
};

// itens de dropdown (Bootstrap) para os documentos informados
export const menuDocs = (tipos, attr = 'data-doc') => tipos.map(k => k === '-' ? '<li><hr class="dropdown-divider"></li>'
  : `<li><button type="button" class="dropdown-item" ${attr}="${k}"><i class="bi bi-${TIPOS_DOC[k].i} me-2 text-primary"></i>${TIPOS_DOC[k].t}</button></li>`).join('');

const vetDe = (a) => a ? { nome: a.vetNome || state.perfil.nome, crmv: a.vetCrmv || (a.vetId === state.user.uid ? state.perfil.crmv : '') }
  : { nome: state.perfil.nome, crmv: state.perfil.crmv };

// Mostra o documento num modal com botão de imprimir / salvar PDF (sem depender de pop-up)
export function previsualizar(html, titulo) {
  const { el } = modal({
    title: `<i class="bi bi-file-earmark-text me-2 text-primary"></i>${titulo}`, size: 'xl',
    body: '<iframe class="doc-frame"></iframe>',
    footer: `<span class="text-muted fs-8 me-auto">Dica: em "Destino" escolha <strong>Salvar como PDF</strong> para enviar por WhatsApp ou e-mail.</span>
      <button class="btn btn-light border" data-bs-dismiss="modal">Fechar</button>
      <button class="btn btn-primary" data-print><i class="bi bi-printer me-1"></i>Imprimir / Salvar PDF</button>`
  });
  const frame = $('iframe', el);
  frame.srcdoc = html;
  $('[data-print]', el).onclick = () => { frame.contentWindow.focus(); frame.contentWindow.print(); };
}

export async function gerarDocumento(tipo, { pet, tutor = {}, atendimento: a } = {}) {
  const c = state.clinica;
  const base = { clinica: c, pet, tutor, vet: vetDe(a), data: a?.data };
  const titulo = `${TIPOS_DOC[tipo].t} · ${pet?.nome || ''}`;
  const vacinasDoPet = () => list('vacinas', where('petId', '==', pet.id));

  try {
    switch (tipo) {
      case 'receita':
      case 'receitaControle':
        if (!a?.receita?.some(i => i.medicamento) && !a?.prescricao) return toast('Este atendimento não tem prescrição. Edite e preencha a aba Receita.', 'warning');
        return previsualizar(D.receita({ ...base, itens: a.receita || [], texto: a.prescricao, obs: a.receitaObs, controle: tipo === 'receitaControle' }), titulo);

      case 'prontuario':
        return previsualizar(D.prontuario({ ...base, atendimento: a }), titulo);

      case 'carteira':
        return previsualizar(D.carteiraVacinas({ ...base, vacinas: await vacinasDoPet() }), titulo);

      case 'exames':
        return formModal({
          title: 'Solicitação de exames', size: 'lg', submit: 'Gerar documento',
          values: { suspeita: a?.diagnostico || '', outros: a?.exames || '' },
          fields: [
            { type: 'custom', col: 'col-12', html: `<label class="form-label">Marque os exames</label><div class="check-grid">${D.EXAMES.map((e, i) => `
              <div class="form-check"><input class="form-check-input" type="checkbox" value="${e}" id="ex${i}" data-exame ${a?.examesSolicitados?.includes(e) ? 'checked' : ''}><label class="form-check-label fs-7" for="ex${i}">${e}</label></div>`).join('')}</div>` },
            { name: 'outros', label: 'Outros exames / observações ao laboratório', type: 'textarea', rows: 2, col: 'col-12' },
            { name: 'suspeita', label: 'Suspeita clínica', type: 'textarea', rows: 2, col: 'col-12' }
          ],
          onSubmit: async (d, form) => {
            const exames = [...form.querySelectorAll('[data-exame]:checked')].map(x => x.value);
            if (!exames.length && !d.outros) throw new Error('Marque ao menos um exame.');
            previsualizar(D.solicitacaoExames({ ...base, ...d, exames, data: today() }), titulo);
          }
        });

      case 'laudo':
        return formModal({
          title: 'Laudo', size: 'lg', submit: 'Gerar laudo',
          values: { tipoExame: a?.tipoLaudo || '' },
          fields: [
            { name: 'tipoExame', label: 'Tipo de exame', type: 'select', required: true, col: 'col-12', options: D.TIPOS_LAUDO },
            { name: 'achados', label: 'Achados', type: 'textarea', rows: 4, required: true, col: 'col-12',
              placeholder: 'Escreva em bullet points soltos (ex.: "nódulo hepático 2cm, bordas irregulares") ou já no formato final — os dois funcionam.' },
            { type: 'custom', col: 'col-12', html: `<button type="button" class="btn btn-sm btn-soft mb-3" id="btnLaudoIA"><i class="bi bi-stars me-1"></i>Gerar laudo completo com IA</button>
              <div class="fs-8 text-muted mb-3">A IA reescreve seus apontamentos e rascunha conclusão e recomendações a partir deles — revise sempre antes de emitir.</div>` },
            { name: 'conclusao', label: 'Conclusão / impressão diagnóstica', type: 'textarea', rows: 2, col: 'col-12' },
            { name: 'recomendacoes', label: 'Recomendações', type: 'textarea', rows: 2, col: 'col-12' }
          ],
          onShown: (el) => {
            const f = $('form', el);
            const btn = $('#btnLaudoIA', el);
            btn.onclick = async () => {
              if (!f.achados.value.trim()) return toast('Escreva ao menos um apontamento antes de pedir a redação com IA.', 'warning');
              btn.disabled = true; const html = btn.innerHTML; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Gerando...';
              try {
                const r = await chamarFuncao('redigirLaudoIA', { tipoExame: f.tipoExame.value, achados: f.achados.value, especie: pet?.especie || '' });
                f.achados.value = r.achados;
                if (r.conclusao) f.conclusao.value = r.conclusao;
                if (r.recomendacoes) f.recomendacoes.value = r.recomendacoes;
                toast('Laudo gerado pela IA — revise achados, conclusão e recomendações antes de emitir.');
              } catch (err) { toast(mensagemErroFuncao(err), 'danger'); }
              finally { btn.disabled = false; btn.innerHTML = html; }
            };
          },
          onSubmit: async (d) => previsualizar(D.laudo({ ...base, ...d, data: today() }), titulo)
        });

      case 'atestado':
        return formModal({
          title: 'Atestado de saúde', size: 'md', submit: 'Gerar atestado',
          values: { finalidade: 'viajar', validade: '10 dias' },
          fields: [
            { name: 'finalidade', label: 'Apto a', type: 'select', required: true, col: 'col-12', options: ['viajar', 'realizar transporte aéreo', 'hospedagem em hotel/creche', 'participar de exposição/evento', 'realizar banho e tosa', 'doação/adoção', 'realizar procedimento cirúrgico eletivo'] },
            { name: 'destino', label: 'Destino (se viagem)', col: 'col-md-8', placeholder: 'Ex.: Florianópolis/SC' },
            { name: 'validade', label: 'Validade', type: 'select', col: 'col-md-4', options: ['5 dias', '10 dias', '30 dias'] },
            { name: 'obs', label: 'Observações', type: 'textarea', rows: 2, col: 'col-12' }
          ],
          onSubmit: async (d) => previsualizar(D.atestadoSaude({ ...base, ...d, vacinas: await vacinasDoPet(), data: today() }), titulo)
        });

      case 'termo':
        return formModal({
          title: 'Termo de consentimento', size: 'md', submit: 'Gerar termo',
          values: { procedimento: a?.procedimentos || '' },
          fields: [
            { name: 'procedimento', label: 'Procedimento(s)', required: true, col: 'col-12', placeholder: 'Ex.: Orquiectomia eletiva, profilaxia dentária...' },
            { name: 'anestesia', label: 'Anestesia', type: 'select', col: 'col-md-6', options: ['Anestesia geral inalatória', 'Anestesia geral injetável', 'Sedação', 'Anestesia local', 'Não se aplica'] },
            { name: 'valor', label: 'Valor estimado', type: 'money', col: 'col-md-6' },
            { name: 'riscos', label: 'Riscos específicos informados ao tutor', type: 'textarea', rows: 3, col: 'col-12' }
          ],
          onSubmit: async (d) => previsualizar(D.termoConsentimento({ ...base, ...d, data: today() }), titulo)
        });
    }
  } catch (e) { console.error(e); toast(e.message, 'danger'); }
}

// ================= Dados fiscais compartilhados (produtos, PDV, dados de exemplo) =================
// Sugestões de NCM mais comuns para petshop. A classificação final deve ser confirmada com o contador.
export const NCM_SUGERIDO = {
  'Ração': '23091000', 'Petiscos': '23091000', 'Medicamentos': '30049099', 'Farmácia': '30049099',
  'Higiene': '33051000', 'Acessórios': '42010090', 'Brinquedos': '95030099'
};

export const NCM_LISTA = [
  ['23091000', 'Alimentos para cães e gatos (ração, petiscos)'], ['30049099', 'Medicamentos'], ['33051000', 'Xampus'],
  ['42010090', 'Coleiras, guias e artigos para animais'], ['95030099', 'Brinquedos'], ['25081000', 'Areia sanitária (bentonita)'],
  ['94049000', 'Caminhas e almofadas']
];

export const soDigitos = (s) => String(s || '').replace(/\D/g, '');
export const fmtNcm = (s) => soDigitos(s).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
export const descricaoNcm = (ncm) => NCM_LISTA.find(([c]) => c === soDigitos(ncm))?.[1] || '';

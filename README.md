# 🐾 Petzy

> Gestão completa para clínicas veterinárias e petshops.

[![Status](https://img.shields.io/badge/status-online-2ea44f?style=flat-square)](https://petzy-c8609.web.app)
[![Firebase](https://img.shields.io/badge/Firebase-hosting--first-ffca28?style=flat-square&logo=firebase&logoColor=1a1a1a)](https://firebase.google.com/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES_modules-f7df1e?style=flat-square&logo=javascript&logoColor=1a1a1a)](https://developer.mozilla.org/docs/Web/JavaScript/Guide/Modules)
[![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3-7952b3?style=flat-square&logo=bootstrap&logoColor=white)](https://getbootstrap.com/)

[Acessar o Petzy](https://petzy-c8609.web.app) · teste grátis por 14 dias

O Petzy é um SaaS multi-clínica para centralizar atendimento, operação e cobrança em um só lugar. Cada clínica possui seus próprios dados, usuários, permissões e licença de uso.

## Visão geral

- **Atendimento:** agenda, tutores, pets, prontuários, vacinas e internação.
- **Operação:** PDV (inclusive offline), produtos, serviços, estoque com validade/lote e documentos (com laudo gerado por IA).
- **Relacionamento:** portal do tutor, agendamento público (sem precisar ser cliente) e central de marketing.
- **Gestão:** financeiro, relatórios, BI avançado, auditoria, configurações e indicadores do dashboard.
- **Rede:** agrupamento de múltiplas unidades com resumo consolidado, mantendo tutores/pets/prontuários isolados por clínica.
- **SaaS:** planos (com recursos exclusivos por plano), período de teste, assinaturas, pagamentos PIX e painel administrativo com login próprio.

## Recursos

| Módulo | Principais recursos |
| --- | --- |
| Dashboard | KPIs com tendência mês a mês, receita x despesas, agenda do dia, vacinas a vencer, estoque baixo/vencendo e checklist de primeiros passos |
| Agenda | Visão semanal, profissionais, conflitos, status, WhatsApp, faturamento e painel de pedidos vindos do portal/agendamento público |
| Tutores | Cadastro, busca de endereço por CEP, máscaras, exportação para CSV e reativação de clientes inativos (segmentação + WhatsApp) |
| Pets | Ficha, foto, alergias, histórico clínico, vacinas e agendamentos |
| Prontuários | Sinais vitais, anamnese, diagnóstico, prescrição, anexos (exames/fotos) e impressão |
| Vacinas | Carteira, cálculo de reforço, atrasados e lembretes por WhatsApp |
| Internação | Controle de leitos, prescrição médica e evolução clínica por horário, com alta |
| PDV | Produtos e serviços, código de barras (com busca automática de dados do produto), troco, fiado, cupom, estoque e funcionamento **offline** (fila de sincronização) |
| Produtos e serviços | Catálogo, margem, estoque mínimo, validade/lote com alerta de vencimento e código sequencial automático para serviços |
| Financeiro | Contas a pagar e receber, recorrência, baixas e fluxo mensal |
| Fiscal | Emissão de NFS-e, NFC-e e NF-e (TecnoSpeed/PlugNotas) — veja a seção dedicada abaixo |
| Documentos | Receita, prontuário, solicitação de exames, atestado, termo, carteira de vacinação e **laudo gerado com IA** |
| Relatórios | Receita diária, ticket médio, faltas, itens mais vendidos, melhores clientes, comissão por profissional e DRE/CSV para o contador |
| Marketing 🔒 Profissional+ | Segmentos (aniversariantes, inativos, fiado em aberto, vacina vencendo) com campanhas via WhatsApp e histórico |
| BI Avançado 🔒 Premium | Clientes ativos por mês, valor vitalício (LTV) por tutor e previsão de ruptura de estoque |
| Auditoria | Registro imutável de quem criou/editou/excluiu cada informação |
| Rede | Resumo consolidado (receita, lucro, tendência) entre as unidades de uma mesma rede |
| Portal do tutor | Login por telefone + CPF; tutor vê histórico, vacinas e pede horário (com grade de horários reais) |
| Agendamento público | Página sem login para quem ainda não é cliente pedir um horário, com grade de horários da agenda |
| Assinatura | Plano, validade, pagamentos PIX ou link e histórico de faturas |
| Painel administrativo | Login próprio (`admin-login.html`), clínicas, MRR, confirmações de pagamento, bloqueios e dados legais (Termos/Privacidade) |

## Stack

- HTML, CSS e JavaScript moderno com módulos ES.
- Bootstrap 5 e Bootstrap Icons via CDN.
- Firebase Authentication, Firestore, Hosting, Storage Rules e Cloud Functions (2ª geração, `southamerica-east1`).
- Firebase CLI para desenvolvimento local e publicação.
- Integrações externas via Cloud Functions (chave nunca exposta ao navegador): TecnoSpeed/PlugNotas (nota fiscal), Groq (laudo com IA, nível gratuito), Open Food Facts e Cosmos Bluesoft (busca de produto por código de barras), Siscomex/Receita Federal (tabela de NCM).

Não há etapa de build: o diretório `public/` é servido diretamente pelo Firebase Hosting.

## Estrutura do projeto

```text
petzy/
├── firebase.json             # Hosting, Firestore, Storage, Functions e emuladores
├── firestore.rules           # isolamento por clínica, licença e imutabilidade da auditoria
├── firestore.indexes.json    # índices compostos do Firestore
├── storage.rules             # regras do Storage
├── functions/
│    └── index.js             # Cloud Functions: fiscal, NCM, portal, agendamento público, rede,
│                              #   laudo com IA (Groq) e busca de produto por EAN (com cache)
└── public/
     ├── index.html            # landing page
     ├── login.html            # login e cadastro da clínica
     ├── admin-login.html      # login exclusivo do painel SaaS (não cria/entra em clínica)
     ├── app.html              # painel principal (SPA)
     ├── admin.html            # painel do dono do SaaS
     ├── pagar.html            # página pública de cobrança PIX
     ├── portal.html           # portal do tutor (login por telefone + CPF)
     ├── agendar.html          # agendamento online público (sem precisar ser cliente)
     ├── termos.html           # Termos de Uso (dados preenchidos via admin.html)
     ├── privacidade.html      # Política de Privacidade (LGPD)
     ├── assets/               # estilos e imagens
     └── js/
          ├── config.js         # configuração pública do Firebase
          ├── firebase.js       # inicialização do SDK
          ├── store.js          # dados, sessão, permissões, planos e módulos premium
          ├── ui.js             # componentes e utilitários de interface
          ├── pix.js            # BR Code, PIX copia e cola e QR Code
          ├── docs.js           # geração de documentos (inclui laudo)
          ├── documentos.js     # fluxo de documentos da clínica (inclui laudo com IA)
          ├── ncm.js            # cache local (IndexedDB) e busca da tabela de NCM
          ├── fiscalDados.js    # tabelas/constantes fiscais (NCM sugerido, CFOP, CSOSN)
          ├── app.js            # menu, roteamento, licença e bloqueio por plano
          └── pages/             # telas do painel (inclui marketing.js, bi.js, auditoria.js,
                                  #   internacao.js, rede.js)
```

## Pré-requisitos

- Node.js e npm, para instalar a Firebase CLI.
- Uma conta no Firebase com acesso ao projeto.
- Um servidor HTTP local. Abrir os arquivos diretamente no navegador não funciona porque o app usa módulos ES.

## Configuração do Firebase

No [Console do Firebase](https://console.firebase.google.com/project/petzy-c8609):

1. Em **Authentication > Sign-in method**, ative **E-mail/senha** e **Google**.
2. Em **Authentication > Settings > Authorized domains**, confirme `localhost` e os domínios de produção.
3. Crie o Firestore em modo produção, preferencialmente na região `southamerica-east1`.
4. Instale a CLI e autentique-se:

    ```bash
    npm install -g firebase-tools
    firebase login
    ```

5. Publique regras e índices:

    ```bash
    firebase deploy --only firestore,storage
    ```

As credenciais web em `public/js/config.js` são públicas por design. O isolamento e a proteção dos dados devem ser mantidos nas regras do Firestore e do Storage.

## Desenvolvimento local

Para servir o frontend com o Firebase Hosting:

```bash
firebase serve --only hosting
```

A aplicação ficará disponível em `http://localhost:5000`.

Alternativas para testar apenas o frontend:

```bash
npx serve public
```

Também é possível usar a extensão **Live Server** do VS Code abrindo `public/index.html`.

### Emuladores do Firebase

O projeto já possui portas configuradas para Auth, Firestore, Storage e Hosting. Para iniciar os emuladores:

```bash
firebase emulators:start
```

## Publicação

Depois de validar localmente:

```bash
firebase deploy
```

O ambiente publicado está em [petzy-c8609.web.app](https://petzy-c8609.web.app).

## Integração fiscal (TecnoSpeed / PlugNotas)

A emissão de **NFS-e** roda nas Cloud Functions (`functions/index.js`, região `southamerica-east1`). O navegador nunca vê a API key e nunca monta o documento fiscal: o servidor lê a nota no Firestore e usa sempre o CNPJ da clínica logada.

| Função | O que faz |
|---|---|
| `emitirNotaFiscal` | Monta a NFS-e, NFC-e ou NF-e a partir da nota, valida e transmite (trava contra clique duplo e contra duas notas para a mesma venda) |
| `consultarNotaFiscal` | Consulta a autorização e arquiva PDF e XML no Storage da clínica |
| `cancelarNotaFiscal` | Solicita o cancelamento com motivo e justificativa |
| `linkArquivoNotaFiscal` | Gera o link de download do PDF/XML, conferindo a permissão no servidor |
| `verificarEmpresaFiscal` | Diz se o CNPJ está cadastrado na TecnoSpeed e quais documentos (NFS-e/NFC-e/NF-e) ela emite em produção ou homologação |
| `configurarTokenTecnoSpeed` | Somente o **superadmin**: valida e grava o token da plataforma no Secret Manager |
| `metaTabelaNcm` / `baixarTabelaNcm` | Tabela de NCM oficial (Receita Federal/Siscomex) usada na NF-e e na NFC-e — veja abaixo |

**Ambientes** (em Configurações › Dados › Integração fiscal):

- **Teste, sem valor fiscal:** usa o sandbox público da PlugNotas com a empresa de demonstração. Serve para conhecer o fluxo completo (número, PDF e XML) sem certificado.
- **Homologação:** envia à prefeitura em ambiente de testes. Exige a empresa cadastrada na TecnoSpeed com o certificado A1.
- **Produção:** notas com valor fiscal. Há uma trava: se o Petzy estiver em homologação mas a empresa estiver em produção na TecnoSpeed, a emissão é bloqueada.

**Token da plataforma:** o superadmin configura em `admin.html` › Integração fiscal. O valor é lido na hora (versão `latest` do segredo), então a troca não exige novo deploy. Também dá para gravar pelo terminal com `firebase functions:secrets:set TECNOSPEED_API_KEY`.

**NFC-e (venda de produto no PDV)** e **NF-e** também são emitidas pelo Petzy, desde que cada produto tenha NCM, CFOP e CSOSN/CST preenchidos (em Produtos & Serviços, ou completados na hora, direto do PDV, quando falta algum). Qualquer nota pode gerar um **recibo sem valor fiscal**.

> Notas transmitidas só podem ser alteradas pelo backend. As regras do Firestore bloqueiam edição e exclusão pelo app, e elas não entram na limpeza de dados, porque têm guarda obrigatória.

### Tabela de NCM

A classificação fiscal dos produtos usa a tabela oficial do Siscomex/Receita Federal (~10 mil códigos). Como o download não libera CORS para o navegador, o fluxo é:

1. Em **Configurações › Dados › Tabela de NCM**, o administrador clica em **"Atualizar tabela de NCM"**.
2. A função `baixarTabelaNcm` busca a tabela na fonte oficial, filtra os códigos completos (8 dígitos) e enriquece cada um com o texto da posição/subposição (muitos códigos-folha têm descrição genérica, como "Outros" — o contexto útil está um nível acima na hierarquia). O resultado fica em cache no Storage e no Firestore (`sistema/ncmMeta`) por 24h, para não sobrecarregar o Siscomex a cada clínica.
3. O navegador salva a tabela completa no **IndexedDB** (`public/js/ncm.js`) e passa a buscar localmente, sem rede.
4. A busca (no cadastro de produto e na janela rápida do PDV) casa por código ou por palavras da descrição, com fronteira de palavra (evita, por exemplo, achar "trela" dentro de "anis-**estrela**do") e um pequeno dicionário de sinônimos para termos de petshop que divergem da nomenclatura aduaneira oficial (ex.: "ração" → "alimento", "coleira" → "trela").

### Busca de produto por código de barras (EAN)

Em Produtos & Serviços, o botão **"Buscar dados pelo código de barras"** tenta, nessa ordem: a **Open Food Facts** (base mundial gratuita, sem token, forte em marcas grandes) e, se não encontrar, a **Cosmos Bluesoft** (base nacional, gratuita com token, melhor cobertura de marca brasileira de petshop). Todo código **encontrado** fica salvo em `eanCache/{codigo}` no Firestore: a próxima busca do mesmo código, de qualquer clínica, é servida do cache em vez de gastar cota da API externa. O token da Cosmos é lido do Secret Manager (`firebase functions:secrets:set COSMOS_API_KEY`) e nunca chega ao navegador. Serviços não têm código de barras real — o botão equivalente lá é **"Gerar código automático"**, que olha os códigos já usados nos outros serviços e sugere o próximo da sequência.

### Laudo com IA

Em Prontuários, o documento **Laudo** tem um botão **"Gerar laudo completo com IA"**: o veterinário escreve os achados em bullet points soltos e a IA (Groq, modelo `openai/gpt-oss-120b`, nível gratuito) devolve os achados reescritos em linguagem técnica formal, mais uma conclusão e recomendações coerentes com o que foi informado — sem inventar achado novo. É sempre um rascunho: o texto volta editável para revisão antes de virar documento oficial. O token fica no Secret Manager (`firebase functions:secrets:set GROQ_API_KEY`).

### Portal do tutor e agendamento público

- **Portal do tutor** (`portal.html?c={clinicaId}`): o tutor entra com telefone + CPF (comparação tolerante a formatação — últimos 8 dígitos do telefone, e dispensa o CPF quando o cadastro não tem esse campo preenchido) e vê pets, vacinas, histórico e pode pedir um horário numa grade com os horários realmente livres da agenda da clínica.
- **Agendamento público** (`agendar.html?c={clinicaId}`): a mesma grade de horários, mas sem exigir login — para quem ainda não é cliente. O pedido cai na mesma fila (`solicitacoesPortal`) e aparece no painel da Agenda para a equipe confirmar o cadastro.
- Nenhuma dessas páginas cria usuário em `/usuarios` nem toca nas regras do Firestore diretamente — toda a lógica é mediada por Cloud Functions com o Admin SDK (`portalLogin`, `portalDados`, `portalSolicitarAgendamento`, `agendamentoPublicoHorarios`, `agendamentoPublicoSolicitar`, `portalInfo`), o que preserva o isolamento entre clínicas.

### Módulos premium por plano

`Marketing` (a partir do plano Profissional) e `BI Avançado` (só Premium) ficam visíveis no menu para **todas** as clínicas — quem está num plano inferior vê uma tela de chamada para upgrade em vez do conteúdo, o que ajuda a vender o plano mais caro em vez de simplesmente esconder a funcionalidade. O nível exigido por módulo está em `MODULOS_PREMIUM`, em `public/js/store.js`; o bloqueio é aplicado no roteador (`public/js/app.js`), independente das permissões por função de usuário.

### Auditoria e Rede

- **Auditoria**: toda criação/edição/exclusão feita pelo app grava uma linha em `clinicas/{cid}/auditoria` (`public/js/store.js`). As regras do Firestore tornam esse registro **imutável** — nem o admin da clínica pode alterar ou apagar depois. Atenção ao editar `firestore.rules`: um bloco de regra mais específico **não substitui** o bloco genérico catch-all que também bate no mesmo caminho — os dois se combinam com OR — por isso toda coleção com regra própria mais restritiva também precisa entrar na lista de exclusão do bloco genérico.
- **Rede**: o superadmin agrupa clínicas atribuindo o mesmo `redeId` (em `admin.html`; só ele pode alterar esse campo). A função `redeResumo` devolve receita, lucro e tendência agregados entre as unidades da rede — nunca dados operacionais (tutores, pets, prontuários), que continuam isolados por clínica.

## Licenciamento e cobrança

- Novas clínicas começam com **14 dias de teste grátis** (`status: trial`).
- A validade fica em `clinicas/{id}.validoAteMs`.
- Quando a licença vence ou a clínica é bloqueada, as regras impedem novas gravações; os dados continuam disponíveis em modo somente leitura.
- Apenas o superadmin pode alterar o plano ou a validade da clínica.
- Planos e preços são definidos em `PLANOS`, no arquivo `public/js/store.js`.

### Configurar o superadmin

1. Crie uma conta normalmente em `login.html`.
2. Copie o UID em **Authentication > Users**, no Console do Firebase.
3. Crie em `superadmins` um documento cujo ID seja esse UID. O conteúdo pode ser, por exemplo, `{ "nome": "Administrador" }`.
4. Acesse `admin-login.html` (login exclusivo do painel SaaS — diferente do `login.html` da equipe/clínica, nunca cria clínica nem pede esses dados; quem entra ali sem ser superadmin é deslogado na hora).

No painel administrativo, configure a chave PIX, o WhatsApp de suporte e os links de pagamento de cada plano em **Formas de pagamento**.

O fluxo de cobrança é:

1. A clínica escolhe um plano e um período de 1, 3, 6 ou 12 meses em **Assinatura**.
2. O pagamento pode ser feito por QR Code PIX, PIX copia e cola ou link de cartão/boleto.
3. Ao clicar em **Já paguei**, a clínica cria uma solicitação.
4. O superadmin confirma o pagamento em `admin.html`, renova a licença e registra a fatura.

O botão **Cobrar** gera um QR Code PIX e um link público em `pagar.html`. A confirmação hoje é manual (o superadmin confere e libera em `admin.html`); ligar um gateway com webhook (Mercado Pago, Asaas, Stripe) para liberar a licença automaticamente é uma evolução natural, já que o projeto já roda em Cloud Functions/plano Blaze.

## Termos de Uso e Privacidade

O cadastro de nova clínica exige aceite (checkbox obrigatório) dos **Termos de Uso** (`termos.html`) e da **Política de Privacidade** (`privacidade.html`); a data do aceite fica registrada no próprio documento da clínica (`clinicas/{id}.termosAceitosEm`) como evidência. Os dados legais (razão social, CNPJ/CPF, endereço, foro, e-mail de contato, prazos de retenção e de aviso de reajuste) são preenchidos pelo superadmin em `admin.html` › **Dados legais** e ficam em `sistema/legal` — leitura pública (as duas páginas abrem sem login), escrita só do superadmin. Ambas as páginas são um modelo inicial; revisão por um(a) advogado(a) é recomendada antes de tratar como definitivo.

## Decisões importantes

- Fotos de pets são redimensionadas no navegador e salvas no documento para manter o payload pequeno.
- O cadastro de membros da equipe usa uma instância secundária do Firebase Auth para manter o administrador conectado.
- A segurança real está nas regras do Firestore e do Storage, não na ocultação da configuração web.
- O PDV usa cache local persistente do Firestore (`persistentLocalCache`): funciona offline, e gravações feitas sem internet entram na fila e sincronizam sozinhas ao reconectar. Um bloco de regra mais específico não substitui um bloco genérico que também bate no mesmo caminho no `firestore.rules` — veja a nota em Auditoria e Rede acima antes de adicionar uma coleção com regra própria mais restritiva.

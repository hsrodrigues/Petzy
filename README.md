# 🐾 Petzy

> Gestão completa para clínicas veterinárias e petshops.

[![Status](https://img.shields.io/badge/status-online-2ea44f?style=flat-square)](https://petzy-c8609.web.app)
[![Firebase](https://img.shields.io/badge/Firebase-hosting--first-ffca28?style=flat-square&logo=firebase&logoColor=1a1a1a)](https://firebase.google.com/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES_modules-f7df1e?style=flat-square&logo=javascript&logoColor=1a1a1a)](https://developer.mozilla.org/docs/Web/JavaScript/Guide/Modules)
[![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3-7952b3?style=flat-square&logo=bootstrap&logoColor=white)](https://getbootstrap.com/)

[Acessar o Petzy](https://petzy-c8609.web.app) · teste grátis por 14 dias

O Petzy é um SaaS multi-clínica para centralizar atendimento, operação e cobrança em um só lugar. Cada clínica possui seus próprios dados, usuários, permissões e licença de uso.

## Visão geral

- **Atendimento:** agenda, tutores, pets, prontuários e vacinas.
- **Operação:** PDV, produtos, serviços, estoque e documentos.
- **Gestão:** financeiro, relatórios, configurações e indicadores do dashboard.
- **SaaS:** planos, período de teste, assinaturas, pagamentos PIX e painel administrativo.

## Recursos

| Módulo | Principais recursos |
| --- | --- |
| Dashboard | KPIs, receita x despesas, agenda do dia, vacinas a vencer e estoque baixo |
| Agenda | Visão semanal, profissionais, conflitos, status, WhatsApp e faturamento |
| Tutores | Cadastro, busca de endereço por CEP, máscaras e exportação para CSV |
| Pets | Ficha, foto, alergias, histórico clínico, vacinas e agendamentos |
| Prontuários | Sinais vitais, anamnese, diagnóstico, prescrição e impressão |
| Vacinas | Carteira, cálculo de reforço, atrasados e lembretes por WhatsApp |
| PDV | Produtos e serviços, código de barras, troco, fiado, cupom e estoque |
| Produtos e serviços | Catálogo, margem, estoque mínimo e movimentações |
| Financeiro | Contas a pagar e receber, recorrência, baixas e fluxo mensal |
| Relatórios | Receita diária, ticket médio, faltas, itens mais vendidos e clientes |
| Documentos | Geração e organização de documentos operacionais da clínica |
| Assinatura | Plano, validade, pagamentos PIX ou link e histórico de faturas |
| Painel administrativo | Clínicas, MRR, confirmações de pagamento e bloqueios |

## Stack

- HTML, CSS e JavaScript moderno com módulos ES.
- Bootstrap 5 e Bootstrap Icons via CDN.
- Firebase Authentication, Firestore, Hosting e Storage Rules.
- Firebase CLI para desenvolvimento local e publicação.

Não há etapa de build: o diretório `public/` é servido diretamente pelo Firebase Hosting.

## Estrutura do projeto

```text
petzy/
├── firebase.json             # Hosting, Firestore, Storage e emuladores
├── firestore.rules           # isolamento por clínica e regras de licença
├── firestore.indexes.json    # índices compostos do Firestore
├── storage.rules             # regras do Storage
└── public/
     ├── index.html            # landing page
     ├── login.html            # login e cadastro da clínica
     ├── app.html              # painel principal (SPA)
     ├── admin.html            # painel do dono do SaaS
     ├── pagar.html            # página pública de cobrança PIX
     ├── assets/               # estilos e imagens
     └── js/
          ├── config.js         # configuração pública do Firebase
          ├── firebase.js       # inicialização do SDK
          ├── store.js          # dados, sessão, permissões e planos
          ├── ui.js             # componentes e utilitários de interface
          ├── pix.js            # BR Code, PIX copia e cola e QR Code
          ├── docs.js           # geração de documentos
          ├── documentos.js     # fluxo de documentos da clínica
          ├── app.js            # menu, roteamento e licença
          └── pages/             # telas do painel
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

## Integração fiscal TecnoSpeed

O backend da integração fica em `functions/` e nunca expõe a API key no navegador. Depois de criar a conta PlugNotas/TecnoSpeed e configurar a clínica em **Configurações > Dados > Integração fiscal**, defina o segredo diretamente no terminal:

```bash
firebase functions:secrets:set TECNOSPEED_API_KEY
firebase deploy --only functions
```

A função `enviarDocumentoTecnoSpeed` aceita `nfe`, `nfce` e `nfse`, encaminhando o payload para a API PlugNotas. O certificado digital, o cadastro da empresa e os campos tributários devem estar configurados no ambiente TecnoSpeed. Para homologação, use as credenciais e o ambiente de testes fornecidos pelo provedor.

> Nunca coloque a API key, o certificado A1 ou a senha no `public/`, no Firestore ou no código do navegador. A emissão só deve ser liberada depois de validar o payload e as regras fiscais com o contador.

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
4. Acesse `admin.html`.

No painel administrativo, configure a chave PIX, o WhatsApp de suporte e os links de pagamento de cada plano em **Formas de pagamento**.

O fluxo de cobrança é:

1. A clínica escolhe um plano e um período de 1, 3, 6 ou 12 meses em **Assinatura**.
2. O pagamento pode ser feito por QR Code PIX, PIX copia e cola ou link de cartão/boleto.
3. Ao clicar em **Já paguei**, a clínica cria uma solicitação.
4. O superadmin confirma o pagamento em `admin.html`, renova a licença e registra a fatura.

O botão **Cobrar** gera um QR Code PIX e um link público em `pagar.html`. A confirmação automática por webhook é uma evolução futura que exige Cloud Functions e o plano Blaze do Firebase.

## Decisões importantes

- Fotos de pets são redimensionadas no navegador e salvas no documento para manter o projeto compatível com o plano Spark.
- O cadastro de membros da equipe usa uma instância secundária do Firebase Auth para manter o administrador conectado.
- A segurança real está nas regras do Firestore e do Storage, não na ocultação da configuração web.

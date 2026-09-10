# 🐾 Petzy

**🌐 Acesse: [petzy-c8609.web.app](https://petzy-c8609.web.app)** · teste grátis por 14 dias

SaaS para **clínicas veterinárias e petshops**, feito com HTML, CSS, JavaScript puro, Bootstrap 5 e Firebase (Authentication e Firestore). É multi-clínica: cada clínica que se cadastra tem os dados isolados das demais e paga uma **licença mensal**.

## Módulos

| Módulo | O que faz |
|---|---|
| Dashboard | KPIs do dia, receitas x despesas, agenda de hoje, vacinas a vencer, estoque baixo, aniversariantes |
| Agenda | Visão semanal, filtro por profissional, conflito de horário, status, confirmação por WhatsApp, faturamento ao concluir |
| Tutores | Cadastro com busca de endereço por CEP (ViaCEP), máscaras, exportação para CSV |
| Pets | Ficha com foto, alertas de alergia, histórico clínico, vacinas e agendamentos |
| Prontuários | Sinais vitais, anamnese, diagnóstico, prescrição, impressão de receita e prontuário |
| Vacinas | Carteira de vacinação, cálculo do reforço, lista de atrasados, lembrete por WhatsApp |
| PDV | Venda de produtos e serviços, leitor de código de barras, troco, fiado, cupom, baixa de estoque |
| Produtos & Serviços | Catálogo, margem, estoque mínimo, movimentações de entrada, saída e ajuste |
| Financeiro | Contas a pagar e a receber, recorrência, baixa, fluxo mensal |
| Relatórios | Receita por dia, ticket médio, taxa de faltas, top itens, melhores clientes |
| Configurações | Dados da clínica, horário da agenda, equipe com funções, dados de demonstração |
| Assinatura | Plano atual, validade, pagamento por PIX ou link, histórico de faturas |
| Painel SaaS (`admin.html`) | Só para o dono do Petzy: todas as clínicas, MRR, confirmação de pagamentos, bloqueio |

## Estrutura

```
vetflow/
├── firebase.json             # Hosting + Firestore + Storage
├── .firebaserc               # projeto petzy-c8609
├── firestore.rules           # segurança multi-clínica + licença
├── firestore.indexes.json
├── storage.rules
└── public/
    ├── index.html            # landing page
    ├── login.html            # login (e-mail/senha e Google) + cadastro da clínica
    ├── app.html              # painel (SPA com rotas por hash)
    ├── admin.html            # painel do dono do SaaS
    ├── pagar.html            # página pública de pagamento (QR Code PIX)
    ├── assets/css/style.css
    └── js/
        ├── config.js         # credenciais web do Firebase
        ├── firebase.js       # SDK v10 via CDN
        ├── store.js          # dados, sessão, permissões, planos e licença
        ├── ui.js             # modais, formulários, toasts, máscaras, formatação
        ├── pix.js            # PIX copia e cola (BR Code) + QR Code
        ├── app.js            # menu, roteador, barra de licença
        └── pages/*.js        # uma tela por arquivo
```

## Configuração do Firebase (uma única vez)

No [Console do Firebase](https://console.firebase.google.com/project/petzy-c8609):

1. **Authentication > Sign-in method**: ative **E-mail/senha** e **Google**.
2. **Authentication > Settings > Authorized domains**: confira se `localhost` está na lista. Quando publicar, o domínio `petzy-c8609.web.app` já entra automaticamente.
3. **Firestore Database**: crie o banco no modo **produção** (região `southamerica-east1`, São Paulo).
4. Publique as regras e os índices:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore
   ```

## Rodar localmente

Os módulos ES precisam de um servidor HTTP. Abrir o arquivo direto no navegador não funciona. Use uma destas opções:

```bash
firebase serve --only hosting     # http://localhost:5000
# ou
npx serve public
# ou a extensão "Live Server" do VS Code, abrindo public/index.html
```

## Publicar

```bash
firebase deploy                   # hosting + regras
```

O sistema fica em **https://petzy-c8609.web.app**.

## Licença mensal (como funciona)

- Toda clínica nova começa em **teste grátis de 14 dias** (`status: trial`).
- A validade fica em `clinicas/{id}.validoAteMs`. **As regras do Firestore bloqueiam gravações** quando a licença vence ou a clínica é bloqueada. Os dados continuam visíveis em modo somente leitura.
- A clínica **não consegue alterar** o próprio plano ou a validade. Só o superadmin consegue.
- Planos e preços ficam em `PLANOS`, no arquivo `public/js/store.js`. Esse é o único lugar a editar, e a landing page, o app e o painel usam esses valores.

### Tornar-se superadmin (dono do SaaS)

1. Crie sua conta normalmente em `login.html`.
2. No Console, em **Authentication > Users**, copie o seu **UID**.
3. No **Firestore**, crie a coleção `superadmins` com um documento cujo ID é o seu UID. O conteúdo pode ser qualquer um, por exemplo `{ "nome": "Hudson" }`.
4. Acesse `admin.html`. Aparece também um atalho no menu do usuário.

No painel, clique em **Formas de pagamento** para cadastrar a chave PIX, o WhatsApp de suporte e os links de pagamento recorrente de cada plano (Mercado Pago, Asaas, Stripe...).

### Fluxo de cobrança

1. A clínica vai em **Assinatura**, escolhe o plano e o período (1, 3, 6 ou 12 meses) e paga pelo **QR Code PIX** gerado com o valor exato, pelo **PIX copia e cola** ou pelo link de cartão/boleto.
2. Ela clica em **"Já paguei"**, e isso cria um documento em `solicitacoes`.
3. Você confirma no `admin.html`. A licença é renovada e a fatura entra no histórico da clínica.

Você também pode cobrar ativamente. No `admin.html`, o botão **Cobrar** de cada clínica gera o QR Code PIX e um **link de pagamento** (`pagar.html`) para enviar pelo WhatsApp. A página do link é pública e funciona sem login.

O QR Code segue o padrão BR Code do Banco Central (PIX estático com valor) e é gerado no navegador, sem taxa de intermediário. Configure em **Formas de pagamento** a chave PIX, o nome do favorecido (até 25 caracteres) e a cidade (até 15).

> **Próximo passo opcional:** automatizar a confirmação com webhook (Cloud Functions + Mercado Pago ou Asaas). Isso exige o plano **Blaze** do Firebase.

## Observações

- As fotos dos pets são redimensionadas no navegador e salvas no próprio documento. Assim o sistema funciona no **plano gratuito (Spark)**, sem precisar do Cloud Storage.
- Para adicionar um membro da equipe, o app usa uma instância secundária do Firebase Auth, e o admin continua logado.
- A `apiKey` web do Firebase é pública por design. A segurança real está no `firestore.rules`.

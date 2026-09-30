# Teste do Miaou (provador virtual) numa loja real

Roteiro para instalar e validar o app numa loja Nuvemshop de verdade (loja de demonstração do
Portal de Parceiros ou uma loja sua). Siga na ordem.

## 1. Servidor

1. Hospede o projeto com **HTTPS** (Render, Railway, Fly.io ou VPS com Docker):
   ```bash
   docker build -t miaou .
   docker run -p 3000:3000 -v miaou-data:/data --env-file .env miaou
   ```
2. Preencha o `.env` (modelo em `.env.example`):
   - `APP_URL`: endereço público do servidor, com https e sem barra no fim.
   - `NUVEMSHOP_APP_ID`, `NUVEMSHOP_CLIENT_SECRET`, `NUVEMSHOP_CONTACT_EMAIL`: do Portal de Parceiros.
   - `SESSION_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `DATABASE_PATH=/data/provador.db` (no Docker) e `DEV_MODE=false`.
   - `NUVEMSHOP_SCRIPT_ID` e `NUVEMSHOP_SCRIPT_ID_THANKYOU`: preencha depois do passo 2.

## 2. Portal de Parceiros

1. **App**: URL de redirecionamento `https://SEU_DOMINIO/auth/callback`; permissões
   `read_products`, `write_scripts`, `read_orders`.
2. **Script da vitrine**: gere o arquivo com o endereço do seu servidor:
   ```bash
   APP_URL=https://SEU_DOMINIO npm run build:script     # cria dist/loader.js
   ```
   - Script 1: envie `dist/loader.js`, location **store**, evento **onfirstinteraction**,
     não auto-instalável. Publique e copie o id para `NUVEMSHOP_SCRIPT_ID`.
   - Script 2: o **mesmo** `dist/loader.js`, location **página de obrigado** (thank you page).
     Publique e copie o id para `NUVEMSHOP_SCRIPT_ID_THANKYOU`.
3. **Webhooks de LGPD**: `…/webhooks/lgpd/store-redact`, `…/customers-redact`,
   `…/customers-data-request`.
4. Reinicie o servidor com os ids dos scripts no `.env`.

## 3. Plano da loja de teste

Sem plano o botão não aparece. Enquanto a cobrança não estiver ligada:
```bash
node scripts/set-plan.js <id da loja> essencial
```

## 4. Checklist na loja

Marque cada item. Se algo falhar, anote a tela, o aparelho e o navegador.

### Instalação e painel
- [ ] Instalar o app abre o painel (*Visão geral*) com o nome da loja.
- [ ] *Preferências › Instalação na loja* mostra "Instalado".
- [ ] *Produtos*: os produtos aparecem; óculos são reconhecidos pelo nome ("Automático (Óculos)").
- [ ] *Planos*: mostra o plano ativo e o uso do mês.

### Página do produto (celular e computador)
- [ ] Abaixo das variações aparece o botão **Provar virtualmente**, legível no tema da loja.
- [ ] **Loja com domínio próprio** (www.sualoja.com.br): o provador abre e o X fecha. (É o teste
      mais importante: se falhar, abra o painel do app uma vez e tente de novo.)
- [ ] Produto sem foto: o botão não aparece.

### Provador
- [ ] Celular: o card sobe de baixo; arrastar para baixo fecha. Computador: painel lateral.
- [ ] Celular: "Tirar foto" abre a câmera traseira (óculos: "Tirar selfie", câmera frontal).
      Computador: só "Escolher foto".
- [ ] A prova sai em cerca de 20 s, com o rosto e o fundo iguais aos da foto enviada.
- [ ] Óculos: sai com a pessoa inteira na foto (não só o rosto).
- [ ] 2ª prova: pede o WhatsApp (se estiver ligado em Preferências) e o número aparece em *Leads*.
- [ ] Compartilhar: o link abre a prévia com "Provar em mim" e "Ver produto na loja".
- [ ] "Comprar" fecha o provador e adiciona à sacola (ou leva até os tamanhos).
- [ ] "Apagar agora" remove as provas do histórico.

### Vendas
- [ ] Prove um produto, feche o provador, escolha o tamanho pela página e pague o pedido. Em
      alguns minutos, *Visão geral › Vendas com o provador* sobe 1.
- [ ] Faça outro pedido **sem** provar: ele **não** conta.

### Limites conhecidos
- Venda feita em outro aparelho (provou no celular e comprou no computador) não é ligada ao provador.
- A página de obrigado precisa estar no mesmo endereço da loja para informar o pedido.
- Textos só em português (lançamento pensado para o Brasil).

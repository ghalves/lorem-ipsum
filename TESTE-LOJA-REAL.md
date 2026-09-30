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
2. **Script da vitrine (NubeSDK)**: o instalador já gera `dist/miaou-nube.js` com o endereço do
   servidor (ou `APP_URL=https://SEU_DOMINIO npm run build:script`).
   - Crie o script como **NubeSDK**, envie `dist/miaou-nube.js`, não auto-instalável, ativo na
     vitrine e no checkout. Publique e copie o id para `NUVEMSHOP_SCRIPT_ID`.
   - O script da página de obrigado não é mais necessário.
3. **Webhooks de LGPD**: `…/webhooks/lgpd/store-redact`, `…/customers-redact`,
   `…/customers-data-request`.
4. Reinicie o servidor com o id do script no `.env` (`sudo miaou reiniciar`).

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
- [ ] Antes do botão Comprar aparece o botão **Provar virtualmente**, legível no tema da loja.
- [ ] **Loja com domínio próprio** (www.sualoja.com.br): o provador abre e o X fecha. (É o teste
      mais importante: se falhar, abra o painel do app uma vez e tente de novo.)
- [ ] Produto sem foto: o botão não aparece.

### Provador
- [ ] Celular: o provador abre numa janela (modal). Computador: gaveta lateral. O X fecha nos dois.
- [ ] **Enviar foto** funciona dentro da janela (teste novo com o NubeSDK: se falhar, anote o aparelho).
- [ ] Celular: "Tirar foto" abre a câmera traseira (óculos: "Tirar selfie", câmera frontal).
      Computador: só "Escolher foto".
- [ ] A prova sai em cerca de 20 s, com o rosto e o fundo iguais aos da foto enviada.
- [ ] Óculos: sai com a pessoa inteira na foto (não só o rosto).
- [ ] 2ª prova: pede o WhatsApp (se estiver ligado em Preferências) e o número aparece em *Leads*.
- [ ] Compartilhar: o link abre a prévia com "Provar em mim" e "Ver produto na loja".
- [ ] "Comprar" fecha o provador. Produto com uma só variação: vai para a sacola. Com tamanhos:
      aparece o aviso "Escolha o tamanho e toque em Comprar".
- [ ] "Apagar agora" remove as provas do histórico.

### Vendas
- [ ] Prove um produto, feche o provador, escolha o tamanho pela página e pague o pedido. Em
      alguns minutos, *Visão geral › Vendas com o provador* sobe 1.
- [ ] Faça outro pedido **sem** provar: ele **não** conta.
- [ ] Pedido pago por boleto dias depois: ainda conta (o vínculo vai gravado no pedido).

### Limites conhecidos
- Venda feita em outro aparelho (provou no celular e comprou no computador) não é ligada ao provador.
- Textos só em português (lançamento pensado para o Brasil).

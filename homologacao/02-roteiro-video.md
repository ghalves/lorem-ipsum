# Miaou · Provador virtual — Roteiro do vídeo de demonstração

**Formato sugerido:** um único vídeo de 6 a 9 minutos, gravado na tela do computador, com áudio narrando (ou legendas). Enviar como link do YouTube **não listado** ou do Google Drive com acesso "qualquer pessoa com o link". As cenas 5 e 6 podem usar o celular (gravação de tela do aparelho), inseridas no mesmo vídeo.

**Antes de gravar**

- Use uma loja de demonstração do Portal de Parceiros com **pelo menos 3 produtos com foto**: uma blusa ou vestido, uma calça e um par de óculos.
- O Miaou deve estar **desinstalado** nessa loja no começo da gravação.
- Deixe pronta uma foto de corpo inteiro (para roupas) e uma selfie (para óculos).
- Assim que instalar o app na cena 1, ative o plano da loja de teste no servidor (`sudo miaou plano <id da loja> crescer`). Corte essa parte da gravação. Sem plano, o botão não aparece na loja.
- Abra o servidor sem `TRYON_DEBUG` ligado e com a chave do OpenRouter (provas reais, não simuladas).

---

## Cena 1 · Instalação pela Loja de Aplicativos Nuvemshop (lojista sem conta no Miaou) — ~1 min

1. Com o admin da loja aberto, digite na barra de endereço `https://www.tiendanube.com/apps/[APP_ID]/authorize` (link oficial que a Nuvemshop pede para simular a instalação pela loja de apps). **Não instale pelo painel de parceiros.**
2. Se pedir, entre com a conta da loja.
3. Mostre a tela de permissões (ler produtos, ler pedidos, criar scripts) e clique em **Aceitar e começar a usar**.
4. O navegador abre o painel do Miaou já na **Visão geral**, com o nome da loja.

**Narração:** "O Miaou não tem cadastro separado: a conta é criada automaticamente na instalação, a partir da própria loja Nuvemshop. Não pedimos URL da loja, e-mail ou senha. Na instalação o Miaou cadastra os webhooks, ativa o script da vitrine e importa os produtos."

## Cena 2 · Login (lojista que já tem conta) — ~40 s

1. Feche a aba do painel.
2. No admin da Nuvemshop, vá em **Meus aplicativos** e abra o Miaou.
3. O painel abre direto, sem senha.
4. (Opcional) Abra o endereço do painel numa aba anônima: aparece "Sessão expirada. Abra o app novamente pelo painel da sua loja Nuvemshop".

**Narração:** "O login é sempre pela Nuvemshop: abrir o app pelo admin autentica o lojista de novo. Não existe senha do Miaou para recuperar; o acesso segue a conta Nuvemshop."

## Cena 3 · Painel e configuração — ~1 min 30 s

**Narração:** "Não há nenhuma configuração técnica: o botão entra sozinho na loja, sem código e sem mexer no layout. O lojista só escolhe o plano."

1. **Planos:** mostre os planos (Essencial R$ 97, Crescer R$ 197, Escalar R$ 497, Volume), o plano ativo com o uso do mês e o botão **Falar com a Miaou**.
   **Narração:** "Para assinar, o lojista escolhe o plano e clica em Falar com a Miaou. Enviamos um link de pagamento do Asaas e, com o pagamento confirmado, ativamos o plano em até 24 horas. Nesta loja de demonstração o plano já está ativo."
2. **Produtos:** os produtos importados, com o tipo reconhecido (roupa ou óculos) e a opção de mudar ou desligar por produto.
3. **Preferências:** liga/desliga o provador, texto do botão, pedido de WhatsApp, limite por comprador, status "Instalado" do script na loja e e-mail de suporte.
4. **Leads:** a lista (vazia ou com dados) e a exportação CSV.

## Cena 4 · Uso na loja pelo comprador (computador) — ~2 min

1. Abra a loja numa aba e entre na página de uma blusa.
2. Mostre o botão **Provar em mim** abaixo do **Comprar**.
3. Clique: o provador abre como gaveta lateral. Envie a foto de corpo inteiro.
4. Mostre a barra de progresso e o resultado (~20 s).
5. Clique em **Comprar** no provador: o produto vai para a sacola com a variação escolhida.
6. Finalize um pedido de teste e marque como **pago** no admin.
7. De volta ao painel, em **Visão geral**, mostre a venda contabilizada em "Vendas com o provador" (pode levar alguns minutos).

## Cena 4b · Produto alterado no admin (webhook) — ~40 s

1. No admin da Nuvemshop, mude o nome de um produto (ou crie um produto novo com foto).
2. No painel do Miaou, abra **Produtos**: a alteração aparece sozinha em alguns segundos.

**Narração:** "O Miaou não consulta a API periodicamente: a Nuvemshop avisa por webhook e o app busca só o produto alterado. O mesmo vale para pedidos pagos."

## Cena 5 · Uso no celular — ~1 min

1. Abra a página dos **óculos** no celular.
2. Toque em **Provar em mim**: o provador abre em janela (modal).
3. Toque em **Tirar selfie** e mostre o resultado.
4. Mostre o **Compartilhar** (link com prévia) e o **Apagar agora**.

## Cena 6 · Desinstalação — ~40 s

1. No admin, em **Meus aplicativos**, desinstale o Miaou.
2. Recarregue a página do produto na loja: o botão **não aparece mais**.
3. Recarregue o painel do Miaou que estava aberto: ele mostra "Sessão expirada" (o acesso fecha na hora).

## Cena 7 · Reinstalação — ~40 s

1. Instale o Miaou de novo pela Loja de aplicativos e aceite as permissões.
2. O painel abre com o **histórico e as preferências preservados**.
3. Recarregue a página do produto: o botão voltou.

**Narração final:** "Ao reinstalar, o Miaou pega um novo token, cadastra de novo webhooks e scripts e reimporta o catálogo. Os dados da loja só são apagados quando a Nuvemshop envia o webhook de LGPD store/redact. Os três webhooks de LGPD do diagrama são disparados pela própria Nuvemshop e por isso não aparecem no vídeo."

---

### Checklist rápido do vídeo

- [ ] Instalação pelo link `tiendanube.com/apps/[APP_ID]/authorize`, não pelo painel de parceiros (tela de permissões aparece)
- [ ] Conta criada automaticamente (lojista sem conta)
- [ ] Login pelo admin (lojista com conta) e sessão expirada
- [ ] Planos e assinatura visíveis no painel
- [ ] Funcionalidade principal na loja: computador e celular, roupa e óculos
- [ ] Compra e venda atribuída
- [ ] Produto alterado no admin chega ao Miaou (webhook)
- [ ] Dito em voz alta: nenhuma configuração técnica é necessária
- [ ] Desinstalação: botão some e painel fecha
- [ ] Reinstalação: tudo volta

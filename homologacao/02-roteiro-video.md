# Miaou · Roteiro do vídeo de homologação (versão enxuta)

**Duração:** 4 a 5 minutos, tudo no computador, numa gravação de tela só. Narração é opcional: dá para gravar sem áudio.
**Envio:** YouTube **não listado** ou Google Drive com "qualquer pessoa com o link".

## Antes de gravar

- Loja: https://lojademo317.lojavirtualnuvem.com.br/ (admin em https://lojademo317.lojavirtualnuvem.com.br/admin).
- Comece com o Miaou **desinstalado** na loja.
- Deixe pronta uma foto sua (ou de alguém que autorizou) para a prova da Polo.
- Assim que instalar na cena 1, libere a loja no servidor (`sudo miaou plano <id da loja> crescer`) e **corte essa parte** da gravação.
- **Não abra a aba Planos.**
- Na desinstalação (cena 5), a Nuvemshop pede na hora a exclusão dos dados da loja (LGPD): o dashboard volta zerado na cena 6, mas o plano continua e o botão volta sozinho. Grave a venda (cena 3) **antes** da desinstalação.

---

## Cena 1 · Instalação pela Nuvemshop (lojista sem conta) (~40 s)

1. Com o admin aberto, digite na barra de endereço: `https://www.tiendanube.com/apps/44305/authorize`
2. Mostre a tela de permissões e clique em **Aceitar e começar a usar**.
3. O painel do Miaou abre sozinho, com o nome da loja.

> Legenda/narração: "Não há cadastro separado: a conta é criada automaticamente na instalação."

## Cena 2 · Login (lojista que já tem conta) (~20 s)

1. Feche a aba do painel.
2. No admin, vá em **Meus aplicativos** e abra o **Miaou**: o painel abre direto, sem senha.

> "O login é sempre pelo admin da Nuvemshop."

## Cena 3 · Uso na loja e compra (~2 min)

1. Abra a página da **Polo Tricot** e mostre o botão **Provar em mim**.
2. Clique, envie a foto e mostre o resultado.
3. Clique em **Comprar** no provador: a Polo vai para a sacola.
4. Finalize o pedido.
5. No admin, abra o pedido e marque como **pago**.
6. No painel do Miaou, em **Visão geral**, mostre a venda em "Vendas com o provador" (pode levar alguns minutos; corte a espera).

> "A venda só conta quando a Nuvemshop confirma o pagamento e o produto provado está no pedido."

## Cena 4 · Produto alterado no admin (~30 s)

1. No admin, mude o nome da **CALÇA BLAIR UVA** (por exemplo, para "Calça Blair Uva Wide Leg") e salve.
2. No painel do Miaou, abra **Produtos**: o nome novo já aparece.

> "O Miaou não consulta a API o tempo todo: a Nuvemshop avisa por webhook."

## Cena 5 · Desinstalação (~30 s)

1. Em **Meus aplicativos**, desinstale o Miaou.
2. Recarregue a página da Polo na loja: o botão **sumiu**.

## Cena 6 · Reinstalação (~40 s)

1. Abra de novo `https://www.tiendanube.com/apps/44305/authorize` e aceite as permissões.
2. O dashboard abre de novo, **zerado**: na desinstalação a Nuvemshop pede para apagar os dados da loja (LGPD) e o Miaou apaga. O plano continua valendo.
3. Recarregue a página da Polo: o botão **voltou**.

> "Na desinstalação, a Nuvemshop pede a exclusão dos dados da loja e o Miaou apaga tudo, menos o plano contratado. Ao reinstalar, o provador volta a funcionar sem nova configuração."

---

## Checklist

- [ ] Instalação pelo link `/apps/44305/authorize`, com a tela de permissões
- [ ] Conta criada sozinha (lojista sem conta)
- [ ] Login pelo admin (lojista com conta)
- [ ] Prova na loja e compra pelo provador
- [ ] Pedido pago contando como venda no painel
- [ ] Produto alterado no admin aparecendo no Miaou
- [ ] Desinstalação: botão some
- [ ] Reinstalação: dashboard abre (zerado) e o botão volta
- [ ] Aba Planos não aparece

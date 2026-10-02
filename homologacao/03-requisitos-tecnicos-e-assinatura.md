# Miaou · Provador virtual — Requisitos técnicos e assinatura

## 1. Resumo técnico

| Item | Detalhe |
| --- | --- |
| Tipo de app | Externo (painel próprio em `https://app.miaou.com.br/admin`) + scripts **NubeSDK** na vitrine e no checkout |
| Autenticação | OAuth 2 da Nuvemshop (Authorization Code). URL de redirecionamento: `https://app.miaou.com.br/auth/callback` |
| Cadastro / login | Não há cadastro separado. A conta é criada automaticamente na instalação e o login acontece sempre ao abrir o app pelo admin Nuvemshop. Nunca pedimos URL da loja, e-mail ou senha |
| Escopos | `read_products`, `read_orders`, `write_scripts` |
| API | REST `2025-03`, com User-Agent identificado e nova tentativa em respostas 429 |
| Scripts | 1 script NubeSDK em dois locais de ativação: **Store** (botão e provador na página de produto) e **Checkout** (liga o pedido aos produtos provados). Não são auto-instaláveis: o app os associa à loja pela API na instalação |
| Webhooks da loja | `product/created`, `product/updated`, `product/deleted`, `order/paid`, `app/uninstalled`, todos validados por HMAC (`x-linkedstore-hmac-sha256`), com resposta 200 imediata |
| Webhooks LGPD | `store/redact`, `customers/redact`, `customers/data_request` |
| Privacidade | Política para o comprador em `https://app.miaou.com.br/privacidade/` |

### Por que cada escopo

| Escopo | Uso | Chamadas |
| --- | --- | --- |
| `read_products` | Ler nome, fotos, variações e categorias dos produtos para gerar a prova e saber se a peça é roupa ou óculos | `GET /products`, `GET /products/{id}`, webhooks `product/*` |
| `read_orders` | Confirmar que um produto provado foi comprado e pago, para mostrar ao lojista as vendas com o provador | `GET /orders/{id}`, webhook `order/paid` |
| `write_scripts` | Ativar o botão "Provar em mim" na loja e o script do checkout | `POST /scripts`, `GET /scripts` |

O app **não altera** produtos, pedidos, clientes nem preços.

### Instalação, desinstalação e reinstalação

- **Instalação:** troca o `code` pelo `access_token`, lê os dados da loja (`GET /store`), cadastra os webhooks, associa os scripts e importa o catálogo em segundo plano. O lojista cai direto no painel.
- **Desinstalação:** ao receber `app/uninstalled`, o Miaou apaga o token, invalida as sessões do painel na hora e o botão deixa de aparecer na loja.
- **Reinstalação:** um novo token é salvo, webhooks, scripts e produtos são configurados de novo e o histórico e as preferências da loja são preservados. Os dados só são apagados com o webhook `store/redact`.

### Uso eficiente da API

- **Sem consultas periódicas.** Mudanças em produtos e pedidos chegam por webhook, e o app busca só o item avisado (`GET /products/{id}`, `GET /orders/{id}`).
- **Catálogo completo só na instalação** (`GET /products`, 200 por página). Depois disso, só quando o lojista clica em "Sincronizar produtos" no painel.
- **Dados da loja** (`GET /store`, para saber os domínios): na instalação, quando o lojista abre o painel (no máximo a cada 30 s) e quando o provador abre num domínio ainda não conhecido (no máximo a cada 10 min).
- **Nenhuma escrita em produtos, estoque, preços, pedidos ou clientes.** As únicas escritas acontecem na instalação: o cadastro dos webhooks que ainda não existem e a associação dos scripts.
- **Limite de requisições:** a resposta 429 é respeitada com espera e até 4 novas tentativas.
- Os webhooks respondem 200 na hora e processam em segundo plano.

### Configuração técnica pelo lojista

Nenhuma. O botão entra sozinho na página de produto em qualquer layout, sem código. O lojista só escolhe o plano e, se quiser, ajusta o texto do botão e as preferências no painel.

## 2. Planos e assinatura

| Plano | Preço mensal | Provas por mês |
| --- | --- | --- |
| Essencial | R$ 97 | 150 |
| Crescer | R$ 197 | 400 |
| Escalar | R$ 497 | 1.200 (pode remover a marca Miaou do provador) |
| Volume | de R$ 997 a R$ 2.997 | de 2.500 a 10.000 |

- Não há teste grátis nem cobrança por prova extra. A cota renova no dia 1º de cada mês.
- O painel avisa quando 80% da cota é usada. Quando a cota acaba, o botão sai da loja até a renovação, sem cobrança adicional.
- Sem plano ativo, o app fica instalado mas o botão não aparece na loja; o painel mostra "Escolha um plano para o provador aparecer na loja".
- Erros de geração não contam na cota. Uma mesma foto no mesmo produto devolve a prova já feita, sem gastar cota.
- Proteções da cota: até 10 provas por comprador por dia (ajustável pelo lojista) e 20 por IP por dia.

**Como a assinatura é contratada hoje:** o lojista escolhe o plano na aba **Planos** do painel e fala com a Miaou pelo botão "Falar com a Miaou" (`suporte@miaou.com.br`). A equipe Miaou ativa o plano da loja.

## 3. Acesso para a equipe de homologação

Como o botão só aparece com um plano ativo, oferecemos duas formas de validar o app sem passar pela contratação:

1. **Loja de demonstração já configurada** com o Miaou instalado e o plano **Crescer** ativo:
   - URL da loja: `[PREENCHER]`
   - Acesso ao admin: `[PREENCHER usuário/senha ou convidar a equipe como usuário]`
   - Produtos para testar: `[PREENCHER: 1 roupa, 1 calça, 1 óculos]`
2. **Loja de teste de vocês:** depois de instalar o Miaou, enviem o ID da loja para `suporte@miaou.com.br` (ou respondam este e-mail) e ativamos o plano **Crescer** sem custo em até `[PREENCHER: prazo, ex.: 2 horas úteis]`.

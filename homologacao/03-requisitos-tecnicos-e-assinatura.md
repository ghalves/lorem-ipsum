# Miaou · Provador virtual — Requisitos técnicos e assinatura

## 1. Resumo técnico

| Item | Detalhe |
| --- | --- |
| Tipo de app | Externo (painel próprio em `https://app.miaou.com.br/dashboard`) + scripts **NubeSDK** na vitrine e no checkout |
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
- **Desinstalação:** ao receber `app/uninstalled`, o Miaou confirma que o token foi revogado (`GET /store`; se ainda funciona, o aviso chegou depois de uma reinstalação e é ignorado), apaga o token, invalida as sessões do painel na hora e o botão deixa de aparecer na loja.
- **Abrir o app pelo admin:** o Miaou confere webhooks e scripts (`GET /webhooks`, `GET /scripts`) e recria só o que faltar.
- **Reinstalação:** um novo token é salvo, webhooks, scripts e produtos são configurados de novo e o histórico e as preferências da loja são preservados. Os dados só são apagados com o webhook `store/redact`.

### Uso eficiente da API

- **Sem consultas periódicas.** Mudanças em produtos e pedidos chegam por webhook, e o app busca só o item avisado (`GET /products/{id}`, `GET /orders/{id}`).
- **Catálogo completo só na instalação** (`GET /products`, 200 por página). Depois disso, só quando o lojista clica em "Sincronizar produtos" no painel.
- **Dados da loja** (`GET /store`, para saber os domínios): na instalação, quando o lojista abre o painel (no máximo a cada 30 s) e quando o provador abre num domínio ainda não conhecido (no máximo a cada 10 min).
- **Nenhuma escrita em produtos, estoque, preços, pedidos ou clientes.** As únicas escritas acontecem na instalação: o cadastro dos webhooks que ainda não existem e a associação dos scripts.
- **Limite de requisições:** a resposta 429 é respeitada com espera e até 4 novas tentativas.
- Os webhooks respondem 200 na hora e processam em segundo plano.

### Configuração técnica pelo lojista

Nenhuma. O botão entra sozinho na página de produto em qualquer layout, sem código. Depois que a Miaou libera a loja, o lojista só ajusta, se quiser, o texto do botão e as preferências no painel.

## 2. Contratação e liberação da loja

O Miaou é pago. No portal, o app está como **Grátis, com vendas no aplicativo**: a contratação é feita direto com a Miaou, fora da Nuvemshop, sem usar a API de cobrança da plataforma.

1. O lojista instala o Miaou pela Loja de Aplicativos.
2. No painel, clica em **Falar com a Miaou**, que abre um e-mail para `suporte@miaou.com.br` já com o ID da loja.
3. A Miaou combina a contratação com o lojista e libera o provador na loja em até 24 horas.
4. Até a liberação, o app fica instalado, mas o botão não aparece na loja.

## 3. Acesso para a equipe de homologação

Como o botão só aparece com a loja liberada, oferecemos duas formas de validar o app sem passar pela contratação:

1. **Loja de demonstração já configurada** com o Miaou instalado e já liberado:
   - URL da loja: https://lojademo317.lojavirtualnuvem.com.br/
   - Acesso ao admin: e-mail e senha enviados no e-mail de resposta
   - Produtos para testar:
     - [CALÇA BLAIR UVA](https://lojademo317.lojavirtualnuvem.com.br/produtos/calca-blair-uva-jl5do/) (roupa, parte de baixo)
     - [Polo Tricot](https://lojademo317.lojavirtualnuvem.com.br/produtos/polo-tricot-1pogy/) (roupa, parte de cima)
     - [Óculos de Grau Michael Kors MK4103U - Preto](https://lojademo317.lojavirtualnuvem.com.br/produtos/oculos-de-grau-michael-kors-mk4103u-preto-1iteq/) (óculos)
2. **Loja de teste de vocês:** depois de instalar o Miaou, enviem o ID da loja para `suporte@miaou.com.br` (ou respondam este e-mail) e liberamos o provador sem custo em até 24 horas.

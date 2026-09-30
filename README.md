# Miaou: provador virtual para Nuvemshop

O comprador envia uma foto e vê a peça (ou os óculos) no corpo dele em cerca de
20 segundos, direto na página do produto. O lojista acompanha no painel quem
provou, quem comprou e quais produtos puxam as vendas.

## Rodar localmente (5 minutos)

Precisa de **Node 22.5 ou mais novo**.

```bash
npm install
npm run dev                 # DEV_MODE=true, sem .env: tudo em http://localhost:3000
```

- **Painel da loja demo:** http://localhost:3000 (entra direto)
- **Loja de demonstração:** http://localhost:3000/dev/ (abra um produto e clique em *Provar virtualmente*)
- **Sem chave, as provas são simuladas:** a "prova" devolve a própria foto depois de alguns segundos
  (serve para testar o fluxo e o painel).
- **Provas reais:** crie um `.env` só com `OPENROUTER_API_KEY=...`. Não copie o `.env.example`
  inteiro: ele é o modelo de **produção** e aponta o app para um domínio que não existe.
- **Teste real do recorte e da colagem:** `OPENROUTER_API_KEY=... npm run teste-real` gera, em
  `teste-real/`, um quadro *foto original · imagem da IA · resultado final* para cada foto de exemplo.
- **Testes automáticos:** `npm test`.

## Como funciona

| Parte | Onde | O que faz |
| --- | --- | --- |
| Botão na loja | `public/storefront/loader.js` | "Provar virtualmente" na página de produto; `?provar=1` abre direto (link compartilhado). Na página de obrigado, informa os produtos provados |
| Tela do provador | `public/tryon/` | Card que sobe de baixo (celular, arrastar fecha) e painel lateral (desktop) |
| API do provador | `src/routes/tryon.js` | Sessão, foto, prova, histórico, joinha, compartilhar, WhatsApp, "apagar agora" |
| Geração | `src/tryon/service.js`, `provider.js` | **Roupas e óculos:** Muse (US$ 0,01) começa na hora; se falhar ou passar de 30 s sem responder, o Nano Banana 2 (US$ 0,068) dispara em paralelo e vale a primeira imagem |
| Recorte e colagem | `src/tryon/image.js` (sharp) | A foto é analisada no envio (rosto, olhos e corpo, `gemini-3.1-flash-lite`, 1× por foto). A imagem gerada é registrada contra a original (escala + deslocamento, correlação normalizada): o Muse às vezes dá zoom de 10% a 15%. Se o zoom cortar a pessoa, entrega a imagem da IA como veio. **Roupa:** depois de alinhada e só a área do corpo vem da IA; **rosto e fundo originais** voltam (borda suave, correção de cor). **Óculos:** a IA recebe só a cabeça e só a faixa dos olhos às orelhas volta para a foto. Se a IA mudou o enquadramento, entrega a imagem da IA como está. ~0,2 s |
| Prompts | `src/tryon/prompt.js` | Pedido afirmativo + descrição automática da peça (1× por foto de produto) + "Preserve everything else…", com variações para vestido, parte de cima, parte de baixo e óculos |
| Link compartilhado | `src/routes/share.js` | `/s/:id`: prévia no WhatsApp/Instagram, "Provar em mim" e "Ver produto na loja" |
| Painel | `public/admin/` | *Visão geral* (números, gráfico diário, funil do botão à compra, compartilhamentos, produtos), *Produtos*, *Leads*, *Planos* e *Preferências* |

**Como a espera é disfarçada:** a foto é reduzida no navegador (1024 px) e a prova começa assim
que ela é escolhida; abrir o provador já prepara a descrição e a foto do produto; a barra corre
rápido no começo e desacelera, com frases por etapa e dicas; a foto fica guardada 24 h, então a
segunda peça pula o envio; e a reserva aos 30 s corta a cauda lenta.

**Venda com o provador:** quando a prova fica pronta, o navegador guarda (7 dias) que aquele
produto foi provado. A página de obrigado manda o número do pedido; a venda conta quando a
Nuvemshop confirma o pagamento e o produto provado está no pedido, em qualquer tamanho, tenha o
comprador clicado em "Comprar" no provador ou não.

**Planos** (`src/tryon/plans.js`): Essencial R$ 97 (150 provas/mês), Crescer R$ 197 (400) e
Escalar R$ 497 (1.200). Acima disso, o **Volume**: uma barra com degraus fixos, de 2.500 provas
(R$ 997) a 10.000 (R$ 2.997), e o preço por prova sempre cai de um degrau para o outro. Escalar e
Volume podem remover a marca Miaou do provador. Sem teste grátis e sem provas extras. Aos 80% o
painel avisa; com a cota no fim, o botão sai da loja até o dia 1º. Enquanto a cobrança não estiver
ligada, o plano é definido pelo operador: `sudo miaou plano <loja> crescer` no servidor, ou
`node scripts/set-plan.js <loja> crescer` (ou `volume-4000`, `none`...).

**Proteção da cota:** cada comprador faz no máximo 10 provas por dia (o lojista ajusta em
*Preferências*) e cada IP, 20 por dia em cada loja (`TRYON_IP_DAILY_LIMIT`). A mesma foto no mesmo
produto devolve a prova já feita, sem gastar cota. Erros não contam.

**WhatsApp:** só celular brasileiro com DDD existente; números com cara de inventados (repetidos,
sequências, blocos iguais) são recusados, e um mesmo número libera no máximo 3 aparelhos em 30 dias.

**Marca e suporte:** o rodapé do provador e do link compartilhado mostra "Provador virtual por
Miaou" com link para `MIAOU_SITE_URL`. O e-mail de suporte (`MIAOU_SUPPORT_EMAIL`) aparece em
*Preferências* e no botão "Falar com a Miaou".

## Publicar na Nuvemshop

1. **Crie o app** em [partners.nuvemshop.com.br](https://partners.nuvemshop.com.br).
   - URL de redirecionamento: `https://SEU_DOMINIO/auth/callback`
   - Permissões: `read_products`, `write_scripts`, `read_orders`
   - Copie o *App ID* e o *Client Secret* para o `.env`.
2. **Suba o servidor** com HTTPS. No servidor Ubuntu com WordOps (veja *Servidor* abaixo):
   `sudo ./scripts/instalar.sh`. Com Docker:
   `docker build -t miaou . && docker run -p 3000:3000 -v miaou-data:/data --env-file .env miaou`
3. **Cadastre o script da vitrine** no portal (app > Scripts > Criar script):
   - Gere o arquivo: `APP_URL=https://SEU_DOMINIO npm run build:script` → `dist/loader.js`
   - Location `store` · evento `onfirstinteraction` · **não** auto-instalável. Publique e copie o id
     para `NUVEMSHOP_SCRIPT_ID`.
   - Um segundo script com o **mesmo** arquivo, location **página de obrigado**; id em
     `NUVEMSHOP_SCRIPT_ID_THANKYOU`. É ele que liga o pedido pago ao provador.
4. **Webhooks de LGPD** (portal > app > Webhooks obrigatórios):
   - store/redact → `https://SEU_DOMINIO/webhooks/lgpd/store-redact`
   - customers/redact → `https://SEU_DOMINIO/webhooks/lgpd/customers-redact`
   - customers/data_request → `https://SEU_DOMINIO/webhooks/lgpd/customers-data-request`
5. **Teste numa loja real** seguindo `TESTE-LOJA-REAL.md`.

## Servidor (Ubuntu + WordOps)

Primeira vez (o site do nginx aponta para a porta do app):
```bash
sudo wo site create miaou.com.br --proxy=127.0.0.1:3009 --le --force
```

Instalar e atualizar (sempre igual):
```bash
# no Mac: zip com a pasta miaou/ dentro
git archive --prefix=miaou/ -o miaou.zip HEAD
scp miaou.zip ubuntu@SERVIDOR:/tmp/

# no servidor
rm -rf /tmp/cm && unzip -q -o /tmp/miaou.zip -d /tmp/cm
sudo rsync -a /tmp/cm/miaou/ /var/www/miaou.com.br/htdocs/
cd /var/www/miaou.com.br/htdocs
sudo ./scripts/instalar.sh
```

O `instalar.sh`:
- usa o Node do sistema se for 22.13 ou mais novo; senão baixa um Node 22 só para o Miaou em
  `/opt/miaou-node` (os outros projetos continuam no Node deles);
- na primeira vez cria `/var/www/miaou.com.br/miaou.env` (com `SESSION_SECRET` gerado) e para,
  pedindo os dados da Nuvemshop; preencha e rode de novo;
- guarda banco, fotos e provas em `/var/www/miaou.com.br/data`, fora do `htdocs`, então o `rsync`
  nunca apaga dados;
- instala o serviço `miaou` (systemd, usuário `www-data`, reinicia sozinho), gera `dist/loader.js`
  e confere se o nginx repassa o IP do comprador (sem isso o limite por IP trava a loja);
- instala o comando `sudo miaou` (`plano`, `logs`, `status`, `reiniciar`, `backup`) e um backup
  diário do banco em `/var/www/miaou.com.br/backup` (14 dias).

## Privacidade e LGPD

- O comprador é um código aleatório do navegador; não pedimos nome nem e-mail.
- Fotos somem em 24 h, provas e links em 7 dias; depois de 30 dias a prova vira só estatística.
  "Apagar agora" no provador remove tudo na hora.
- O WhatsApp é pedido a partir da 2ª prova (configurável) e fica em *Leads*. Os webhooks de LGPD
  da Nuvemshop apagam ou informam esse número quando trazem o telefone do cliente.
- A página `/privacidade/` explica isso ao comprador.

## Segurança

- Em produção o servidor **não sobe** sem `SESSION_SECRET`, `NUVEMSHOP_CLIENT_SECRET` e
  `NUVEMSHOP_CONTACT_EMAIL`.
- O painel usa token assinado (HMAC) com validade de 12 h; a instalação valida o `state` do OAuth;
  os webhooks validam o HMAC da Nuvemshop; os eventos da vitrine exigem um token emitido junto da
  configuração.
- Cada prova sai **assinada** pelo servidor. A página de obrigado só liga um pedido ao provador
  com essa assinatura e se o aviso chegar entre 10 minutos antes e 48 h depois da criação do pedido.
- Ao desinstalar, o token de acesso é apagado e o painel fecha na hora.
- O provador só troca mensagens com os domínios da loja; o painel não pode ser emoldurado.

## Ainda não feito

- Cobrança pela API de Billing da Nuvemshop (planos).
- Disparo de mensagens de WhatsApp para os leads.
- Painel embutido no admin via Nexo (hoje abre como página própria após o OAuth).
- Postgres + Redis quando passar de algumas centenas de lojas (a camada `store-service` isola o SQL).

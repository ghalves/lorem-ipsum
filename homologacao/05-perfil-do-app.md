# Miaou · Perfil do app no Portal de Parceiros

Os arquivos para copiar estão na pasta `loja-de-aplicativos/`.

## Correções no que já está cadastrado

| Onde | Hoje | Trocar por | Por quê |
| --- | --- | --- | --- |
| Dados básicos > **Categoria** | Inventário | **Marketing** (subcategoria: a mais próxima de conversão ou experiência de compra) | O Miaou não mexe em estoque. Na categoria errada, a busca da loja de apps não o mostra e a homologação estranha |
| LGPD > **store redact** | `https://miaou.com.br/webhooks/lgpd/store-redact` | `https://app.miaou.com.br/webhooks/lgpd/store-redact` | Os webhooks rodam no servidor do app (`app.`), não no site |
| LGPD > **customers redact** | `https://miaou.com.br/webhooks/lgpd/customers-redact` | `https://app.miaou.com.br/webhooks/lgpd/customers-redact` | Idem |
| LGPD > **customers data request** | `https://miaou.com.br/webhooks/lgpd/customers-data-request` | `https://app.miaou.com.br/webhooks/lgpd/customers-data-request` | Idem |
| **Permissões** | (conferir) | Marcadas só **Products** (leitura), **Orders** (leitura) e **Scripts** (escrita) | O diagrama e o documento 03 citam só essas. Permissão sobrando costuma ser questionada |

O restante (nome, e-mail, site, URL de redirecionamento, política de privacidade, handle) está certo.

## Brasil > Informações

| Campo | Limite do portal | O que colar |
| --- | --- | --- |
| Descrição curta | 140 caracteres | `loja-de-aplicativos/descricao-curta.txt` (125) |
| Descrição longa | 2.000 caracteres | `loja-de-aplicativos/descricao-longa.txt` (~1.740, segue o modelo oficial da Nuvemshop, sem planos e preços) |
| Ícone | exatamente 200 × 200 px, até 400 KB | `loja-de-aplicativos/icone-200x200.png` |
| Vídeo do aplicativo | YouTube, até 3 min | Opcional. É um vídeo curto de divulgação, diferente do vídeo da homologação |
| Perguntas frequentes | até 10 | `loja-de-aplicativos/faq-portal-9-perguntas.md` |
| Imagens do aplicativo | 3 a 5, exatamente 1920 × 1080 px, até 5 MB | `loja-de-aplicativos/imagens-1920x1080/` (4 imagens, nesta ordem) |

## Forma de cobrança

**Grátis** + **Possui vendas no aplicativo** (já configurado). A contratação é feita direto com a Miaou, fora da Nuvemshop.

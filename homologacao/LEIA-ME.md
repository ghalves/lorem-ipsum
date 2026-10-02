# Homologação Nuvemshop · Miaou

Pacote para responder ao e-mail de homologação. Tudo que não dependia de você já está pronto; o que falta está marcado como `[PREENCHER]` nos arquivos e listado abaixo.

## O que enviar

| Arquivo | Pedido da Nuvemshop | Situação |
| --- | --- | --- |
| `01-diagrama-sequencia.pdf` (+ `.png`, `.svg`, fonte `.mmd`) | Diagrama de sequência com os escopos | Pronto |
| Vídeo (você grava) seguindo `02-roteiro-video.pdf` | Vídeo de demonstração: instalação, login, reinstalação... | **Você grava** |
| `03-requisitos-tecnicos-e-assinatura.pdf` | Requisitos técnicos e etapas de assinatura (app com planos pagos) | Pronto, falta a seção 3 |
| `04-faq-template-nuvemshop.docx` | Template Nuvemshop de FAQs + Guia Tutorial de Instalação | Pronto (modelo oficial, com prints do painel) |
| `05-perfil-do-app.pdf` | Campos do perfil no Painel de Parceiros | Textos prontos para copiar |
| `email-resposta.md` | Resposta ao e-mail | Pronto, faltam os links |

## O que só você pode fazer

1. **Gravar o vídeo** seguindo `02-roteiro-video` (6 a 9 min) e subir como YouTube não listado ou Google Drive com link aberto.
2. **Preencher os `[PREENCHER]`**: App ID, loja de demonstração e acesso, link do vídeo, seu nome.
3. **Deixar uma loja de demonstração pronta** com o Miaou instalado, 3 produtos com foto (roupa, calça, óculos) e o plano ativo: `sudo miaou plano <id da loja> crescer`.
4. **Colar o FAQ no template oficial** da Nuvemshop (se eles mandaram um arquivo) e no Portal de Parceiros > app > FAQ.
5. **Completar o perfil** no Painel de Parceiros com os textos de `05-perfil-do-app` e criar **3 a 5 imagens** com provas reais, nas dimensões pedidas no portal.
6. **Conferir no portal** se os escopos marcados são exatamente `read_products`, `read_orders` e `write_scripts` (o diagrama cita só esses) e se os 3 webhooks de LGPD estão cadastrados.

## Pontos de atenção (podem travar a aprovação)

- **Cobrança.** Hoje o lojista não consegue contratar o plano sozinho: ele pede pelo "Falar com a Miaou" e o plano é ativado no servidor. A Nuvemshop pede que apps pagos expliquem a etapa de assinatura e deem acesso sem ela, e é isso que o documento 03 faz. Mas é provável que eles perguntem como o lojista paga. Decida antes de enviar:
  - **Cobrança pela Nuvemshop** (modelo "Mensal" no portal): falta integrar a API de Billing no app. Isso já está no "Ainda não feito" do README.
  - **Cobrança própria** (modelo "Gratuito" com cobrança do parceiro): explique no documento 03 como o lojista paga (Pix, boleto, cartão, link de pagamento...).
- **Contas sem plano não veem nada.** Se a equipe instalar na loja dela e você demorar para ativar o plano, ela vai achar que o app não funciona. Por isso a loja de demonstração (item 3) é importante.
- **Termos de uso.** O app tem página de privacidade, mas não de termos. Se o portal pedir, é preciso criar uma.
- **NubeSDK.** Desde 5 de junho de 2026 a Nuvemshop exige NubeSDK. O Miaou já usa (scripts Store e Checkout), e isso está no documento 03.

## Como regenerar os PDFs

O diagrama está em Mermaid (`01-diagrama-sequencia.mmd`); dá para editar em https://mermaid.live e exportar de novo. Os outros PDFs saem dos `.md` de mesmo nome.

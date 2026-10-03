# Homologação Nuvemshop · Miaou

Pacote para responder ao e-mail de homologação. Tudo que não dependia de você já está pronto; o que falta está marcado como `[PREENCHER]` nos arquivos e listado abaixo.

## O que enviar

| Arquivo | Pedido da Nuvemshop | Situação |
| --- | --- | --- |
| `01-diagrama-sequencia.pdf` (+ `.png`, `.svg`, fonte `.mmd`) | Diagrama de sequência com os escopos | Pronto |
| Vídeo (você grava) seguindo `02-roteiro-video.pdf` | Vídeo de demonstração: instalação, login, reinstalação... | **Você grava** |
| `03-requisitos-tecnicos-e-assinatura.pdf` | Requisitos técnicos e etapas de assinatura | Pronto |
| `04-faq-template-nuvemshop.docx` | Template Nuvemshop de FAQs + Guia Tutorial de Instalação | Pronto (modelo oficial, com prints do painel) |
| `05-perfil-do-app.pdf` | Campos do perfil no Painel de Parceiros | Textos prontos para copiar |
| `email-resposta.md` | Resposta ao e-mail | Pronto, falta o link do vídeo |

## O que só você pode fazer

1. **Gravar o vídeo** seguindo `02-roteiro-video` (6 a 9 min) e subir como YouTube não listado ou Google Drive com link aberto.
2. **Colar o link do vídeo** no e-mail (único `[PREENCHER]` que sobrou).
3. **Deixar uma loja de demonstração pronta** com o Miaou instalado, 3 produtos com foto (roupa, calça, óculos) e liberada: `sudo miaou plano <id da loja> crescer`.
4. **Colar o FAQ no template oficial** da Nuvemshop (se eles mandaram um arquivo) e no Portal de Parceiros > app > FAQ.
5. **Completar o perfil** no Painel de Parceiros com os textos de `05-perfil-do-app`, o ícone e as suas imagens.
6. **Conferir no portal** se os escopos marcados são exatamente `read_products`, `read_orders` e `write_scripts` (o diagrama cita só esses) e se os 3 webhooks de LGPD estão cadastrados.

## Pontos de atenção (podem travar a aprovação)

- **Planos e preços fora dos textos, por enquanto.** Nos textos públicos (descrição e perguntas do portal) eles foram removidos. Nos documentos que vão só para a Nuvemshop, o assunto aparece de forma neutra ("liberação da loja pela Miaou", "valores sob consulta"), porque a página de requisitos pede para avisar sobre fluxos de assinatura e o modelo de FAQ tem a seção "Planos e Preços" obrigatória. No vídeo, não abra a aba Planos. A equipe da Nuvemshop ainda pode ver essa aba ao testar o app.
- **Loja não liberada não mostra nada.** Se a equipe instalar na loja dela e você demorar para liberar, ela vai achar que o app não funciona. Por isso a loja de demonstração é importante.
- **Termos de uso.** O app tem página de privacidade, mas não de termos. Se o portal pedir, é preciso criar uma.
- **NubeSDK.** Desde 5 de junho de 2026 a Nuvemshop exige NubeSDK. O Miaou já usa (scripts Store e Checkout), e isso está no documento 03.

## Como regenerar os PDFs

O diagrama está em Mermaid (`01-diagrama-sequencia.mmd`); dá para editar em https://mermaid.live e exportar de novo. Os outros PDFs saem dos `.md` de mesmo nome.

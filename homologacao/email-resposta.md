**Assunto:** Re: Homologação do aplicativo Miaou: Provador Virtual, artefatos e arquivos de publicação

Olá, equipe Nuvemshop! Tudo bem?

Obrigado pelo retorno. Seguem os artefatos de homologação e os arquivos de publicação do **Miaou: Provador Virtual** (App ID **44305**), publicado no Brasil:

**Artefatos para análise**

1. **Diagrama de sequência** (anexo `01-diagrama-sequencia.pdf`, também em PNG): mostra a instalação via Nuvemshop, o login pelo admin, a liberação da loja, o uso na vitrine e no checkout (scripts NubeSDK), a desinstalação e reinstalação, e os webhooks de LGPD. Cada chamada à API indica o escopo usado: `read_products`, `read_orders` e `write_scripts`.
2. **Vídeo de demonstração:** https://youtu.be/sfnZy857_wM. Mostra a instalação pela Loja de Aplicativos, a criação automática da conta (o app não tem cadastro nem senha próprios), o login pelo admin, a prova na loja, a compra atribuída ao provador, a atualização de produto por webhook, a desinstalação e a reinstalação. Após a reinstalação o dashboard aparece zerado: na desinstalação a Nuvemshop envia o `store/redact` e o Miaou apaga os dados da loja, mantendo só o plano contratado, por isso o provador volta a funcionar sem nova liberação.
3. **Requisitos técnicos e assinatura** (anexo `03-requisitos-tecnicos-e-assinatura.pdf`): o Miaou é contratado direto com a Miaou (fora da Nuvemshop) e o botão só aparece na loja depois que ela é liberada. Para a análise, disponibilizamos:
   - uma loja de demonstração com o Miaou instalado e já liberado:
     - Loja: https://lojademo317.lojavirtualnuvem.com.br/ (admin: https://lojademo317.lojavirtualnuvem.com.br/admin)
     - Acesso ao admin: 9mvq3m@gmail.com / `[SENHA]`
     - Produtos para testar: Polo Tricot (parte de cima), CALÇA BLAIR UVA (parte de baixo) e Óculos de Grau Michael Kors MK4103U - Preto (óculos);
   - ou, se preferirem usar a loja de vocês, basta nos enviar o ID da loja depois da instalação e liberamos o provador sem custo em até 24 horas.

**Arquivos para publicação**

4. **Template Nuvemshop de FAQs** preenchido, com o Guia Tutorial de Instalação passo a passo (anexo `04-faq-template-nuvemshop.docx`, no modelo oficial "Marketing e demais categorias").
5. **Perfil do aplicativo** preenchido no Painel de Parceiros (nome, descrições, imagens, ícone e links).

Ficamos à disposição para qualquer ajuste ou dúvida.

Obrigado!

Paulo Lima
Miaou · suporte@miaou.com.br · https://miaou.com.br

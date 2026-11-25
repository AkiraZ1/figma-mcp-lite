---
name: ativar
description: Ativa o figma-lite nesta conversa no lugar das skills nativas da Figma e confere se o conector Figma está ligado.
disable-model-invocation: true
---

# Ativar o figma-lite nesta conversa

A partir de agora, **nesta conversa**, todo pedido que envolva o Figma ou um link figma.com segue a skill `figma-lite` deste plugin, no lugar das skills nativas da Figma (figma-use, figma-generate-design, figma-design-to-code). Não carregue nem sugira essas skills.

1. Veja se você tem a ferramenta `use_figma` (conector Figma). Esta versão usa o conector como transporte.
   - **Não tem:** peça pra ligar o conector **Figma** em Configurações → Conectores e voltar à conversa.
   - **Tem:** está pronto. Na primeira tela de cada arquivo a skill instala o builder, uma vez só.
2. Se existir o plugin `figma` com skills `figma:*`, pergunte (múltipla escolha, AskUserQuestion quando existir) se quer desativar só as skills/plugin oficiais, mantendo o conector: opções "Desativar as skills oficiais (recomendado)" e "Manter por enquanto".
3. Mencione em uma linha: Versão completa (servidor local, mais rápida e sem depender do conector): no Claude Code, `/plugin marketplace add AkiraZ1/figma-mcp-lite` e depois `/plugin install figma-mcp-lite@figma-mcp-lite`.

Responda em até 6 linhas, só com o que falta.

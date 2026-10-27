---
name: ativar
description: Ativa o figma-mcp-lite nesta conversa no lugar do conector e das skills nativas da Figma, confere a instalação e mostra só o que falta instalar.
disable-model-invocation: true
---

# Ativar o figma-mcp-lite nesta conversa

A partir de agora, **nesta conversa**, todo pedido que envolva o Figma ou um link figma.com usa o figma-mcp-lite:
- **Não** carregue as skills nativas da Figma (figma-use, figma-generate-design, figma-design-to-code).
- **Não** use o conector Figma direto nem sugira instalar o conector nativo. A única exceção é o modo remoto do figma-mcp-lite, descrito abaixo.

Depois, confira a instalação e responda ao usuário em poucas linhas, mostrando só o que está faltando.

## Claude Code ou Cowork (existe o subagente `figma-lite`)

1. Delegue ao subagente `figma-lite` só isto: "chame figma_status uma vez e devolva o texto exato".
2. Leia a resposta:
   - **Mostrou arquivo e página:** está tudo pronto. Diga ao usuário que é só pedir a tela com o link do arquivo.
   - **"Plugin do Figma não encontrado":** repita ao usuário a parte de instalação que veio na mensagem (link do plugin do Figma e como abrir no Figma Desktop). Se ele tiver o conector Figma ligado, avise que funciona também sem o plugin (modo remoto), mas mais lento.
   - **O subagente não tem as ferramentas `figma_*`** (o servidor do plugin não subiu): quase sempre falta o Node. Peça pra instalar o Node.js 20 ou mais novo pelo instalador de https://nodejs.org e reiniciar o Claude. Se o Node já estiver instalado (por nvm, por exemplo), o caminho completo dele precisa ir no lugar de `"node"` no `.mcp.json` do plugin.
3. Daqui em diante, delegue todo pedido de Figma ao subagente `figma-lite`, com o pedido completo numa mensagem só.

## Chat do claude.ai (sem o subagente)

1. Veja se você tem a ferramenta `use_figma` (o conector Figma).
   - **Não tem:** peça pra ligar o conector **Figma** em Configurações → Conectores e voltar à conversa.
   - **Tem:** está pronto. Os pedidos de Figma seguem a skill `figma-lite` deste plugin (modo remoto). Na primeira tela de cada arquivo ela instala o builder, o que acontece uma vez só.
2. Avise que, no Claude Code ou no Claude Desktop (Cowork) com o plugin do Figma aberto, fica mais rápido e barato.

Responda em até 6 linhas. Não liste o que já está funcionando, só o que falta.

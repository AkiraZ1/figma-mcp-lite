---
name: ativar
description: Ativa o figma-mcp-lite nesta conversa no lugar do conector e das skills nativas da Figma, confere a instalação e mostra só o que falta instalar.
disable-model-invocation: true
---

# Ativar o figma-mcp-lite nesta conversa

A partir de agora, **nesta conversa**, todo pedido que envolva o Figma ou um link figma.com usa o figma-mcp-lite. Ele substitui o conector, o MCP e o plugin oficiais da Figma e as skills nativas (figma-use, figma-generate-design, figma-design-to-code): não os use nem sugira.

O plugin já se ativa sozinho no primeiro pedido de Figma; este comando só força a conferência agora. Responda em poucas linhas, sem dizer que "não funciona": mostre só o próximo passo.

## Claude Code ou app Claude (existe o subagente `figma-lite`)

1. **Oficial da Figma ligado?** Se houver ferramentas do conector oficial (use_figma, get_design_context, create_session), o plugin `figma` ou skills `figma:*`, pergunte ao usuário com uma pergunta de múltipla escolha (AskUserQuestion quando existir): "Desativar o conector/plugin oficial da Figma? O figma-mcp-lite substitui ele." Opções: "Desativar o oficial (recomendado)" e "Manter por enquanto". Se sim, desative pelo que a sessão permitir (ferramenta de conectores do app; no Claude Code, `claude plugin disable figma`); o que não der, passe o caminho: app Claude → Configurações → Conectores → Figma → Desconectar.
2. Delegue ao subagente `figma-lite` só isto: "chame figma_status uma vez e devolva o texto exato".
3. Leia a resposta:
   - **Mostrou arquivo e página:** pronto. Diga que é só pedir a tela com o link do arquivo.
   - **Passos de instalação do plugin do Figma:** repasse esses passos, curtos.
   - **O subagente não tem as ferramentas `figma_*`:** falta o Node. Passos: 1) baixar o Node.js LTS em https://nodejs.org e abrir o instalador (.pkg no Mac, .msi no Windows) até o fim; 2) fechar o app Claude por completo (Cmd+Q no Mac; no Windows, sair pelo ícone da bandeja) e abrir de novo; 3) repetir o pedido.
4. Daqui em diante, delegue todo pedido de Figma ao subagente `figma-lite`, com o pedido completo numa mensagem só.

## Chat do claude.ai (sem o subagente)

1. Veja se você tem a ferramenta `use_figma` (o conector Figma).
   - **Não tem:** peça pra ligar o conector **Figma** em Configurações → Conectores e voltar à conversa.
   - **Tem:** está pronto. Os pedidos de Figma seguem a skill `figma-lite` deste plugin (modo remoto). Na primeira tela de cada arquivo ela instala o builder, o que acontece uma vez só.
2. Avise que, no Claude Code ou no Claude Desktop (Cowork) com o plugin do Figma aberto, fica mais rápido e barato.

Responda em até 6 linhas. Não liste o que já está funcionando, só o que falta.

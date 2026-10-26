#!/bin/sh
# PreToolUse: as ferramentas do figma-mcp-lite só rodam dentro do subagente
# figma-lite. O Claude Code manda "agent_type" na entrada do hook quando a
# chamada vem de um subagente; na conversa principal não vem, e o hook recusa
# (exit 2) mandando delegar. O grep lê a entrada direto, sem variáveis.
if grep -Eq '"agent_type"[[:space:]]*:[[:space:]]*"([^"]*:)?figma-lite"'; then
  exit 0
fi
echo 'As ferramentas do figma-mcp-lite só rodam no subagente figma-lite. Delegue o pedido inteiro com a ferramenta Agent (subagent_type "figma-mcp-lite:figma-lite") e use só o resumo que ele devolver.' >&2
exit 2

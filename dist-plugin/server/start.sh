#!/bin/sh
# Lançador do servidor MCP: acha um Node 20+ mesmo quando o app (Claude
# Desktop aberto pelo Finder, Claude Code do instalador nativo) não herda o
# PATH do shell. Tenta o PATH e depois os lugares comuns de instalação.
# Pasta do script sem programas externos (o PATH do app pode estar vazio).
dir=${0%/*}
for n in "$(command -v node 2>/dev/null)" \
  /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node \
  "$HOME/.local/node/bin/node" "$HOME/.local/bin/node" "$HOME/.volta/bin/node" \
  "$HOME/.local/share/fnm/aliases/default/bin/node" \
  "$HOME/Library/Application Support/fnm/aliases/default/bin/node" \
  "$HOME"/.nvm/versions/node/*/bin/node; do
  [ -n "$n" ] && [ -x "$n" ] || continue
  major=$("$n" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || continue
  [ "$major" -ge 20 ] 2>/dev/null && exec "$n" "$dir/server.mjs"
done
echo "figma-mcp-lite: Node.js 20 ou mais novo não encontrado. Instale pelo instalador de https://nodejs.org (ele coloca o node em /usr/local/bin, que o app enxerga) e reinicie o Claude." >&2
exit 1

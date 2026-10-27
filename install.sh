#!/bin/sh
# Instala os agentes figma-lite no Claude Code (Sonnet) e no Codex (Luna).
# O MCP é declarado DENTRO de cada agente: a conversa principal nunca vê as
# ferramentas, então todo trabalho de Figma tem que passar pelo subagente.
set -e
ROOT=$(cd "$(dirname "$0")" && pwd)
SERVER="$ROOT/src/server.js"
NODE=$(command -v node)
VERSION=$(node -p "require('$ROOT/package.json').version")
# A versão vai dentro do trecho de build do prompt: builder velho no arquivo
# devolve LITE_OUTDATED em vez de rodar com bug já corrigido.
PROMPT=$(cat "$ROOT/agents/prompt.md" "$ROOT/agents/spec.md" | sed "s/__VERSION__/$VERSION/g")
CODEX_MODEL=${CODEX_MODEL:-gpt-6-luna}

(cd "$ROOT" && npm install --silent && node scripts/bundle.js)

mkdir -p "$HOME/.claude/agents"
cat > "$HOME/.claude/agents/figma-lite.md" <<EOF
---
name: figma-lite
description: Use para QUALQUER tarefa no Figma (criar ou editar tela, componente, layout, ler o design system de um arquivo). É o único caminho pro Figma, a conversa principal não tem as ferramentas. Passe o pedido completo (tela, conteúdo, estados) numa mensagem só.
model: sonnet
tools: mcp__claude_ai_Figma__use_figma, mcp__claude_ai_Figma__search_design_system, mcp__figma-mcp-lite__figma_ds, mcp__figma-mcp-lite__figma_lite_install, mcp__figma-mcp-lite__figma_status, mcp__figma-mcp-lite__figma_build, mcp__figma-mcp-lite__figma_edit, mcp__figma-mcp-lite__figma_tree, mcp__figma-mcp-lite__figma_shot, mcp__figma-mcp-lite__figma_inspect, mcp__figma-mcp-lite__figma_component, mcp__figma-mcp-lite__figma_help, Read
mcpServers:
  - figma-mcp-lite:
      type: stdio
      command: $NODE
      args: ["$SERVER"]
      env:
        FIGMA_LITE_SUBAGENT: sonnet
---

$PROMPT
EOF

mkdir -p "$HOME/.codex/agents"
cat > "$HOME/.codex/agents/figma-lite.toml" <<EOF
name = "figma-lite"
description = "Use para QUALQUER tarefa no Figma (criar ou editar tela, componente, layout, ler o design system). É o único caminho pro Figma. Passe o pedido completo numa mensagem só."
nickname_candidates = ["Figmo"]
model = "$CODEX_MODEL"
model_reasoning_effort = "low"
developer_instructions = '''
Primeira chamada, sempre: figma_status com subagent_model = "$CODEX_MODEL". Sem isso as outras ferramentas recusam.

$PROMPT
'''
EOF

# O Codex não deixa um papel de agente ligar MCP próprio (testado no 0.164):
# o servidor fica no config global, e a trava é do próprio servidor — nada
# funciona até um subagente se identificar com figma_status(subagent_model).
CODEX_CFG="$HOME/.codex/config.toml"
if ! grep -q '^\[mcp_servers.figma-mcp-lite\]' "$CODEX_CFG" 2>/dev/null; then
  cp "$CODEX_CFG" "$CODEX_CFG.bak-figma-lite" 2>/dev/null || true
  cat >> "$CODEX_CFG" <<EOF

# figma-mcp-lite: só funciona depois que o subagente figma-lite chama figma_status(subagent_model).
[mcp_servers.figma-mcp-lite]
command = "$NODE"
args = ["$SERVER"]
EOF
fi

echo "ok: ~/.claude/agents/figma-lite.md (sonnet) e ~/.codex/agents/figma-lite.toml ($CODEX_MODEL)"
echo "Falta só: Figma Desktop → Plugins → Development → Import plugin from manifest → $ROOT/plugin/manifest.json"

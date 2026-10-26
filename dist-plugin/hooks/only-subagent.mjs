#!/usr/bin/env node
// PreToolUse: as ferramentas do figma-mcp-lite só rodam dentro do subagente
// figma-lite. Na conversa principal o hook recusa e manda delegar — é isso que
// mantém o trabalho de Figma (e o contexto dele) fora da conversa principal.
let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  if (/(^|:)figma-lite$/.test(input.agent_type || '')) process.exit(0);
  process.stderr.write('As ferramentas do figma-mcp-lite só rodam no subagente figma-lite. Delegue o pedido inteiro com a ferramenta Agent (subagent_type "figma-mcp-lite:figma-lite") e use só o resumo que ele devolver.');
  process.exit(2);
});

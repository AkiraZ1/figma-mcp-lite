#!/usr/bin/env node
// Monta o plugin de Claude Code em dist-plugin/ (o que vai pro marketplace):
//   .claude-plugin/plugin.json   manifesto
//   agents/figma-lite.md         subagente Sonnet (único que pode usar as ferramentas)
//   .mcp.json + hooks/           servidor do plugin + hook que barra uso fora do subagente
//   server/start.sh              lançador: acha um Node 20+ e roda o servidor
//   server/server.mjs            servidor MCP sem dependências (só módulos do Node)
//   server/remote.js             builder minificado pro modo remoto
//   README.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-plugin');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true }); fs.writeFileSync(path.join(OUT, rel), text); };
const copy = (from, rel) => write(rel, fs.readFileSync(path.join(ROOT, from)));

execFileSync(process.execPath, [path.join(ROOT, 'scripts/bundle.js')], { stdio: 'inherit' });
fs.rmSync(OUT, { recursive: true, force: true });

write('.claude-plugin/plugin.json', JSON.stringify({
  name: 'figma-mcp-lite', // = PLUGIN abaixo
  version: pkg.version,
  description: 'Telas no Figma gastando ~10x menos contexto que o MCP nativo: subagente Sonnet, spec JSON numa chamada só e as variáveis do design system das bibliotecas do próprio arquivo.',
  author: { name: 'Jemerson Barros', email: 'jemersonbarros@gmail.com' },
  license: 'MIT',
  homepage: 'https://github.com/AkiraZ1/figma-mcp-lite',
  documentationUrl: 'https://github.com/AkiraZ1/figma-mcp-lite#readme',
  termsOfServiceUrl: 'https://github.com/AkiraZ1/figma-mcp-lite/blob/main/TERMS.md',
  privacyPolicyUrl: 'https://github.com/AkiraZ1/figma-mcp-lite/blob/main/PRIVACY.md',
  repository: 'https://github.com/AkiraZ1/figma-mcp-lite',
  keywords: ['figma', 'design-system', 'variables', 'mcp', 'subagent'],
}, null, 2) + '\n');

// Servidor sem dependências: vai legível, só com versão e link do plugin do
// Figma preenchidos (nada de bundle minificado pra revisão).
const server = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
const BUILD_LINE = 'const BUILD = { version: null, pluginUrl: null };';
if (!server.includes(BUILD_LINE)) throw new Error('src/server.js sem a linha BUILD');
write('server/server.mjs', server.replace(BUILD_LINE,
  `const BUILD = { version: ${JSON.stringify(pkg.version)}, pluginUrl: ${JSON.stringify(pkg.figmaPluginUrl || null)} };`));
copy('dist/remote.js', 'server/remote.js');

// O plugin do Figma NÃO vai no pacote do Claude: é instalado pela Figma
// Community (link na mensagem de instalação). Fica em plugin/ no repositório.

const prompt = fs.readFileSync(path.join(ROOT, 'agents/prompt.md'), 'utf8').replaceAll('__VERSION__', pkg.version);
// Agente de plugin não pode declarar MCP próprio (o Claude Code ignora
// mcpServers nele): o servidor vem do .mcp.json do plugin e o hook
// only-subagent recusa as ferramentas fora do subagente figma-lite.
// type explícito: houve caso (plugin entregue pela biblioteca da org no Claude
// Desktop) em que o app tentou executar "stdio" como comando. O lançador acha o
// Node fora do PATH do app (Finder no macOS não herda o PATH do shell).
copy('server/start.sh', 'server/start.sh');
fs.chmodSync(path.join(OUT, 'server/start.sh'), 0o755);
write('.mcp.json', JSON.stringify({ mcpServers: { lite: {
  type: 'stdio',
  command: '${CLAUDE_PLUGIN_ROOT}/server/start.sh', args: [],
  // A trava do próprio servidor (pedir subagent_model) é pra cliente sem hook;
  // aqui o hook já garante o subagente.
  env: { FIGMA_LITE_SUBAGENT: 'claude-code-plugin' },
} } }, null, 2) + '\n');
copy('hooks/only-subagent.sh', 'hooks/only-subagent.sh');
fs.chmodSync(path.join(OUT, 'hooks/only-subagent.sh'), 0o755);
write('hooks/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{
  // Sem o nome do plugin fixo: forks e cópias locais funcionam sem editar o hook.
  matcher: 'mcp__plugin_[^_]+_lite__.*',
  hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/only-subagent.sh"' }],
}] } }, null, 2) + '\n');

const PLUGIN = 'figma-mcp-lite'; // forks: troque aqui e em plugin.json/marketplace.json
const TOOLS = ['figma_ds', 'figma_lite_install', 'figma_status', 'figma_build', 'figma_edit', 'figma_tree', 'figma_shot'];
write('agents/figma-lite.md', `---
name: figma-lite
description: Use para QUALQUER tarefa no Figma (criar ou editar tela, componente, layout, ler o design system de um arquivo). É o único caminho pro Figma: a conversa principal não pode usar as ferramentas do figma-mcp-lite. Passe o pedido completo (tela, conteúdo, estados e o link do arquivo) numa mensagem só.
model: sonnet
tools: mcp__claude_ai_Figma__use_figma, mcp__claude_ai_Figma__search_design_system, ${TOOLS.map((t) => `mcp__plugin_${PLUGIN}_lite__${t}`).join(', ')}, Read
---

${prompt}`);

copy('README.plugin.md', 'README.md');
copy('assets/icon.png', '.claude-plugin/icon.png');
copy('LICENSE', 'LICENSE');
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`dist-plugin/ v${pkg.version}: ${Math.round(size(OUT) / 1024)} KB`);

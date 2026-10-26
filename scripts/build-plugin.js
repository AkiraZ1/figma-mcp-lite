#!/usr/bin/env node
// Monta o plugin de Claude Code em dist-plugin/ (o que vai pro marketplace):
//   .claude-plugin/plugin.json   manifesto
//   agents/figma-lite.md         subagente Sonnet (único que pode usar as ferramentas)
//   .mcp.json + hooks/           servidor do plugin + hook que barra uso fora do subagente
//   server/server.mjs            servidor MCP num arquivo só (sem node_modules)
//   server/remote.js             builder minificado pro modo remoto
//   figma-plugin/                plugin do Figma Desktop (importar pelo manifest)
//   README.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-plugin');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true }); fs.writeFileSync(path.join(OUT, rel), text); };
const copy = (from, rel) => write(rel, fs.readFileSync(path.join(ROOT, from)));

execFileSync(process.execPath, [path.join(ROOT, 'scripts/bundle.js')], { stdio: 'inherit' });
fs.rmSync(OUT, { recursive: true, force: true });

write('.claude-plugin/plugin.json', JSON.stringify({
  name: 'figma-mcp-lite',
  version: pkg.version,
  description: 'Telas no Figma gastando ~10x menos token que o MCP nativo: subagente Sonnet, spec JSON numa chamada só e os tokens do design system das bibliotecas do próprio arquivo.',
  author: { name: 'Jemerson Barros', email: 'jemersonbarros@gmail.com' },
  license: 'MIT',
  homepage: 'https://github.com/AkiraZ1/figma-mcp-lite',
  repository: 'https://github.com/AkiraZ1/figma-mcp-lite',
  keywords: ['figma', 'design-system', 'design-tokens', 'mcp', 'subagent'],
}, null, 2) + '\n');

buildSync({
  entryPoints: [path.join(ROOT, 'src/server.js')],
  outfile: path.join(OUT, 'server/server.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20', minify: true, legalComments: 'none',
  define: { __LITE_VERSION__: JSON.stringify(pkg.version), __FIGMA_PLUGIN_URL__: JSON.stringify(pkg.figmaPluginUrl || '') },
  // ws tem dependências nativas opcionais; sem elas usa o fallback em JS puro.
  external: ['bufferutil', 'utf-8-validate'],
  // Pacotes CommonJS (ws) dentro de ESM precisam de require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
copy('dist/remote.js', 'server/remote.js');

for (const f of ['manifest.json', 'code.js', 'ui.html']) copy(`plugin/${f}`, `figma-plugin/${f}`);

const prompt = fs.readFileSync(path.join(ROOT, 'agents/prompt.md'), 'utf8').replaceAll('__VERSION__', pkg.version);
// Agente de plugin não pode declarar MCP próprio (o Claude Code ignora
// mcpServers nele): o servidor vem do .mcp.json do plugin e o hook
// only-subagent recusa as ferramentas fora do subagente figma-lite.
write('.mcp.json', JSON.stringify({ mcpServers: { lite: {
  command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server/server.mjs'],
  // A trava do próprio servidor (pedir subagent_model) é pra cliente sem hook;
  // aqui o hook já garante o subagente.
  env: { FIGMA_LITE_SUBAGENT: 'claude-code-plugin' },
} } }, null, 2) + '\n');
copy('hooks/only-subagent.mjs', 'hooks/only-subagent.mjs');
write('hooks/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{
  matcher: 'mcp__plugin_figma-mcp-lite_lite__.*',
  hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/only-subagent.mjs"' }],
}] } }, null, 2) + '\n');

const TOOLS = ['figma_ds', 'figma_lite_install', 'figma_status', 'figma_build', 'figma_run', 'figma_tree', 'figma_shot'];
write('agents/figma-lite.md', `---
name: figma-lite
description: Use para QUALQUER tarefa no Figma (criar ou editar tela, componente, layout, ler o design system de um arquivo). É o único caminho pro Figma: a conversa principal não pode usar as ferramentas do figma-mcp-lite. Passe o pedido completo (tela, conteúdo, estados e o link do arquivo) numa mensagem só.
model: sonnet
tools: mcp__claude_ai_Figma__use_figma, mcp__claude_ai_Figma__search_design_system, ${TOOLS.map((t) => `mcp__plugin_figma-mcp-lite_lite__${t}`).join(', ')}, Read
---

${prompt}`);

copy('README.plugin.md', 'README.md');
copy('assets/icon.png', '.claude-plugin/icon.png');
copy('LICENSE', 'LICENSE');
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`dist-plugin/ v${pkg.version}: ${Math.round(size(OUT) / 1024)} KB`);

#!/usr/bin/env node
// Monta o plugin de Claude Code em dist-plugin/ (o que vai pro marketplace):
//   .claude-plugin/plugin.json   manifesto
//   agents/figma-lite.md         subagente Sonnet (único que pode usar as ferramentas)
//   .mcp.json + hooks/           servidor do plugin + hooks (barra uso fora do subagente; avisa que substitui o nativo)
//   skills/figma-lite/           skill do chat (claude.ai): modo remoto pelo conector Figma
//   skills/ativar/               /figma-mcp-lite:ativar — ativa nesta conversa e confere a instalação
//   server/server.mjs            servidor MCP sem dependências (só módulos do Node)
//   server/install.js            instalação do builder no modo remoto (com trava de integridade)
//   server/remote-call.js        modelo da chamada do builder no modo remoto (texto pro agente)
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
copy('dist/install.js', 'server/install.js');
copy('lib/remote-call.js', 'server/remote-call.js');

// O plugin do Figma NÃO vai no pacote do Claude: é instalado pela Figma
// Community (link na mensagem de instalação). Fica em plugin/ no repositório.

const prompt = (fs.readFileSync(path.join(ROOT, 'agents/prompt.md'), 'utf8') + fs.readFileSync(path.join(ROOT, 'agents/spec.md'), 'utf8')).replaceAll('__VERSION__', pkg.version);
// Agente de plugin não pode declarar MCP próprio (o Claude Code ignora
// mcpServers nele): o servidor vem do .mcp.json do plugin e o hook
// only-subagent recusa as ferramentas fora do subagente figma-lite.
// "node" direto funciona em macOS, Linux e Windows quando o Node vem do
// instalador oficial (nodejs.org põe no PATH que os apps enxergam). type
// explícito: houve caso (plugin da org no Claude Desktop) em que o app tentou
// executar "stdio" como comando.
write('.mcp.json', JSON.stringify({ mcpServers: { lite: {
  type: 'stdio',
  command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server/server.mjs'],
  env: { FIGMA_LITE_SUBAGENT: 'claude-code-plugin' },
} } }, null, 2) + '\n');
copy('hooks/only-subagent.sh', 'hooks/only-subagent.sh');
fs.chmodSync(path.join(OUT, 'hooks/only-subagent.sh'), 0o755);
copy('hooks/session-start.sh', 'hooks/session-start.sh');
fs.chmodSync(path.join(OUT, 'hooks/session-start.sh'), 0o755);
write('hooks/hooks.json', JSON.stringify({ hooks: {
  // Diz ao Claude, no começo de toda sessão, que o lite substitui o fluxo nativo.
  SessionStart: [{ hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"' }] }],
  PreToolUse: [{
  // Sem o nome do plugin fixo (forks) e cobrindo o prefixo do Cowork (remote-devices).
  matcher: 'mcp__(remote-devices__)?plugin_[^_]+_lite__.*',
  hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/only-subagent.sh"' }],
}] } }, null, 2) + '\n');

// Skill do chat (claude.ai): modo remoto pelo conector Figma, sem servidor
// local. install.js é o código de instalação do builder, pronto pra colar.
const spec = fs.readFileSync(path.join(ROOT, 'agents/spec.md'), 'utf8');
write('skills/figma-lite/SKILL.md', (fs.readFileSync(path.join(ROOT, 'skills/figma-lite/SKILL.head.md'), 'utf8') + spec).replaceAll('__VERSION__', pkg.version));
copy('dist/install.js', 'skills/figma-lite/install.js');
// /figma-mcp-lite:ativar — só carrega quando alguém digita (disable-model-invocation),
// então não pesa nas conversas que não usam.
copy('skills/ativar/SKILL.md', 'skills/ativar/SKILL.md');

const PLUGIN = 'figma-mcp-lite'; // forks: troque aqui e em plugin.json/marketplace.json
const TOOLS = ['figma_ds', 'figma_lite_install', 'figma_status', 'figma_build', 'figma_edit', 'figma_variant', 'figma_link', 'figma_tree', 'figma_shot', 'figma_inspect', 'figma_component', 'figma_help', 'figma_pages', 'figma_run'];
// No Cowork as ferramentas do plugin chegam com o prefixo remote-devices.
const PREFIXES = [`mcp__plugin_${PLUGIN}_lite__`, `mcp__remote-devices__plugin_${PLUGIN}_lite__`];
write('agents/figma-lite.md', `---
name: figma-lite
description: Use para QUALQUER tarefa no Figma (criar ou editar tela, componente, layout, ler o design system de um arquivo). Substitui o conector e as skills nativas da Figma, que não devem ser sugeridos. É o único caminho pro Figma: a conversa principal não pode usar as ferramentas do figma-mcp-lite. Passe o pedido completo (tela, conteúdo, estados e o link do arquivo) numa mensagem só.
model: sonnet
tools: mcp__claude_ai_Figma__use_figma, mcp__claude_ai_Figma__search_design_system, ${PREFIXES.flatMap((p) => TOOLS.map((t) => p + t)).join(', ')}, Read
---

${prompt}`);

copy('README.plugin.md', 'README.md');
copy('assets/icon.png', '.claude-plugin/icon.png');
copy('LICENSE', 'LICENSE');
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`dist-plugin/ v${pkg.version}: ${Math.round(size(OUT) / 1024)} KB`);

// ─── dist-directory/: versão do diretório público de plugins do Claude ──────
// O diretório não aceita código local de organização não verificada: nada de
// hooks de comando, servidor MCP local nem arquivos .js/.mjs/.sh (ou com #!).
// Só Markdown/JSON/imagem. Então esta versão é só o modo remoto (skill pelo
// conector Figma), com o código de instalação do builder dentro de um .md.
// A versão completa (servidor local + subagente) segue no marketplace do GitHub.
const DIR = path.join(ROOT, 'dist-directory');
fs.rmSync(DIR, { recursive: true, force: true });
const dwrite = (rel, text) => { fs.mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true }); fs.writeFileSync(path.join(DIR, rel), text); };
const FULL = 'Versão completa (servidor local, mais rápida e sem depender do conector): no Claude Code, `/plugin marketplace add AkiraZ1/figma-mcp-lite` e depois `/plugin install figma-mcp-lite@figma-mcp-lite`.';

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, '.claude-plugin/plugin.json'), 'utf8'));
manifest.description = 'Telas no Figma gastando ~10x menos contexto: spec JSON numa chamada só pelo conector Figma, com as variáveis do design system das bibliotecas do próprio arquivo.';
manifest.keywords = ['figma', 'design-system', 'variables', 'skill'];
dwrite('.claude-plugin/plugin.json', JSON.stringify(manifest, null, 2) + '\n');
fs.copyFileSync(path.join(ROOT, 'assets/icon.png'), path.join(DIR, '.claude-plugin/icon.png'));
fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(DIR, 'LICENSE'));

const skill = fs.readFileSync(path.join(OUT, 'skills/figma-lite/SKILL.md'), 'utf8');
const OLD_INSTALL = 'leia o arquivo `install.js` desta skill e passe o conteúdo dele, **sem mudar nada**, como `code` de um `use_figma`';
const OLD_SUB = '- **Claude Code ou Cowork com o subagente `figma-lite` disponível:** não use esta skill. Delegue o pedido inteiro ao subagente.\n';
const OLD_CHAT = '- **Chat (claude.ai):** use o fluxo abaixo.';
for (const s of [OLD_INSTALL, OLD_SUB, OLD_CHAT]) if (!skill.includes(s)) throw new Error('SKILL.head.md mudou; ajuste o dist-directory: ' + s.slice(0, 40));
dwrite('skills/figma-lite/SKILL.md', skill
  .replace(OLD_INSTALL, 'leia o arquivo `install.md` desta skill e passe o código do bloco entre as linhas `~~~~`, **sem mudar nada** (sem as linhas `~~~~`), como `code` de um `use_figma`')
  .replace(OLD_SUB, '')
  .replace(OLD_CHAT, '- Use o fluxo abaixo em qualquer cliente (claude.ai, app Claude, Claude Code).'));
const inst = fs.readFileSync(path.join(ROOT, 'dist/install.js'), 'utf8');
if (inst.includes('~~~~')) throw new Error('install.js contém ~~~~: troque a cerca do install.md');
dwrite('skills/figma-lite/install.md', `# Instalação do builder (modo remoto)

Copie o código entre as cercas \`~~~~\` exatamente como está, sem as cercas, como \`code\` de uma chamada \`use_figma\`. Ele grava o builder no arquivo aberto (dado do plugin "lite") e confere a cópia por hash.

~~~~js
${inst.trimEnd()}
~~~~
`);
dwrite('skills/ativar/SKILL.md', `---
name: ativar
description: Ativa o figma-lite nesta conversa no lugar das skills nativas da Figma e confere se o conector Figma está ligado.
disable-model-invocation: true
---

# Ativar o figma-lite nesta conversa

A partir de agora, **nesta conversa**, todo pedido que envolva o Figma ou um link figma.com segue a skill \`figma-lite\` deste plugin, no lugar das skills nativas da Figma (figma-use, figma-generate-design, figma-design-to-code). Não carregue nem sugira essas skills.

1. Veja se você tem a ferramenta \`use_figma\` (conector Figma). Esta versão usa o conector como transporte.
   - **Não tem:** peça pra ligar o conector **Figma** em Configurações → Conectores e voltar à conversa.
   - **Tem:** está pronto. Na primeira tela de cada arquivo a skill instala o builder, uma vez só.
2. Se existir o plugin \`figma\` com skills \`figma:*\`, pergunte (múltipla escolha, AskUserQuestion quando existir) se quer desativar só as skills/plugin oficiais, mantendo o conector: opções "Desativar as skills oficiais (recomendado)" e "Manter por enquanto".
3. Mencione em uma linha: ${FULL}

Responda em até 6 linhas, só com o que falta.
`);
dwrite('README.md', `# figma-mcp-lite (diretório)

Telas e componentes no Figma com o design system do próprio arquivo, gastando ~10x menos contexto: a tela inteira vai como um spec JSON numa chamada \`use_figma\` só.

Esta é a versão do diretório: só skills (Markdown), usando o **conector Figma** como transporte. Ligue o conector em Configurações → Conectores.

- \`/figma-mcp-lite:ativar\` confere se está tudo pronto.
- Peça a tela com o link do arquivo figma.com.

${FULL}

Código e documentação: https://github.com/AkiraZ1/figma-mcp-lite
`);

// Regras do diretório, conferidas aqui pra não descobrir na submissão.
const BAD = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    const rel = path.relative(DIR, p);
    if (e.isDirectory()) { if (e.name === 'hooks') BAD.push(rel + ': hooks'); walk(p); continue; }
    if (!/\.(md|txt|json|ya?ml|png|jpe?g|svg|gif|webp)$/i.test(e.name) && e.name !== 'LICENSE') BAD.push(rel + ': extensão');
    if (e.name === '.mcp.json') BAD.push(rel + ': servidor MCP');
    const buf = fs.readFileSync(p);
    if (buf[0] === 0x23 && buf[1] === 0x21) BAD.push(rel + ': começa com #!');
  }
})(DIR);
if (BAD.length) throw new Error('dist-directory fora das regras do diretório:\n' + BAD.join('\n'));
console.log(`dist-directory/ v${pkg.version}: ${Math.round(size(DIR) / 1024)} KB (só md/json/png)`);

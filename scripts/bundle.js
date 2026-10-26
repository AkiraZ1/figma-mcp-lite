#!/usr/bin/env node
// Gera os dois artefatos a partir de lib/builder.js:
//   plugin/code.js  — plugin local (modo janela), com o builder embutido
//   dist/remote.js  — builder minificado pro use_figma do MCP oficial (modo remoto)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { version } = JSON.parse(read('package.json'));
const builder = read('lib/builder.js').replace('__VERSION__', version);

fs.writeFileSync(path.join(ROOT, 'plugin/code.js'),
  '// GERADO por scripts/bundle.js a partir de plugin/code.src.js + lib/builder.js — não edite.\n' +
  read('plugin/code.src.js').replace('/*@BUILDER@*/', () => builder)); // função: o fonte tem "$'", que replace() trataria como padrão

// plugin-dev/: mesma coisa com o id do plugin de DESENVOLVIMENTO (gerado pelo
// Figma na importação, package.json "figmaDevPluginId") em vez do id do
// plugin publicado na Community.
const DEV = path.join(ROOT, 'plugin-dev');
fs.mkdirSync(DEV, { recursive: true });
const { id, ...rest } = JSON.parse(read('plugin/manifest.json'));
const { figmaDevPluginId } = JSON.parse(read('package.json'));
const devManifest = { name: rest.name + ' (dev)', ...(figmaDevPluginId && { id: figmaDevPluginId }), ...rest, name: rest.name + ' (dev)' };
fs.writeFileSync(path.join(DEV, 'manifest.json'), JSON.stringify(devManifest, null, 2) + '\n');
for (const f of ['code.js', 'ui.html']) fs.copyFileSync(path.join(ROOT, 'plugin', f), path.join(DEV, f));

// No remoto o fonte vai embrulhado em String.raw na instalação: sem template
// literal no minificado, não sobra crase nem "${" pra quebrar o embrulho.
const { code } = transformSync(`var L=function(figma){${builder}\n};`, {
  minify: true, target: 'es2017', supported: { 'template-literal': false }, legalComments: 'none',
});
if (/[`]|\$\{/.test(code)) throw new Error('minificado tem crase ou ${ — a instalação via String.raw quebraria');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/remote.js'), code.trim());
console.log(`v${version}: plugin/code.js ok · dist/remote.js ${code.length} chars (~${Math.round(code.length / 3.5)} tokens pra instalar)`);

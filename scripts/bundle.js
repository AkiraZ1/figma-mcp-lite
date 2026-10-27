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
const { id, name, ...rest } = JSON.parse(read('plugin/manifest.json'));
const { figmaDevPluginId } = JSON.parse(read('package.json'));
const devManifest = { name: name + ' (dev)', ...(figmaDevPluginId && { id: figmaDevPluginId }), ...rest };
fs.writeFileSync(path.join(DEV, 'manifest.json'), JSON.stringify(devManifest, null, 2) + '\n');
for (const f of ['code.js', 'ui.html']) fs.copyFileSync(path.join(ROOT, 'plugin', f), path.join(DEV, f));

// No remoto o fonte vai embrulhado em String.raw na instalação: sem template
// literal no minificado, não sobra crase nem "${" pra quebrar o embrulho.
const { code } = transformSync(`var L=function(figma){${builder}\n};`, {
  minify: true, target: 'es2017', supported: { 'template-literal': false }, legalComments: 'none',
  charset: 'utf8', // acentos literais, não \xE1: menos barra invertida pro modelo copiar
});
if (/[`]|\$\{/.test(code)) throw new Error('minificado tem crase ou ${ — a instalação via String.raw quebraria');
// Barra invertida é o que o modelo mais erra ao copiar o código (escape em JSON).
if (code.includes('\\')) throw new Error('minificado tem barra invertida: troque por equivalente sem barra em lib/builder.js');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const src = code.trim();
fs.writeFileSync(path.join(ROOT, 'dist/remote.js'), src);

// Código de instalação do modo remoto, colado pelo modelo num use_figma. A
// trava compara um hash do texto colado com o esperado: cópia corrompida não
// é gravada no arquivo (o modelo é avisado e repete).
let h = 0;
for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
fs.writeFileSync(path.join(ROOT, 'dist/install.js'),
  'const s=String.raw`' + src + '`;let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;' +
  "if(h!==" + h + ")return{erro:'cópia corrompida (' + s.length + ' de " + src.length + " caracteres): chame a instalação de novo e cole o código sem alterar nada'};" +
  "figma.root.setSharedPluginData('lite','lib',s);return{v:new Function(s+';return L')()(figma).v,len:s.length}\n");
console.log(`v${version}: plugin/code.js ok · dist/remote.js ${code.length} chars (~${Math.round(code.length / 3.5)} tokens pra instalar)`);

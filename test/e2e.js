// Teste ponta a ponta sem Figma: um "plugin" falso conecta no hub e responde.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocket } from 'ws';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = '3999';
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js');

async function mcp(env) {
  const c = new Client({ name: 'teste', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, FIGMA_LITE_PORT: PORT, ...env } }));
  return c;
}
const txt = (r) => r.content[0].text;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakePlugin(file = 'Arquivo Teste') {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: 'null' } });
  ws.on('open', () => ws.send(JSON.stringify({ hello: 'plugin', info: { file } })));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    const result = m.cmd === 'status' ? { file, page: 'P1', selection: [] }
      : m.cmd === 'edit' ? { edited: m.args.items.length, patched: Object.keys(m.args.items[0].patch).join(',') }
      : m.cmd === 'build' ? { id: '1:2', nodes: 3 }
      : m.cmd === 'variant' ? { id: '1:9', name: m.args.name, patched: Object.keys(m.args.patches || {}).length }
      : m.cmd === 'shot' ? 'iVBORw0KGgo='
      : m.cmd === 'inspect' ? 'FRAME "' + m.args.id + '" 10x10' : null;
    ws.send(JSON.stringify({ id: m.id, ok: true, result }));
  });
  return new Promise((r) => ws.on('open', () => r(ws)));
}

let ok = 0;
const check = (name, fn) => fn().then(() => { ok++; console.log('✔', name); });

const a = await mcp({ FIGMA_LITE_SUBAGENT: 'sonnet' });
await wait(300);

await check('sem plugin: erro claro depois da espera', async () => {
  const r = await a.callTool({ name: 'figma_status', arguments: {} });
  assert.ok(r.isError && txt(r).includes('Plugins → Development'), txt(r));
});

const plugin = await fakePlugin();
await wait(100);

await check('status pelo hub', async () => {
  assert.equal(JSON.parse(txt(await a.callTool({ name: 'figma_status', arguments: {} }))).file, 'Arquivo Teste');
});

await check('ferramentas e instruções enxutas', async () => {
  const { tools } = await a.listTools();
  assert.equal(tools.length, 12);
  const size = JSON.stringify(tools).length + a.getInstructions().length;
  console.log(`   (schemas + instruções ≈ ${Math.round(size / 4)} tokens)`);
  assert.ok(size < 8000);
});

const b = await mcp({});
await check('segunda sessão sem env: trava até informar modelo', async () => {
  const r = await b.callTool({ name: 'figma_edit', arguments: { id: '1:2', patch: { n: 'x' } } });
  assert.ok(r.isError && txt(r).includes('subagent_model'));
  await b.callTool({ name: 'figma_status', arguments: { subagent_model: 'gpt-x' } });
  assert.equal(JSON.parse(txt(await b.callTool({ name: 'figma_edit', arguments: { id: '1:2', patch: { n: 'x', fill: '$bg' } } }))).patched, 'n,fill');
});

await check('build repassa a spec', async () => {
  const r = await b.callTool({ name: 'figma_build', arguments: { spec: { frame: 'Tela', children: [] } } });
  assert.equal(JSON.parse(txt(r)).id, '1:2');
});

await check('origem de site é recusada', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: 'https://site-malicioso.com' } });
  const code = await new Promise((r) => ws.on('close', (c) => r(c)));
  assert.equal(code, 1008);
});

await check('dois arquivos abertos: exige escolher e roteia pelo nome', async () => {
  const outro = await fakePlugin('FCx Fonts 1.0.3');
  await wait(100);
  const r = await a.callTool({ name: 'figma_status', arguments: {} });
  assert.ok(r.isError && txt(r).includes('FCx Fonts 1.0.3'), txt(r));
  const f = JSON.parse(txt(await a.callTool({ name: 'figma_status', arguments: { file: 'fonts' } })));
  assert.equal(f.file, 'FCx Fonts 1.0.3');
  outro.close();
});

await check('instalação remota: grava só a cópia íntegra', async () => {
  const r = txt(await a.callTool({ name: 'figma_lite_install', arguments: {} }));
  const code = r.split('\n').slice(1).join('\n');
  const AF = Object.getPrototypeOf(async function () {}).constructor;
  const run = async (c) => {
    const store = {};
    const fakeFigma = { root: { setSharedPluginData: (ns, k, v) => { store[k] = v; }, getSharedPluginData: (ns, k) => store[k] || '' } };
    return { out: await new AF('figma', c)(fakeFigma), store };
  };
  const ok = await run(code);
  assert.ok(r.includes(`Versão ${ok.out.v}`), JSON.stringify(ok.out));
  assert.equal(ok.store.lib.length, ok.out.len);
  const bad = await run(code.replace('lastIndexOf', 'lastIndexOX'));
  assert.ok(bad.out.erro && !bad.store.lib, JSON.stringify(bad.out));
});

await check('lote: specs, variants, shots e inspect numa chamada cada', async () => {
  const b2 = JSON.parse(txt(await b.callTool({ name: 'figma_build', arguments: { specs: [{ spec: { frame: 'A' } }, { spec: { frame: 'B' } }] } })));
  assert.equal(b2.length, 2);
  const v = JSON.parse(txt(await b.callTool({ name: 'figma_variant', arguments: { source: 'A', variants: [{ name: 'A2', patches: { x: {} } }, { name: 'A3' }] } })));
  assert.deepEqual(v.map((x) => x.name), ['A2', 'A3']);
  const sh = await b.callTool({ name: 'figma_shot', arguments: { ids: ['1:2', '1:3'] } });
  assert.equal(sh.content.filter((c) => c.type === 'image').length, 2);
  assert.equal(txt(await b.callTool({ name: 'figma_inspect', arguments: { ids: ['1:2', '1:3'] } })).split('\n').length, 2);
});

await check('orçamento de tokens (quebra se crescer)', async () => {
  const { tools } = await a.listTools();
  const fixed = Math.round((JSON.stringify(tools).length + a.getInstructions().length) / 4);
  assert.ok(fixed < 1400, `ferramentas + instruções: ${fixed} tokens`);
  for (const t of ['svg', 'img', 'draw', 'anim', 'component', 'inspect']) {
    const h = txt(await a.callTool({ name: 'figma_help', arguments: { topic: t } }));
    assert.ok(h.length / 4 < 300, `help ${t}: ${Math.round(h.length / 4)} tokens`);
  }
  const multi = txt(await a.callTool({ name: 'figma_help', arguments: { topic: 'anim,draw' } }));
  assert.ok(multi.includes('[anim]') && multi.includes('[draw]'));
  const fs = await import('node:fs');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const prompt = fs.readFileSync(path.join(root, 'agents/prompt.md'), 'utf8') + fs.readFileSync(path.join(root, 'agents/spec.md'), 'utf8');
  assert.ok(prompt.length < 2600, `prompt + spec: ${prompt.length} caracteres`);
  console.log(`   (fixo: ${fixed} tokens · prompt+spec: ${prompt.length} caracteres)`);
});

plugin.close();
await a.close();
await b.close();
console.log(`\n${ok}/10 ok`);
process.exit(ok === 10 ? 0 : 1);

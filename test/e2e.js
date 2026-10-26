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
      : m.cmd === 'edit' ? { id: m.args.id, patched: Object.keys(m.args.patch).join(',') }
      : m.cmd === 'build' ? { id: '1:2', nodes: 3 } : null;
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
  assert.equal(tools.length, 7);
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

await check('instalação remota: código colado roda e devolve versão/tamanho', async () => {
  const r = txt(await a.callTool({ name: 'figma_lite_install', arguments: {} }));
  const code = r.split('\n').slice(1).join('\n');
  const store = {};
  const fakeFigma = { root: { setSharedPluginData: (ns, k, v) => { store[k] = v; }, getSharedPluginData: (ns, k) => store[k] || '' } };
  const AF = Object.getPrototypeOf(async function () {}).constructor;
  const out = await new AF('figma', code)(fakeFigma);
  assert.ok(r.includes(`"len":${out.len}`) && r.includes(`"v":"${out.v}"`), JSON.stringify(out));
  assert.equal(store.lib.length, out.len);
});

plugin.close();
await a.close();
await b.close();
console.log(`\n${ok}/8 ok`);
process.exit(ok === 8 ? 0 : 1);

// Testa a lógica do builder (lib/builder.js) contra um Figma simulado: o
// suficiente da Plugin API pra build, edit, variant e link rodarem sem o app.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'lib/builder.js'), 'utf8').replace('__VERSION__', 'test');

let seq = 0;
const nodes = new Map();
function node(type, extra = {}) {
  const n = {
    id: `1:${++seq}`, type, name: type === 'RECTANGLE' ? 'Rectangle' : type === 'ELLIPSE' ? 'Ellipse' : type, x: 0, y: 0, width: 100, height: 100,
    fills: [], strokes: [], opacity: 1, children: [], parent: null, reactions: [], removed: false,
    resize(w, h) { this.width = w; this.height = h; },
    appendChild(c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = this; this.children.push(c); },
    insertChild(i, c) { this.appendChild(c); },
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.removed = true; },
    findAll(fn) { const out = []; const walk = (n) => n.children.forEach((c) => { if (fn(c)) out.push(c); walk(c); }); walk(this); return out; },
    findAllWithCriteria() { return []; },
    async setReactionsAsync(r) { this.reactions = r; },
    clone() {
      const c = node(this.type, {});
      for (const k of ['name', 'x', 'y', 'width', 'height', 'layoutMode', 'characters', 'opacity']) c[k] = this[k];
      this.children.forEach((ch) => c.appendChild(ch.clone()));
      if (this.parent) this.parent.appendChild(c); // como na Figma: a cópia fica no mesmo pai
      return c;
    },
    ...extra,
  };
  nodes.set(n.id, n);
  return n;
}
const page = node('PAGE', { name: 'Page 1' });
const store = {};
const figma = {
  root: { getSharedPluginData: (ns, k) => store[k] || '', setSharedPluginData: (ns, k, v) => { store[k] = v; } },
  currentPage: page,
  viewport: { scrollAndZoomIntoView() {} },
  mixed: Symbol('mixed'),
  createFrame: () => { const f = node('FRAME', { layoutMode: 'NONE' }); page.appendChild(f); return f; },
  createRectangle: () => node('RECTANGLE'),
  createEllipse: () => node('ELLIPSE'),
  createText: () => node('TEXT', { characters: '', fontName: { family: 'Inter', style: 'Regular' }, textAutoResize: 'WIDTH_AND_HEIGHT' }),
  loadFontAsync: async () => {},
  getNodeByIdAsync: async (id) => nodes.get(id) || null,
  variables: { getLocalVariableCollectionsAsync: async () => [], getLocalVariablesAsync: async () => [] },
  teamLibrary: { getAvailableLibraryVariableCollectionsAsync: async () => [] },
  getLocalTextStylesAsync: async () => [],
  getLocalEffectStylesAsync: async () => [],
};
const L = new Function('figma', src)(figma);

let ok = 0;
const check = async (name, fn) => { await fn(); ok++; console.log('✔', name); };
const byName = (root, name) => root.findAll((n) => n.name === name)[0];

const built = await L.build({
  frame: 'Universo 1', w: 1440, h: 900, layout: 'none', def: { abs: true, stroke: '#FFFFFF', sw: 1 }, children: [
    { rect: '', n: 'Star 1', w: 2, h: 2 },
    { ellipse: 'Sol', d: 70 },
    { scatter: 'Stars', count: 5, seed: 7, size: [1, 3], o: [0.3, 1], shift: -30 },
    { frame: 'Conteudo', layout: 'V', w: 400, children: [{ text: 'Um texto bem longo que precisa quebrar' }] },
  ],
}, null);
const tela = nodes.get(built.id);

await check('n sempre dá o nome (rect "" vira "Star 1")', async () => assert.ok(byName(tela, 'Star 1')));
await check('ellipse com d vira círculo', async () => { const s = byName(tela, 'Sol'); assert.equal(s.type, 'ELLIPSE'); assert.equal(s.width, 70); assert.equal(s.height, 70); });
await check('def aplica nos filhos diretos', async () => assert.equal(byName(tela, 'Sol').strokes.length, 1));
await check('texto em coluna de largura fixa ocupa a largura', async () => {
  const t = byName(tela, 'Um texto bem longo que precisa');
  assert.equal(t.layoutSizingHorizontal, 'FILL');
  assert.equal(t.textAutoResize, 'HEIGHT');
});
await check('scatter determinístico e com nomes Star N', async () => {
  const box = byName(tela, 'Stars');
  assert.equal(box.children.length, 5);
  assert.deepEqual(box.children.map((c) => c.name), ['Star 1', 'Star 2', 'Star 3', 'Star 4', 'Star 5']);
  const again = await L.build({ frame: 'B', w: 1440, h: 900, layout: 'none', children: [{ scatter: 'Stars', count: 5, seed: 7, size: [1, 3], shift: -30 }] }, null);
  const box2 = byName(nodes.get(again.id), 'Stars');
  assert.deepEqual(box2.children.map((c) => Math.round(c.x)), box.children.map((c) => Math.round(c.x)));
});
await check('edit em lote por path com *', async () => {
  const r = await L.edit([{ path: 'Universo 1/Conteudo/*', patch: { o: 0.5 } }, { path: 'Universo 1/Sol', patch: { x: 900 } }]);
  assert.equal(r.edited, 2);
  assert.equal(byName(tela, 'Sol').x, 900);
});
await check('curinga dentro do nome ("Universo *") e parent por nome', async () => {
  const r = await L.edit([{ path: 'Universo */Sol', patch: { y: 10 } }]);
  assert.equal(r.edited, 1);
  const b = await L.build({ rect: 'Extra', w: 4, h: 4 }, 'Universo 1');
  assert.equal(nodes.get(b.id).parent.name, 'Universo 1');
});
await check('locate lista caminhos que casam com o padrão', async () => {
  const out = await L.locate('Universo */So*');
  assert.ok(out.includes('Universo 1/Sol'), out);
});
await check('keyframe *_XY vira vetor', async () => {
  let got = null;
  const sol = byName(tela, 'Sol');
  sol.applyManualKeyframeTrack = (f, t) => { got = t; };
  sol.timelines = [];
  await L.edit([{ path: 'Universo 1/Sol', patch: { anim: { keys: { SCALE_XY: [[0, 1], [1, 1.06]] } } } }]);
  assert.deepEqual(got.keyframes[1].value, { type: 'VECTOR', value: { x: 1.06, y: 1.06 } });
});
await check('variant clona e aplica patches por nome', async () => {
  const r = await L.variant('Universo 1', { name: 'Universo 2', patches: { Sol: { x: 100 }, 'Conteudo/*': { o: 1 }, Nada: { x: 1 } } });
  const v = nodes.get(r.id);
  assert.equal(v.name, 'Universo 2');
  assert.equal(byName(v, 'Sol').x, 100);
  assert.equal(byName(tela, 'Sol').x, 900, 'original intacto');
  assert.ok(r.warn.some((w) => w.includes('Nada')));
  assert.ok(v.x > tela.x, 'posicionada à direita');
});
await check('variant em lote cria várias telas numa chamada', async () => {
  const r = await L.variant('Universo 1', { variants: [{ name: 'U3', patches: { Sol: { x: 300 } } }, { name: 'U4', patches: { Sol: { x: 500 } } }] });
  assert.equal(r.created.length, 2);
  assert.equal(byName(nodes.get(r.created[1].id), 'Sol').x, 500);
  assert.ok(nodes.get(r.created[1].id).x > nodes.get(r.created[0].id).x, 'lado a lado');
});
await check('link liga telas com Smart Animate', async () => {
  const r = await L.link([{ from: 'Universo 1', to: 'Universo 2', trigger: 'delay', ms: 800, animation: 'smart' }]);
  assert.equal(r.linked, 1);
  const re = tela.reactions[0];
  assert.equal(re.trigger.type, 'AFTER_TIMEOUT');
  assert.equal(re.actions[0].transition.type, 'SMART_ANIMATE');
  assert.equal(re.actions[0].destinationId, byName(page, 'Universo 2').id);
});
await check('spec antiga (0.5.x) continua funcionando', async () => {
  const r = await L.build({ frame: 'Login', w: 390, gap: 16, pad: [48, 24], children: [{ text: 'Entrar', size: 28, weight: 700 }, { rect: 'Divisor', w: 'fill', h: 1, fill: '#D9D9D9' }] }, null);
  assert.equal(r.nodes, 3);
  assert.ok(byName(nodes.get(r.id), 'Divisor'));
});

console.log(`\n${ok}/13 ok`);
process.exit(ok === 13 ? 0 : 1);

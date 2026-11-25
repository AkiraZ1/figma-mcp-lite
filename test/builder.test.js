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
    fills: [], strokes: [], opacity: 1, annotations: [], children: [], parent: null, reactions: [], removed: false,
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
const page2 = node('PAGE', { name: 'Handoff', async loadAsync() {} });
const store = {};
const cats = [{ id: 'c1', label: 'Development' }];
const figma = {
  root: {
    children: [page, page2],
    insertChild(i, p) { this.children.splice(this.children.indexOf(p), 1); this.children.splice(i, 0, p); },
    getSharedPluginData: (ns, k) => store[k] || '', setSharedPluginData: (ns, k, v) => { store[k] = v; },
  },
  currentPage: page,
  async setCurrentPageAsync(p) { this.currentPage = p; },
  annotations: {
    getAnnotationCategoriesAsync: async () => cats.slice(),
    addAnnotationCategoryAsync: async (c) => { const n = { id: 'c' + (cats.length + 1), label: c.label, color: c.color }; cats.push(n); return n; },
  },
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

await check('anotações: soma, categoria criada, props e troca', async () => {
  const sol = byName(tela, 'Sol');
  sol.annotations = [{ label: 'antiga', labelMarkdown: 'antiga' }];
  await L.edit('Universo 1/Sol', { note: { text: 'Raio **70**', cat: 'Medidas', props: ['w', 'gap'] } });
  assert.equal(sol.annotations.length, 2);
  assert.deepEqual(sol.annotations[0], { labelMarkdown: 'antiga' }, 'label e labelMarkdown não vão juntos');
  assert.deepEqual(sol.annotations[1].properties, [{ type: 'width' }, { type: 'itemSpacing' }]);
  assert.equal(sol.annotations[1].categoryId, cats.find((c) => c.label === 'Medidas').id);
  await L.edit('Universo 1/Sol', { notes: 'só esta' });
  assert.deepEqual(sol.annotations, [{ labelMarkdown: 'só esta' }]);
  await L.edit('Universo 1/Sol', { note: false });
  assert.equal(sol.annotations.length, 0);
});
await check('detach desanexa instância (e as de dentro com "all")', async () => {
  const mk = (name) => node('INSTANCE', { name, detachInstance() { const f = node('FRAME', { name: this.name, layoutMode: 'NONE' }); this.children.slice().forEach((c) => f.appendChild(c)); this.parent.appendChild(f); this.remove(); return f; } });
  const box = node('FRAME', { name: 'Caixa', layoutMode: 'NONE' }); tela.appendChild(box);
  const inst = mk('Botão'); box.appendChild(inst); inst.appendChild(mk('Ícone'));
  const r = await L.edit(inst.id, { detach: 'all', n: 'Botão solto' });
  assert.equal(r.detached, 2);
  const solto = nodes.get(r.id);
  assert.equal(solto.type, 'FRAME'); assert.equal(solto.name, 'Botão solto');
  assert.equal(box.findAll((n) => n.type === 'INSTANCE').length, 0);
  const w = await L.edit(box.id, { detach: true });
  assert.ok(w.warn.some((x) => x.includes('não é instância')));
});
await check('páginas: ordem, frames em ordem de leitura, go e move', async () => {
  const a = node('FRAME', { name: 'B', x: 500, y: 0, height: 100 }); const c = node('FRAME', { name: 'A', x: 0, y: 10, height: 100 }); const d = node('FRAME', { name: 'C', x: 0, y: 400, height: 100 });
  [a, c, d].forEach((n) => page2.appendChild(n));
  const out = await L.pages({ frames: true });
  const lines = out.split('\n');
  assert.ok(lines[0].startsWith('1. ') && lines[0].includes('← atual'));
  const h = lines.findIndex((l) => l.includes('"Handoff"'));
  assert.deepEqual(lines.slice(h + 1, h + 4).map((l) => l.split('"')[1]), ['A', 'B', 'C']);
  await L.pages({ go: 'Handoff', move: { page: 'Handoff', index: 0 } });
  assert.equal(figma.root.children[0], page2);
  assert.equal(figma.currentPage, page2);
  figma.currentPage = page;
});
await check('note na spec do build', async () => {
  const r = await L.build({ frame: 'Com nota', note: 'Handoff: usar token', children: [] }, null);
  assert.deepEqual(nodes.get(r.id).annotations, [{ labelMarkdown: 'Handoff: usar token' }]);
});

console.log(`\n${ok}/17 ok`);
process.exit(ok === 17 ? 0 : 1);

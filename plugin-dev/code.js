// GERADO por scripts/bundle.js a partir de plugin/code.src.js + lib/builder.js — não edite.
// figma-mcp-lite — lado do Figma. Recebe comandos da ui.html (que fala com o
// hub local) e devolve respostas PEQUENAS: cada byte daqui vira token do agente.
// Sintaxe conservadora (sem ?. / ?? / spread de objeto): o sandbox de plugin
// nem sempre acompanha o JS mais novo.

// Roda em segundo plano: a ui.html fica invisível (só segura o WebSocket) e o
// estado aparece numa notificação fixa no rodapé, com botão pra parar.
figma.showUI(__html__, { visible: false });
figma.ui.postMessage({ info: { file: figma.root.name } });

// Botão "Conectar figma-mcp-lite" no painel da direita deste arquivo (aparece
// sem nada selecionado): na próxima vez, abrir o arquivo e clicar. A Figma não
// deixa plugin abrir sozinho junto com o arquivo. Em Dev Mode (só leitura) não grava.
try { figma.root.setRelaunchData({ open: 'Liga a ponte do figma-mcp-lite com o Claude neste arquivo' }); } catch (e) { /* sem permissão de edição */ }

let note = null;
let lastState = '';
function showState(state) {
  if (state === lastState) return;
  lastState = state;
  if (note) note.cancel();
  note = figma.notify('figma-mcp-lite · ' + state, {
    timeout: Infinity,
    button: { text: 'Parar', action: function () { figma.closePlugin(); } },
  });
}
showState('aguardando o agente');

figma.ui.onmessage = async function (msg) {
  if (msg.state) { showState(msg.state); return; }
  const t0 = Date.now();
  let res;
  try {
    const handler = HANDLERS[msg.cmd];
    if (!handler) throw new Error('comando desconhecido: ' + msg.cmd);
    // Dev Mode (arquivo só de visualização) é leitura: status, ds, tree, shot, docs.
    if (figma.editorType === 'dev' && (msg.cmd === 'build' || msg.cmd === 'edit')) {
      throw new Error('Dev Mode é só leitura: ' + msg.cmd + ' precisa de um arquivo com edição aberto no modo Design');
    }
    res = { id: msg.id, ok: true, result: await handler(msg.args || {}) };
  } catch (e) {
    res = { id: msg.id, ok: false, error: String((e && e.message) || e) };
  }
  res.ms = Date.now() - t0;
  figma.ui.postMessage(res);
};

// ─── utilidades ──────────────────────────────────────────────────────────────

function rgbToHex(c) {
  const to = function (v) { return Math.round(v * 255).toString(16).padStart(2, '0'); };
  let s = '#' + to(c.r) + to(c.g) + to(c.b);
  if (c.a !== undefined && c.a < 1) s += to(c.a);
  return s.toUpperCase();
}

function brief(n) {
  const b = { id: n.id, type: n.type, name: n.name };
  if ('x' in n) { b.x = Math.round(n.x); b.y = Math.round(n.y); }
  return b;
}

async function nodeOrThrow(id) {
  const n = await figma.getNodeByIdAsync(id);
  if (!n) throw new Error('nó não encontrado: ' + id);
  return n;
}

// Builder compartilhado (lib/builder.js), embutido aqui pelo scripts/bundle.js.
const LITE = (function (figma) {
// figma-mcp-lite — builder compartilhado. É o CORPO de uma função
// `new Function('figma', src)` e devolve a API { v, build, reindex }.
// Roda em dois lugares: no plugin local (modo janela) e dentro do use_figma do
// MCP oficial (modo remoto, guardado em sharedPluginData do arquivo).
// Regras pra continuar rodando no use_figma: nada de clientStorage,
// setPluginData, loadAllPagesAsync nem fetch; sem crase nem "${" no fonte
// (a instalação embrulha o código minificado em String.raw).

var V = '0.5.3';
var NS = 'lite';
// Sem barra invertida no fonte: a instalação remota é copiada pelo modelo,
// e barras são o que ele mais erra ao escapar. Daí o NL e nada de regex com \.
// (via map: o esbuild dobraria String.fromCharCode(10) de volta pra "\n")
var NL = [10].map(function (c) { return String.fromCharCode(c); })[0];
var ALIGN = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN', baseline: 'BASELINE' };
var WEIGHT = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };

function hexToRgb(hex) {
  var h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
  var n = parseInt(h.slice(0, 6), 16);
  var a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: a };
}

// ─── índice dos tokens, guardado no próprio arquivo ──────────────────────────

var IDX = null;
function readIdx() {
  try { return JSON.parse(figma.root.getSharedPluginData(NS, 'idx')); } catch (e) { return null; }
}

// Nome → id (local) ou key (biblioteca). Só nomes e chaves: importar a
// variável fica pra hora do uso, pra o índice sair rápido.
async function reindex() {
  var idx = { vars: {}, text: {}, effect: {}, comps: {} };
  var prefer = function (cur, col) {
    // Nome repetido em coleções diferentes: fica com a semântica, não a primitiva.
    return !cur || (/primit/i.test(cur.col || '') && !/primit/i.test(col));
  };
  var cols = await figma.variables.getLocalVariableCollectionsAsync();
  var colName = {};
  cols.forEach(function (c) { colName[c.id] = c.name; });
  (await figma.variables.getLocalVariablesAsync()).forEach(function (v) {
    var k = v.name.toLowerCase();
    var col = colName[v.variableCollectionId] || '';
    if (prefer(idx.vars[k], col)) idx.vars[k] = { id: v.id, col: col };
  });
  try {
    var libCols = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    for (var i = 0; i < libCols.length; i++) {
      var lc = libCols[i];
      (await figma.teamLibrary.getVariablesInLibraryCollectionAsync(lc.key)).forEach(function (v) {
        var k = v.name.toLowerCase();
        if (prefer(idx.vars[k], lc.name)) idx.vars[k] = { key: v.key, col: lc.name };
      });
    }
  } catch (e) { /* sem team library */ }
  (await figma.getLocalTextStylesAsync()).forEach(function (s) { idx.text[s.name.toLowerCase()] = { id: s.id, key: s.key }; });
  (await figma.getLocalEffectStylesAsync()).forEach(function (s) { idx.effect[s.name.toLowerCase()] = { id: s.id, key: s.key }; });
  figma.currentPage.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }).forEach(function (n) {
    if (n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') return;
    idx.comps[n.name.toLowerCase()] = { key: n.key, id: n.id, set: n.type === 'COMPONENT_SET' };
  });
  IDX = idx;
  try { figma.root.setSharedPluginData(NS, 'idx', JSON.stringify(idx)); } catch (e) { /* Dev Mode: só leitura */ }
  return { vars: Object.keys(idx.vars).length, text: Object.keys(idx.text).length, comps: Object.keys(idx.comps).length };
}

async function index() {
  if (!IDX) IDX = readIdx();
  if (!IDX) await reindex();
  return IDX;
}

function lookup(map, name) {
  if (!name) return null;
  var n = String(name);
  if (n.charAt(0) === '$') n = n.slice(1);
  return map[n.toLowerCase()] || null;
}

var varCache = {};
async function getVar(name) {
  // "$#<chave>": variável de biblioteca NÃO habilitada no arquivo, achada pela
  // busca oficial (search_design_system). Importa direto pela chave.
  var ref = String(name);
  if (ref.charAt(0) === '$') ref = ref.slice(1);
  if (ref.charAt(0) === '#' && /^[0-9a-f]{20,}$/i.test(ref.slice(1))) {
    ref = ref.slice(1);
    if (!varCache[ref]) varCache[ref] = await figma.variables.importVariableByKeyAsync(ref);
    return varCache[ref];
  }
  var e = lookup((await index()).vars, name);
  if (!e) return null;
  var k = e.id || e.key;
  if (!varCache[k]) varCache[k] = e.id ? await figma.variables.getVariableByIdAsync(e.id) : await figma.variables.importVariableByKeyAsync(e.key);
  return varCache[k];
}

async function getStyle(map, name) {
  var e = lookup((await index())[map], name);
  if (!e) return null;
  if (e.id) {
    var s = await figma.getStyleByIdAsync(e.id);
    if (s) return s;
  }
  return e.key ? figma.importStyleByKeyAsync(e.key) : null;
}

// ─── catálogo: tudo que o designer tem à mão neste arquivo ──────────────────
// Variáveis locais + de todas as bibliotecas habilitadas (valor resolvido e 1ª
// frase da descrição de uso), estilos e componentes (locais e de biblioteca já
// usados em instâncias). Escaneia uma vez e guarda no arquivo ('cat').

function rgbToHex(c) {
  var to = function (v) { return ('0' + Math.round(v * 255).toString(16)).slice(-2); };
  var s = '#' + to(c.r) + to(c.g) + to(c.b);
  if (c.a !== undefined && c.a < 1) s += to(c.a);
  return s.toUpperCase();
}

function fmtVal(v) {
  if (v && typeof v === 'object' && 'r' in v) return rgbToHex(v);
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  return String(v);
}

// 1ª frase da descrição (até o primeiro ponto final seguido de espaço, depois
// de pelo menos 15 caracteres), sem a cauda de palavras-chave que alguns DS anexam.
function firstSentence(d) {
  if (!d) return '';
  d = d.split(NL).join(' ').split('  ').join(' ').trim();
  var end = -1;
  for (var i = 15; i < d.length - 1; i++) {
    var c = d.charAt(i);
    if ((c === '.' || c === '!' || c === '?') && d.charAt(i + 1) === ' ') { end = i; break; }
  }
  if (end > 0) d = d.slice(0, end);
  if (d.charAt(d.length - 1) === '.') d = d.slice(0, -1);
  return d.length > 90 ? d.slice(0, 88) + '…' : d;
}

async function scan() {
  var cat = { vars: [], styles: [], comps: [], skipped: [] };
  var probe = figma.createFrame();
  try {
    var cols = await figma.variables.getLocalVariableCollectionsAsync();
    var colName = {};
    cols.forEach(function (c) { colName[c.id] = c.name; });
    (await figma.variables.getLocalVariablesAsync()).forEach(function (v) {
      if (v.hiddenFromPublishing) return;
      var val = '?';
      try { val = fmtVal(v.resolveForConsumer(probe).value); } catch (e) { /* sem modo */ }
      cat.vars.push(['arquivo: ' + (colName[v.variableCollectionId] || ''), v.name, val, firstSentence(v.description)]);
    });
    try {
      var libCols = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
      for (var i = 0; i < libCols.length; i++) {
        var lc = libCols[i];
        var lvs = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(lc.key);
        for (var j = 0; j < lvs.length; j += 25) {
          var chunk = await Promise.all(lvs.slice(j, j + 25).map(function (lv) {
            return figma.variables.importVariableByKeyAsync(lv.key).catch(function () { return null; });
          }));
          chunk.forEach(function (v, k) {
            var val = '?';
            try { if (v) val = fmtVal(v.resolveForConsumer(probe).value); } catch (e) { /* sem modo */ }
            cat.vars.push([lc.libraryName + ': ' + lc.name, lvs[j + k].name, val, v ? firstSentence(v.description) : '']);
          });
        }
      }
    } catch (e) { /* sem team library */ }
  } finally { probe.remove(); }

  (await figma.getLocalTextStylesAsync()).forEach(function (s) {
    cat.styles.push('texto ' + s.name + ' · ' + s.fontName.family + ' ' + s.fontName.style + ' ' + s.fontSize);
  });
  (await figma.getLocalEffectStylesAsync()).forEach(function (s) { cat.styles.push('efeito ' + s.name); });

  // Componentes: página a página (o use_figma não deixa carregar todas de uma vez).
  var seen = {};
  var describe = function (node, lib) {
    var set = node.parent && node.parent.type === 'COMPONENT_SET' ? node.parent : null;
    var owner = set || node;
    if (seen[owner.key]) return;
    seen[owner.key] = 1;
    // Component set com erro (variantes conflitando etc.) faz a API lançar
    // exceção: pula só ele e conta no catálogo, sem derrubar o resto.
    var props = [];
    try {
      var defs = owner.componentPropertyDefinitions || {};
      props = Object.keys(defs).map(function (k) {
        var d = defs[k];
        return k.split('#')[0] + (d.type === 'VARIANT' ? '=' + d.variantOptions.join('|') : '(' + d.type.toLowerCase() + ')');
      });
    } catch (e) {
      var msg = String((e && e.message) || e);
      if (msg.indexOf('in ') === 0 && msg.indexOf(': ') > 0) msg = msg.slice(msg.indexOf(': ') + 2);
      cat.skipped.push(owner.name + ' (' + owner.id + '): ' + msg);
      return;
    }
    cat.comps.push(owner.name + (lib ? ' [lib]' : '') + ' · ref ' + owner.key + (props.length ? ' · ' + props.join(', ') : ''));
  };
  for (var p = 0; p < figma.root.children.length && cat.comps.length < 300; p++) {
    var page = figma.root.children[p];
    try { await page.loadAsync(); } catch (e) { continue; }
    page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }).forEach(function (n) {
      if (n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') return;
      describe(n, false);
    });
    var insts = page.findAllWithCriteria({ types: ['INSTANCE'] }).slice(0, 1500);
    for (var q = 0; q < insts.length; q++) {
      var main = null;
      try { main = await insts[q].getMainComponentAsync(); } catch (e) { continue; }
      if (main && main.remote) describe(main, true);
    }
  }
  return cat;
}

// Grupo grande (2 primeiros níveis do nome, ex. "bg/accent", com mais de 6
// variáveis) que o filtro não pediu pelo nome vira uma linha só, com os
// nomes e sem valores. Mantém o catálogo curto sem saber nada do DS: pra ver
// os valores, o agente pede o grupo no filtro ("bg/accent").
// "$a/b/c… resto" → { group: "a/b", rest: "c…" } (só nomes com 3+ níveis).
function splitVar(l) {
  if (l.charAt(0) !== '$') return null;
  var sp = l.indexOf(' ');
  var parts = l.slice(1, sp < 0 ? l.length : sp).split('/');
  if (parts.length < 3) return null;
  return { group: parts[0] + '/' + parts[1], rest: parts.slice(2).join('/') };
}

function collapse(lines, fs) {
  var groups = {};
  lines.forEach(function (l) {
    var v = splitVar(l);
    if (v) (groups[v.group] = groups[v.group] || []).push(v.rest);
  });
  var big = {};
  Object.keys(groups).forEach(function (g) {
    var asked = fs.some(function (f) { return f.indexOf(g.toLowerCase()) >= 0; });
    if (groups[g].length > 6 && !asked) big[g] = true;
  });
  var out = [];
  var done = {};
  lines.forEach(function (l) {
    var v = splitVar(l);
    if (!v || !big[v.group]) { out.push(l); return; }
    if (done[v.group]) return;
    done[v.group] = true;
    out.push('$' + v.group + '/… (' + groups[v.group].length + ', valores com filter "' + v.group + '"): ' + groups[v.group].join(' '));
  });
  return out;
}

// Saída compacta: agrupada por coleção; props tipográficas de um mesmo prefixo
// (…/font-size, …/line-height…) viram uma linha "type <prefixo>: …".
var TYPE_PROPS = ['font-size', 'line-height', 'font-weight', 'font-weight-emphasis', 'letter-spacing', 'font-family'];

function fmtCatalog(cat, filter) {
  var fs = (filter || '').toLowerCase().split('|').map(function (x) { return x.trim(); }).filter(Boolean);
  var keep = function (l) { return !fs.length || fs.some(function (f) { return l.toLowerCase().indexOf(f) >= 0; }); };
  var out = [];
  var groups = {};
  var order = [];
  cat.vars.forEach(function (r) {
    if (!groups[r[0]]) { groups[r[0]] = []; order.push(r[0]); }
    groups[r[0]].push(r);
  });
  order.forEach(function (g) {
    var lines = [];
    var types = {};
    var typeOrder = [];
    groups[g].forEach(function (r) {
      var cut = r[1].lastIndexOf('/');
      var m = cut > 0 && TYPE_PROPS.indexOf(r[1].slice(cut + 1)) >= 0 ? [null, r[1].slice(0, cut), r[1].slice(cut + 1)] : null;
      if (m && m[1].indexOf('/') >= 0) {
        if (!types[m[1]]) { types[m[1]] = []; typeOrder.push(m[1]); }
        types[m[1]].push(m[2].replace('font-', '').replace('letter-spacing', 'ls%').replace('line-height', 'lh') + ' ' + r[2]);
        return;
      }
      lines.push('$' + r[1] + ' ' + r[2] + (r[3] ? ' · ' + r[3] : ''));
    });
    typeOrder.forEach(function (t) { lines.push('type ' + t + ': ' + types[t].join(', ')); });
    lines = collapse(lines.filter(keep), fs);
    if (lines.length) out.push('## ' + g + NL + lines.join(NL));
  });
  var st = cat.styles.filter(keep);
  if (st.length) out.push('## Estilos' + NL + st.join(NL));
  var cp = cat.comps.filter(keep);
  if (cp.length) out.push('## Componentes (inst: nome ou ref)' + NL + cp.join(NL));
  if (cat.skipped && cat.skipped.length) out.push('## Componentes pulados (com erro no Figma; corrija e rode refresh)' + NL + cat.skipped.join(NL));
  return out.join(NL) || 'nada no catálogo com esse filtro';
}

async function catalog(o) {
  o = o || {};
  var cat = null;
  if (!o.refresh) { try { cat = JSON.parse(figma.root.getSharedPluginData(NS, 'cat')); } catch (e) { cat = null; } }
  if (!cat) {
    cat = await scan();
    try { figma.root.setSharedPluginData(NS, 'cat', JSON.stringify(cat)); } catch (e) { /* Dev Mode */ }
    await reindex();
  }
  return fmtCatalog(cat, o.filter);
}

// ─── builder: spec JSON → nós ────────────────────────────────────────────────

function Builder() {
  this.warn = [];
  this.count = 0;
}

Builder.prototype.w = function (m) { if (this.warn.length < 15) this.warn.push(m); };

Builder.prototype.paint = async function (color) {
  if (typeof color !== 'string') return null;
  if (color[0] === '$') {
    var v = await getVar(color);
    if (!v) { this.w('variável não achada: ' + color); return null; }
    return figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', v);
  }
  var c = hexToRgb(color);
  return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
};

// Número ou "$variável" num campo numérico (gap, padding, raio...).
Builder.prototype.num = async function (node, field, val) {
  if (val === undefined || val === null) return;
  if (typeof val === 'string' && val[0] === '$') {
    var v = await getVar(val);
    if (!v) return this.w('variável não achada: ' + val);
    node.setBoundVariable(field, v);
    return;
  }
  node[field] = val;
};

Builder.prototype.common = async function (node, s) {
  if (s.fill !== undefined) { var p = await this.paint(s.fill); node.fills = p ? [p] : []; }
  if (s.stroke) {
    var ps = await this.paint(s.stroke);
    if (ps) { node.strokes = [ps]; await this.num(node, 'strokeWeight', s.sw || 1); }
  }
  if (s.r !== undefined) {
    var fields = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];
    for (var i = 0; i < fields.length; i++) await this.num(node, fields[i], s.r);
  }
  if (s.o !== undefined) node.opacity = s.o;
  if (s.effect) {
    var st = await getStyle('effect', s.effect);
    if (st) await node.setEffectStyleIdAsync(st.id); else this.w('efeito não achado: ' + s.effect);
  }
  if (s.clip !== undefined && 'clipsContent' in node) node.clipsContent = !!s.clip;
};

// Tamanho depois de o nó estar no pai: FILL/HUG só valem dentro de auto layout.
// Número fixo ou "$token" (ex.: h:"$border/minimal" num divisor).
Builder.prototype.size = async function (node, s, parent) {
  var self = this;
  var auto = parent && parent.layoutMode && parent.layoutMode !== 'NONE';
  var ax = async function (val, dim) {
    var prop = dim === 'w' ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
    if (val === 'fill') { if (auto) node[prop] = 'FILL'; return; }
    if (val === 'hug') { if (node.type === 'TEXT' || (node.layoutMode && node.layoutMode !== 'NONE')) node[prop] = 'HUG'; return; }
    var v = null;
    if (typeof val === 'string' && val[0] === '$') {
      v = await getVar(val);
      if (!v) return self.w('variável não achada: ' + val);
      val = Number(v.resolveForConsumer(node).value);
    }
    if (typeof val === 'number') {
      if (dim === 'w') node.resize(val, node.height); else node.resize(node.width, val);
      if (auto || (node.layoutMode && node.layoutMode !== 'NONE')) node[prop] = 'FIXED';
      if (v) node.setBoundVariable(dim === 'w' ? 'width' : 'height', v);
    }
  };
  await ax(s.w, 'w');
  await ax(s.h, 'h');
  if (s.abs && auto) node.layoutPositioning = 'ABSOLUTE';
  if (s.x !== undefined) node.x = s.x;
  if (s.y !== undefined) node.y = s.y;
};

Builder.prototype.frame = async function (s) {
  var f = figma.createFrame();
  f.name = s.frame;
  f.fills = [];
  var layout = s.layout === undefined ? 'V' : s.layout;
  if (layout !== 'none') {
    f.layoutMode = layout === 'H' ? 'HORIZONTAL' : 'VERTICAL';
    f.layoutSizingHorizontal = 'HUG';
    f.layoutSizingVertical = 'HUG';
    if (s.wrap) f.layoutWrap = 'WRAP';
    await this.num(f, 'itemSpacing', s.gap);
    if (s.pad !== undefined) {
      var p = Array.isArray(s.pad) ? s.pad : [s.pad];
      var t = p[0], r = p.length > 1 ? p[1] : p[0], b = p.length > 2 ? p[2] : p[0], l = p.length > 3 ? p[3] : r;
      await this.num(f, 'paddingTop', t);
      await this.num(f, 'paddingRight', r);
      await this.num(f, 'paddingBottom', b);
      await this.num(f, 'paddingLeft', l);
    }
    if (s.align) f.primaryAxisAlignItems = ALIGN[s.align] || 'MIN';
    if (s.cross) f.counterAxisAlignItems = ALIGN[s.cross] || 'MIN';
  }
  await this.common(f, s);
  return f;
};

// Papel tipográfico por variáveis, pra qualquer DS que agrupe as props de texto
// num prefixo (…/font-size, …/line-height, …/font-weight, …/letter-spacing).
// `type` é o prefixo como o catálogo mostra ("text/heading/lg"); aceita também
// a forma curta "heading/lg" e o sufixo "/strong" (usa font-weight-emphasis).
Builder.prototype.typeRole = async function (t, s) {
  var get = async function (name) {
    var v = await getVar(name);
    return v ? { v: v, val: v.resolveForConsumer(t).value } : null;
  };
  var type = s.type;
  if (type.charAt(type.length - 1) === '/') type = type.slice(0, -1);
  var strong = type.slice(-7) === '/strong';
  if (strong) type = type.slice(0, -7);
  var base = null, size = null;
  var cands = [type + '/', 'text/' + type + '/', 'typography/' + type + '/', 'font/' + type + '/'];
  for (var i = 0; i < cands.length && !size; i++) { size = await get(cands[i] + 'font-size'); if (size) base = cands[i]; }
  if (!size) { this.w('papel tipográfico não achado: ' + s.type); return false; }
  var root = base.split('/')[0] + '/';
  var fam = (await get(base + 'font-family')) || (await get(root + 'font-family')) || (await get('typeface/default')) || (await get('font-family'));
  var lh = await get(base + 'line-height');
  var wt = (strong && (await get(base + 'font-weight-emphasis'))) || (await get(base + 'font-weight'));
  var ls = await get(base + 'letter-spacing');
  var family = fam ? String(fam.val) : 'Inter';
  var weight = wt ? Number(wt.val) : 400;
  var font = { family: family, style: WEIGHT[weight] || 'Regular' };
  try { await figma.loadFontAsync(font); } catch (e) {
    // Chivo/Barlow/Roboto escrevem "SemiBold" sem espaço.
    font = { family: family, style: font.style.replace(' ', '') };
    try { await figma.loadFontAsync(font); } catch (e2) {
      this.w('fonte indisponível ' + family + ' ' + weight + ', usando Inter');
      font = { family: 'Inter', style: WEIGHT[weight] || 'Regular' };
      await figma.loadFontAsync(font);
    }
  }
  t.fontName = font;
  t.setBoundVariable('fontSize', size.v);
  if (lh) t.setBoundVariable('lineHeight', lh.v);
  if (ls) t.letterSpacing = { value: Number(ls.val), unit: 'PERCENT' };
  try {
    if (fam) t.setBoundVariable('fontFamily', fam.v);
    if (wt) t.setBoundVariable('fontWeight', wt.v);
  } catch (e) { this.w(s.type + ': família/peso ficaram fixos (' + e.message + ')'); }
  return true;
};

Builder.prototype.text = async function (s) {
  var t = figma.createText();
  var typed = s.type && (await this.typeRole(t, s));
  if (!typed) {
    var font = { family: s.font || 'Inter', style: WEIGHT[s.weight] || s.weight || 'Regular' };
    var style = null;
    if (s.style) {
      style = await getStyle('text', s.style);
      if (style) font = style.fontName; else this.w('estilo de texto não achado: ' + s.style);
    }
    try { await figma.loadFontAsync(font); } catch (e) {
      this.w('fonte indisponível ' + font.family + ' ' + font.style + ', usando Inter');
      font = { family: 'Inter', style: 'Regular' };
      await figma.loadFontAsync(font);
      style = null;
    }
    if (style) await t.setTextStyleIdAsync(style.id); else t.fontName = font;
    if (s.size && !style) t.fontSize = s.size;
  }
  t.characters = String(s.text);
  t.name = s.n || String(s.text).slice(0, 30);
  if (s.color) { var p = await this.paint(s.color); if (p) t.fills = [p]; }
  if (s.align) t.textAlignHorizontal = s.align.toUpperCase() === 'START' ? 'LEFT' : s.align.toUpperCase();
  t.textAutoResize = s.w !== undefined ? 'HEIGHT' : 'WIDTH_AND_HEIGHT';
  return t;
};

Builder.prototype.inst = async function (s) {
  var ref = s.inst;
  var self = this;
  var e = /^[0-9a-f]{40}$/i.test(ref) ? { key: ref, set: null } : lookup((await index()).comps, ref);
  if (!e) { this.w('componente não achado: ' + ref); return null; }
  var main = e.id ? await figma.getNodeByIdAsync(e.id) : null;
  if (!main) {
    try { main = e.set === false ? await figma.importComponentByKeyAsync(e.key) : await figma.importComponentSetByKeyAsync(e.key); }
    catch (err) { main = await figma.importComponentByKeyAsync(e.key); }
  }
  var comp = main.type === 'COMPONENT_SET' ? (main.defaultVariant || main.children[0]) : main;
  var node = comp.createInstance();
  if (s.n) node.name = s.n;
  if (s.props) {
    var defs = node.componentProperties;
    var set = {};
    Object.keys(s.props).forEach(function (name) {
      var want = name.toLowerCase();
      var real = Object.keys(defs).filter(function (k) { return k.split('#')[0].toLowerCase() === want; })[0];
      if (real) set[real] = s.props[name]; else self.w(ref + ': prop não existe: ' + name);
    });
    // Texto em propriedade TEXT precisa da fonte carregada antes.
    var hasText = Object.keys(set).some(function (k) { return defs[k].type === 'TEXT'; });
    if (hasText) {
      var texts = node.findAllWithCriteria({ types: ['TEXT'] });
      for (var i = 0; i < texts.length; i++) if (texts[i].fontName !== figma.mixed) await figma.loadFontAsync(texts[i].fontName);
    }
    try { node.setProperties(set); } catch (err) { this.w(ref + ': ' + err.message); }
  }
  await this.common(node, s);
  return node;
};

Builder.prototype.node = async function (s, parent) {
  var n = null;
  if (s.frame !== undefined) n = await this.frame(s);
  else if (s.text !== undefined) n = await this.text(s);
  else if (s.inst !== undefined) n = await this.inst(s);
  else if (s.rect !== undefined) { n = figma.createRectangle(); n.name = s.rect; n.fills = []; await this.common(n, s); }
  else if (s.clone !== undefined) { var src = await figma.getNodeByIdAsync(s.clone); if (src) n = src.clone(); else this.w('clone: nó não achado ' + s.clone); }
  else { this.w('nó sem tipo: ' + JSON.stringify(s).slice(0, 60)); return null; }
  if (!n) return null;
  this.count++;
  if (parent) parent.appendChild(n);
  await this.size(n, s, parent);
  if (s.children && 'appendChild' in n) {
    for (var i = 0; i < s.children.length; i++) await this.node(s.children[i], n);
  }
  return n;
};

async function build(spec, parentId) {
  var b = new Builder();
  var parent = parentId ? await figma.getNodeByIdAsync(parentId) : null;
  if (parentId && !parent) throw new Error('nó pai não encontrado: ' + parentId);
  // Link com node-id de página: cria na raiz dessa página (ao lado do que existe).
  var onPage = null;
  if (parent && parent.type === 'PAGE') {
    onPage = parent.name;
    if (parent !== figma.currentPage) await figma.setCurrentPageAsync(parent);
    parent = null;
  }
  var root = await b.node(spec, parent);
  if (!root) throw new Error('nada criado: ' + b.warn.join('; '));
  if (!parent && spec.x === undefined) {
    // Nova raiz à direita do que já existe na página, pra não sobrepor nada.
    var right = 0;
    figma.currentPage.children.forEach(function (c) { if (c !== root) right = Math.max(right, c.x + c.width); });
    root.x = right ? right + 120 : 0;
    root.y = 0;
  }
  try { figma.currentPage.selection = [root]; figma.viewport.scrollAndZoomIntoView([root]); } catch (e) { /* sem viewport no remoto */ }
  var out = { v: V, id: root.id, nodes: b.count, size: Math.round(root.width) + 'x' + Math.round(root.height), x: Math.round(root.x), y: Math.round(root.y) };
  if (onPage) out.page = onPage + ' (o id informado era a página: criado na raiz dela)';
  if (b.warn.length) out.warn = b.warn;
  return out;
}

// Correção pontual sem código arbitrário: aplica num nó existente os mesmos
// campos da spec. patch: { n, text, type, color, fill, stroke, sw, r, o, w, h,
// gap, pad, align, cross, layout, x, y, parent (id: move pra dentro), index,
// remove: true }.
async function edit(id, patch) {
  var b = new Builder();
  var node = await figma.getNodeByIdAsync(id);
  if (!node) throw new Error('nó não encontrado: ' + id);
  if (patch.remove) { node.remove(); return { v: V, id: id, removed: true }; }
  if (patch.n) node.name = patch.n;
  if (node.type === 'TEXT') {
    if (patch.type) await b.typeRole(node, patch);
    if (patch.text !== undefined) {
      if (node.fontName !== figma.mixed) await figma.loadFontAsync(node.fontName);
      node.characters = String(patch.text);
    }
    if (patch.color) { var p = await b.paint(patch.color); if (p) node.fills = [p]; }
  }
  if (node.layoutMode !== undefined && node.layoutMode !== 'NONE') {
    if (patch.layout) node.layoutMode = patch.layout === 'H' ? 'HORIZONTAL' : 'VERTICAL';
    await b.num(node, 'itemSpacing', patch.gap);
    if (patch.pad !== undefined) {
      var pd = Array.isArray(patch.pad) ? patch.pad : [patch.pad];
      var t = pd[0], r = pd.length > 1 ? pd[1] : pd[0], bt = pd.length > 2 ? pd[2] : pd[0], l = pd.length > 3 ? pd[3] : r;
      await b.num(node, 'paddingTop', t); await b.num(node, 'paddingRight', r);
      await b.num(node, 'paddingBottom', bt); await b.num(node, 'paddingLeft', l);
    }
    if (patch.align) node.primaryAxisAlignItems = ALIGN[patch.align] || 'MIN';
    if (patch.cross) node.counterAxisAlignItems = ALIGN[patch.cross] || 'MIN';
  }
  var common = {};
  ['fill', 'stroke', 'sw', 'r', 'o', 'effect', 'clip'].forEach(function (k) { if (patch[k] !== undefined) common[k] = patch[k]; });
  if (common.sw !== undefined && common.stroke === undefined) await b.num(node, 'strokeWeight', common.sw);
  await b.common(node, common);
  if (patch.parent) {
    var dest = await figma.getNodeByIdAsync(patch.parent);
    if (!dest) throw new Error('nó pai não encontrado: ' + patch.parent);
    if (patch.index !== undefined) dest.insertChild(patch.index, node); else dest.appendChild(node);
  }
  await b.size(node, patch, node.parent);
  var out = { v: V, id: node.id, size: Math.round(node.width) + 'x' + Math.round(node.height), x: Math.round(node.x), y: Math.round(node.y) };
  if (b.warn.length) out.warn = b.warn;
  return out;
}

return { v: V, build: build, edit: edit, catalog: catalog, reindex: reindex };

})(figma);

// ─── status / tree / run / shot ──────────────────────────────────────────────

const HANDLERS = {};

HANDLERS.status = async function () {
  const sel = figma.currentPage.selection;
  return {
    file: figma.root.name,
    mode: figma.editorType,
    page: figma.currentPage.name,
    selection: sel.slice(0, 10).map(brief),
    selectionCount: sel.length,
  };
};

HANDLERS.tree = async function (a) {
  let root;
  if (a.id) root = await nodeOrThrow(a.id);
  else root = figma.currentPage.selection[0] || figma.currentPage;
  const lines = [];
  const max = a.max || 120;
  (function walk(n, d) {
    if (lines.length >= max) return;
    let line = '  '.repeat(d) + n.type + ' ' + n.id + ' "' + n.name + '"';
    if ('width' in n) line += ' ' + Math.round(n.width) + 'x' + Math.round(n.height) + ' @' + Math.round(n.x) + ',' + Math.round(n.y);
    if (n.type === 'TEXT') line += ' «' + n.characters.slice(0, 40) + '»';
    lines.push(line);
    if (d < a.depth && 'children' in n) {
      n.children.forEach(function (c) { walk(c, d + 1); });
    } else if ('children' in n && n.children.length) {
      lines[lines.length - 1] += ' (+' + n.children.length + ' filhos)';
    }
  })(root, 0);
  if (lines.length >= max) lines.push('… cortado em ' + max + ' linhas');
  return lines.join('\n');
};

// Correção pontual: operações estruturadas da lib (sem executar código recebido).
HANDLERS.edit = async function (a) { return LITE.edit(a.id, a.patch || {}); };

HANDLERS.shot = async function (a) {
  const n = await nodeOrThrow(a.id);
  // A API do Figma não exporta página: devolve os frames de primeiro nível pra
  // escolher um, em vez do erro de "constraint".
  if (n.type === 'PAGE' || n.type === 'DOCUMENT') {
    const tops = (n.type === 'PAGE' ? n.children : figma.currentPage.children).slice(0, 20)
      .map(function (c) { return c.id + ' "' + c.name + '" @' + Math.round(c.x) + ',' + Math.round(c.y); });
    throw new Error('print de página não existe na API do Figma; passe o id de um frame. Frames na página: ' + (tops.join('; ') || 'nenhum'));
  }
  const bytes = await n.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: Math.min(a.width, Math.round(n.width * 2)) } });
  return figma.base64Encode(bytes);
};

// ─── catálogo do design system (implementado na lib, igual nos dois modos) ──

HANDLERS.ds = async function (a) { return LITE.catalog({ filter: a.filter, refresh: a.refresh }); };

// ─── docs: extrai a documentação de um arquivo de definição do DS ───────────
// Roda dentro do próprio arquivo da biblioteca (ex.: FCx Colors): variáveis
// locais com descrição completa e valor por modo, e o texto das páginas
// (playgrounds, exemplos de uso, regras) em ordem de leitura.
HANDLERS.docs_vars = async function () {
  const md = ['# Docs: ' + figma.root.name];
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const byId = {};
  (await figma.variables.getLocalVariablesAsync()).forEach(function (v) { byId[v.id] = v; });
  const fmt = function (val) {
    if (val && val.type === 'VARIABLE_ALIAS') return '→' + (byId[val.id] ? byId[val.id].name : '?');
    if (val && typeof val === 'object' && 'r' in val) return rgbToHex(val);
    return String(val);
  };
  for (const c of cols) {
    md.push('## Coleção ' + c.name + ' (modos: ' + c.modes.map(function (m) { return m.name; }).join(', ') + ')');
    for (const id of c.variableIds) {
      const v = byId[id];
      if (!v) continue;
      const vals = c.modes.map(function (m) { return fmt(v.valuesByMode[m.modeId]); });
      const uniq = vals.every(function (x) { return x === vals[0]; }) ? vals[0] : vals.join(' | ');
      let line = v.name + ' = ' + uniq;
      if (v.hiddenFromPublishing) line += ' [oculto]';
      if (v.description) line += '\n  ' + v.description.replace(/\s*\n\s*/g, ' ');
      md.push(line);
    }
  }
  return md.join('\n');
};

HANDLERS.docs_pages = async function () {
  return figma.root.children.map(function (p) { return { id: p.id, name: p.name }; });
};

// Uma página por chamada: arquivo de DS grande estoura o timeout inteiro.
HANDLERS.docs_page = async function (a) {
  const page = await nodeOrThrow(a.id);
  await page.loadAsync();
  const md = ['## Página ' + page.name];
  const cap = a.cap || 600;
  for (const top of page.children) {
    const texts = 'findAllWithCriteria' in top ? top.findAllWithCriteria({ types: ['TEXT'] }) : (top.type === 'TEXT' ? [top] : []);
    if (!texts.length) continue;
    const pos = texts.slice(0, cap * 3).map(function (t) {
      const m = t.absoluteTransform;
      return { y: m[1][2], x: m[0][2], s: t.characters.replace(/\s+/g, ' ').trim() };
    });
    pos.sort(function (p, q) { return Math.abs(p.y - q.y) > 4 ? p.y - q.y : p.x - q.x; });
    const seen = {};
    const out = [];
    for (const p of pos) {
      if (!p.s || seen[p.s]) continue;
      seen[p.s] = 1;
      out.push(p.s.length > 400 ? p.s.slice(0, 400) + '…' : p.s);
      if (out.length >= cap) { out.push('…(+' + (texts.length - cap) + ' textos cortados)'); break; }
    }
    md.push('### ' + top.name);
    md.push(out.join(' ¦ '));
  }
  return md.join('\n');
};

// ─── build ───────────────────────────────────────────────────────────────────

HANDLERS.build = async function (a) { return LITE.build(a.spec, a.parent); };

// figma-mcp-lite — builder compartilhado. É o CORPO de uma função
// `new Function('figma', src)` e devolve a API { v, build, reindex }.
// Roda em dois lugares: no plugin local (modo janela) e dentro do use_figma do
// MCP oficial (modo remoto, guardado em sharedPluginData do arquivo).
// Regras pra continuar rodando no use_figma: nada de clientStorage,
// setPluginData, loadAllPagesAsync nem fetch; sem crase nem "${" no fonte
// (a instalação embrulha o código minificado em String.raw).

var V = '__VERSION__';
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
  // Imagem: o servidor lê o arquivo/URL e manda os bytes em img64 (só no modo
  // plugin; no remoto não há como os bytes chegarem).
  if (s.img !== undefined) {
    if (s.img64) {
      var image = figma.createImage(figma.base64Decode(s.img64));
      var fit = String(s.fit || 'fill').toUpperCase();
      node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: fit === 'FIT' || fit === 'CROP' || fit === 'TILE' ? fit : 'FILL' }];
    } else this.w('imagem não carregada (' + (s.imgErr || 'só funciona no modo plugin') + '): ' + String(s.img).slice(0, 60));
  }
  // Draw: pincel (stretch/scatter) ou traço dinâmico sobre o stroke.
  if ((s.brush || s.dynamic) && 'complexStrokeProperties' in node) {
    try {
      if (s.dynamic) node.complexStrokeProperties = { type: 'DYNAMIC', frequency: s.dynamic.frequency || 1, wiggle: s.dynamic.wiggle || 1, smoothen: s.dynamic.smoothen === undefined ? 0.5 : s.dynamic.smoothen };
      else {
        var bname = String(s.brush.name || s.brush).toUpperCase();
        var scatter = ['BUBBLEGUM', 'WITCH_HOUSE', 'SHOEGAZE', 'HONKY_TONK', 'SCREAMO', 'DRONE', 'DOO_WOP', 'SPOKEN_WORD', 'VAPORWAVE', 'OI'].indexOf(bname) >= 0;
        node.complexStrokeProperties = scatter
          ? { type: 'BRUSH', brushType: 'SCATTER', brushName: bname, gap: s.brush.gap || 1, wiggle: s.brush.wiggle || 0, sizeJitter: s.brush.sizeJitter || 0, angularJitter: s.brush.angularJitter || 0, rotation: s.brush.rotation || 0 }
          : { type: 'BRUSH', brushType: 'STRETCH', brushName: bname, direction: s.brush.direction || 'FORWARD' };
      }
    } catch (e) { this.w('pincel/traço: ' + ((e && e.message) || e)); }
  }
};

// Tamanho depois de o nó estar no pai: FILL/HUG só valem dentro de auto layout.
// Número fixo ou "$token" (ex.: h:"$border/minimal" num divisor).
Builder.prototype.size = async function (node, s, parent, isNew) {
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
  // Texto sem largura dentro de coluna (auto layout V) de largura fixa ocupa a
  // largura e quebra linha, em vez de estourar numa linha só.
  if (isNew && node.type === 'TEXT' && s.w === undefined && !s.abs && parent && parent.layoutMode === 'VERTICAL' && parent.layoutSizingHorizontal !== 'HUG') {
    node.layoutSizingHorizontal = 'FILL';
    node.textAutoResize = 'HEIGHT';
  }
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

// Ícone SVG: pinta todos os vetores com a cor pedida (aceita "$variável").
Builder.prototype.recolor = async function (node, color) {
  var p = await this.paint(color);
  if (!p) return;
  var all = [node].concat('findAll' in node ? node.findAll(function () { return true; }) : []);
  all.forEach(function (n) {
    if (n.type === 'FRAME' || n.type === 'GROUP') return;
    if (Array.isArray(n.fills) && n.fills.length) n.fills = [p];
    if (Array.isArray(n.strokes) && n.strokes.length) n.strokes = [p];
  });
};

// Animação (Figma Motion; liberado por conta). a = { style, dur, delay, props }
// pra estilo pronto da Figma, ou { keys: { OPACITY: [[t, v], [t, v, ease]] },
// ease, delay } pra keyframes; total = duração da timeline do frame.
Builder.prototype.anim = async function (node, a) {
  if (!a) return;
  try {
    var delay = a.delay || 0;
    if (a.style) {
      var want = String(a.style).toLowerCase();
      var styles = figma.motion.figmaAnimationStyles();
      var st = styles.filter(function (x) { return String(x.name).toLowerCase() === want; })[0];
      if (!st) this.w('estilo de animação "' + a.style + '" não existe; disponíveis: ' + styles.map(function (x) { return x.name; }).join(', '));
      else {
        var cfg = { timelineOffset: delay };
        if (a.dur !== undefined) cfg.duration = a.dur;
        if (a.props) cfg.props = a.props;
        node.applyAnimationStyle(st.styleId, cfg);
      }
    }
    if (a.keys) {
      Object.keys(a.keys).forEach(function (k) {
        node.applyManualKeyframeTrack({ type: 'PROPERTY', name: k.toUpperCase() }, {
          keyframes: a.keys[k].map(function (pt, i) {
            var kf = { timelinePosition: pt[0] + delay, value: { type: 'FLOAT', value: pt[1] } };
            if (i) kf.easing = { type: String(pt[2] || a.ease || 'EASE_OUT').toUpperCase() };
            return kf;
          }),
        });
      });
    }
    if (a.total && node.timelines && node.timelines[0]) node.setTimelineDuration(node.timelines[0].id, a.total);
  } catch (e) {
    var m = String((e && e.message) || e);
    this.w(m.indexOf('not a supported API') >= 0 ? 'animação: o Motion da Figma não está liberado nesta conta' : 'animação: ' + m);
  }
};

// Partículas (estrelas etc.): N elipses em posições determinísticas — mesmo
// seed = mesmas posições em todas as telas (bom pro Smart Animate); shift
// desloca x com volta, pra parallax.
function rng(seed) {
  var a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Builder.prototype.scatter = async function (s, parent) {
  var box = figma.createFrame();
  box.name = s.n || s.scatter;
  box.fills = [];
  box.clipsContent = false;
  var area = s.area || [parent ? parent.width : 400, parent ? parent.height : 400];
  box.resize(area[0], area[1]);
  var r = rng(s.seed === undefined ? 1 : s.seed);
  var lerp = function (v, t) { return Array.isArray(v) ? v[0] + (v[1] - v[0]) * t : v; };
  var paint = await this.paint(s.fill === undefined ? '#FFFFFF' : s.fill);
  var item = s.item || String(s.scatter).replace(/s$/, '');
  var shift = s.shift || 0;
  for (var i = 0; i < (s.count || 50); i++) {
    var x = r() * area[0], y = r() * area[1], d = lerp(s.size === undefined ? [1, 3] : s.size, r()), o = lerp(s.o === undefined ? 1 : s.o, r());
    var e = figma.createEllipse();
    e.name = item + ' ' + (i + 1);
    e.resize(d, d);
    e.x = (((x + shift) % area[0]) + area[0]) % area[0];
    e.y = y;
    e.opacity = o;
    e.fills = paint ? [paint] : [];
    box.appendChild(e);
    this.count++;
  }
  return box;
};

Builder.prototype.node = async function (s, parent) {
  var n = null;
  // d = diâmetro/lado: atalho pra w e h iguais.
  if (s.d !== undefined) { var sd = {}; Object.keys(s).forEach(function (k) { sd[k] = s[k]; }); if (sd.w === undefined) sd.w = s.d; if (sd.h === undefined) sd.h = s.d; s = sd; }
  if (s.scatter !== undefined) {
    n = await this.scatter(s, parent);
    this.count++;
    if (parent) parent.appendChild(n);
    if (parent && parent.layoutMode && parent.layoutMode !== 'NONE') n.layoutPositioning = 'ABSOLUTE';
    n.x = s.x || 0;
    n.y = s.y || 0;
    return n;
  }
  if (s.frame !== undefined) n = await this.frame(s);
  else if (s.text !== undefined) n = await this.text(s);
  else if (s.inst !== undefined) n = await this.inst(s);
  else if (s.rect !== undefined) { n = figma.createRectangle(); n.name = s.n || s.rect || 'Retângulo'; n.fills = []; await this.common(n, s); }
  else if (s.ellipse !== undefined) { n = figma.createEllipse(); n.name = s.n || s.ellipse || 'Elipse'; n.fills = []; await this.common(n, s); }
  else if (s.svg !== undefined) {
    n = figma.createNodeFromSvg(String(s.svg));
    n.name = s.n || 'Ícone';
    if (s.color) await this.recolor(n, s.color);
    var sv = {};
    Object.keys(s).forEach(function (k) { if (k !== 'fill') sv[k] = s[k]; });
    await this.common(n, sv);
  }
  else if (s.path !== undefined) {
    n = figma.createVector();
    n.vectorPaths = [{ windingRule: 'NONZERO', data: String(s.path) }];
    n.name = s.n || 'Desenho';
    n.fills = [];
    await this.common(n, s);
    if (s.onPath !== undefined) {
      // Texto em caminho: troca o vetor por um TextPathNode com o texto.
      var tf = { family: s.font || 'Inter', style: WEIGHT[s.weight] || 'Regular' };
      await figma.loadFontAsync(tf);
      n = figma.createTextPath(n, 0, 0);
      n.fontName = tf;
      if (s.size) n.fontSize = s.size;
      n.characters = String(s.onPath);
      if (s.color) { var tp = await this.paint(s.color); if (tp) n.fills = [tp]; }
    }
  }
  else if (s.clone !== undefined) { var src = await figma.getNodeByIdAsync(s.clone); if (src) n = src.clone(); else this.w('clone: nó não achado ' + s.clone); }
  else { this.w('nó sem tipo: ' + JSON.stringify(s).slice(0, 60)); return null; }
  if (!n) return null;
  if (s.n) n.name = s.n; // "n" sempre manda no nome da camada
  this.count++;
  if (parent) parent.appendChild(n);
  await this.size(n, s, parent, true);
  if (s.anim) await this.anim(n, s.anim);
  if (s.children && 'appendChild' in n) {
    // "def": props padrão pros filhos diretos (o filho sobrescreve).
    for (var i = 0; i < s.children.length; i++) {
      var c = s.children[i];
      if (s.def) { var m = {}; Object.keys(s.def).forEach(function (k) { m[k] = s.def[k]; }); Object.keys(c).forEach(function (k) { m[k] = c[k]; }); c = m; }
      await this.node(c, n);
    }
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

// ─── achar nós: id ("12:34") ou caminho por nome a partir da página ─────────
// "Universo 2/Conteudo/*": cada trecho é o nome de um filho; "*" pega todos.
async function find(ref, from) {
  ref = String(ref);
  if (/^[0-9]+:[0-9]+$/.test(ref)) { var byId = await figma.getNodeByIdAsync(ref); return byId ? [byId] : []; }
  var level = from ? [from] : null;
  var segs = ref.split('/');
  for (var i = 0; i < segs.length; i++) {
    var next = [];
    var pool = level ? [] : figma.currentPage.children.slice();
    if (level) level.forEach(function (n) { if ('children' in n) pool = pool.concat(n.children); });
    pool.forEach(function (c) { if (segs[i] === '*' || c.name === segs[i]) next.push(c); });
    level = next;
  }
  return level || [];
}

// Correção pontual sem código arbitrário: aplica num nó existente os mesmos
// campos da spec. patch: { n, text, type, color, fill, stroke, sw, r, o, w, h,
// d, gap, pad, align, cross, layout, x, y, img, brush, dynamic, anim,
// parent (id: move pra dentro), index, remove: true }.
async function editNode(b, node, patch) {
  if (patch.d !== undefined) { if (patch.w === undefined) patch.w = patch.d; if (patch.h === undefined) patch.h = patch.d; }
  if (patch.remove) { node.remove(); return; }
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
  ['fill', 'stroke', 'sw', 'r', 'o', 'effect', 'clip', 'img', 'img64', 'imgErr', 'fit', 'brush', 'dynamic'].forEach(function (k) { if (patch[k] !== undefined) common[k] = patch[k]; });
  if (common.sw !== undefined && common.stroke === undefined) await b.num(node, 'strokeWeight', common.sw);
  await b.common(node, common);
  if (patch.parent) {
    var dest = await figma.getNodeByIdAsync(patch.parent);
    if (!dest) throw new Error('nó pai não encontrado: ' + patch.parent);
    if (patch.index !== undefined) dest.insertChild(patch.index, node); else dest.appendChild(node);
  }
  await b.size(node, patch, node.parent);
  if (patch.anim) await b.anim(node, patch.anim);
}

// edit(ref, patch) ou edit([{id|path, patch}, …]) — em lote numa chamada só.
async function edit(ref, patch) {
  var b = new Builder();
  var items = Array.isArray(ref) ? ref : [{ id: ref, patch: patch }];
  var done = 0;
  var last = null;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var nodes = await find(it.id || it.path);
    if (!nodes.length) { b.w('não achado: ' + (it.id || it.path)); continue; }
    for (var j = 0; j < nodes.length; j++) {
      var pt = {};
      Object.keys(it.patch || {}).forEach(function (k) { pt[k] = it.patch[k]; });
      await editNode(b, nodes[j], pt);
      done++;
      last = nodes[j];
    }
  }
  var out = { v: V, edited: done };
  if (last && !last.removed && items.length === 1 && done === 1) {
    try { out.id = last.id; out.size = Math.round(last.width) + 'x' + Math.round(last.height); out.x = Math.round(last.x); out.y = Math.round(last.y); } catch (e) { /* removido */ }
  }
  if (b.warn.length) out.warn = b.warn;
  return out;
}

// Tela nova a partir de outra: clona e aplica patches por nome de camada
// ("Sol", ou caminho relativo "Conteudo/Titulo"; vale pra todas as camadas
// com esse nome). Troca uma spec inteira por poucos patches.
async function variant(srcRef, o) {
  o = o || {};
  var b = new Builder();
  var src = (await find(srcRef))[0];
  if (!src) throw new Error('tela de origem não achada: ' + srcRef);
  var copy = src.clone();
  if (o.name) copy.name = o.name;
  if (o.x === undefined && copy.parent && copy.parent.type === 'PAGE') {
    var right = 0;
    copy.parent.children.forEach(function (c) { if (c !== copy) right = Math.max(right, c.x + c.width); });
    copy.x = right + 120;
    copy.y = src.y;
  } else if (o.x !== undefined) { copy.x = o.x; copy.y = o.y === undefined ? src.y : o.y; }
  var patches = o.patches || {};
  var done = 0;
  var keys = Object.keys(patches);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var nodes = k.indexOf('/') >= 0 ? await find(k, copy) : copy.findAll(function (n) { return n.name === k; });
    if (!nodes.length) { b.w('camada não achada: ' + k); continue; }
    for (var j = 0; j < nodes.length; j++) {
      var pt = {};
      Object.keys(patches[k]).forEach(function (x) { pt[x] = patches[k][x]; });
      await editNode(b, nodes[j], pt);
      done++;
    }
  }
  var out = { v: V, id: copy.id, name: copy.name, patched: done, x: Math.round(copy.x), y: Math.round(copy.y) };
  if (b.warn.length) out.warn = b.warn;
  return out;
}

// Protótipo: liga telas/nós. l = { from, to, trigger: "click"|"hover"|"delay",
// ms, animation: "smart"|"dissolve"|"instant", easing, duration (s) } ou array.
var TRIGGER = { click: 'ON_CLICK', hover: 'ON_HOVER', press: 'ON_PRESS', drag: 'ON_DRAG' };
var TRANSITION = { smart: 'SMART_ANIMATE', dissolve: 'DISSOLVE', move: 'MOVE_IN', push: 'PUSH', slide: 'SLIDE_IN' };
async function link(list) {
  list = Array.isArray(list) ? list : [list];
  var b = new Builder();
  var done = 0;
  for (var i = 0; i < list.length; i++) {
    var l = list[i];
    var from = (await find(l.from))[0];
    var to = (await find(l.to))[0];
    if (!from || !to) { b.w('link: não achado ' + (!from ? l.from : l.to)); continue; }
    var trig = String(l.trigger || 'click').toLowerCase();
    var trigger = trig === 'delay' ? { type: 'AFTER_TIMEOUT', timeout: l.ms === undefined ? 800 : l.ms } : { type: TRIGGER[trig] || 'ON_CLICK' };
    var anim = String(l.animation || 'smart').toLowerCase();
    var transition = anim === 'instant' ? null : { type: TRANSITION[anim] || 'SMART_ANIMATE', easing: { type: String(l.easing || 'EASE_OUT').toUpperCase() }, duration: l.duration === undefined ? 0.4 : l.duration };
    if (transition && transition.type !== 'SMART_ANIMATE' && transition.type !== 'DISSOLVE') { transition.direction = String(l.direction || 'LEFT').toUpperCase(); transition.matchLayers = false; }
    var keep = (from.reactions || []).filter(function (r) { return !r.trigger || r.trigger.type !== trigger.type; });
    await from.setReactionsAsync(keep.concat([{ trigger: trigger, actions: [{ type: 'NODE', destinationId: to.id, navigation: 'NAVIGATE', transition: transition, resetScrollPosition: true }] }]));
    done++;
  }
  var out = { v: V, linked: done };
  if (b.warn.length) out.warn = b.warn;
  return out;
}

// ─── inspect: o frame em texto pra virar código ─────────────────────────────
// Uma linha por nó: tipo, nome, tamanho, posição, layout e cada valor com o
// NOME da variável quando ligado (é o que o código deve usar).
async function inspect(id, depth) {
  var root = await figma.getNodeByIdAsync(id);
  if (!root) throw new Error('nó não encontrado: ' + id);
  var names = {};
  var vn = async function (alias) {
    if (!alias || !alias.id) return null;
    if (!names[alias.id]) { var v = await figma.variables.getVariableByIdAsync(alias.id); names[alias.id] = v ? '$' + v.name : '?'; }
    return names[alias.id];
  };
  var paintStr = async function (ps) {
    if (!Array.isArray(ps) || !ps.length) return null;
    var p = ps[0];
    if (p.boundVariables && p.boundVariables.color) return await vn(p.boundVariables.color);
    if (p.type === 'SOLID') return rgbToHex({ r: p.color.r, g: p.color.g, b: p.color.b, a: p.opacity === undefined ? 1 : p.opacity });
    return p.type.toLowerCase();
  };
  var num = async function (n, field, alias) {
    var b = n.boundVariables && n.boundVariables[alias || field];
    var name = b ? await vn(Array.isArray(b) ? b[0] : b) : null;
    var v = n[field];
    if (v === undefined || v === figma.mixed) return null;
    return name ? name + '(' + Math.round(v * 100) / 100 + ')' : String(Math.round(v * 100) / 100);
  };
  var lines = [];
  var max = 150;
  var walk = async function (n, d) {
    if (lines.length >= max) return;
    var parts = ['  '.repeat(d) + n.type + ' "' + n.name + '"'];
    if ('width' in n) parts.push(Math.round(n.width) + 'x' + Math.round(n.height) + ' @' + Math.round(n.x) + ',' + Math.round(n.y));
    if (n.layoutMode && n.layoutMode !== 'NONE') {
      parts.push(n.layoutMode === 'HORIZONTAL' ? 'row' : 'col');
      var g = await num(n, 'itemSpacing'); if (g && g !== '0') parts.push('gap=' + g);
      var pads = [await num(n, 'paddingTop'), await num(n, 'paddingRight'), await num(n, 'paddingBottom'), await num(n, 'paddingLeft')];
      if (pads.some(function (x) { return x && x !== '0'; })) parts.push('pad=' + pads.join(' '));
      parts.push('align=' + n.primaryAxisAlignItems.toLowerCase() + '/' + n.counterAxisAlignItems.toLowerCase());
    }
    if ('layoutSizingHorizontal' in n) parts.push('sizing=' + n.layoutSizingHorizontal.toLowerCase() + '/' + n.layoutSizingVertical.toLowerCase());
    var f = await paintStr(n.fills); if (f && n.type !== 'TEXT') parts.push('fill=' + f);
    var st = await paintStr(n.strokes); if (st) parts.push('stroke=' + st + ' ' + (await num(n, 'strokeWeight')));
    var r = await num(n, 'topLeftRadius'); if (r && r !== '0') parts.push('r=' + r);
    if (n.opacity !== undefined && n.opacity < 1) parts.push('o=' + Math.round(n.opacity * 100) / 100);
    if (n.type === 'TEXT') {
      parts.push('«' + n.characters.slice(0, 80) + '»');
      parts.push('color=' + (await paintStr(n.fills)));
      var fs = await num(n, 'fontSize'); var lh = n.lineHeight && n.lineHeight.unit === 'PIXELS' ? Math.round(n.lineHeight.value) : 'auto';
      var lhb = n.boundVariables && n.boundVariables.lineHeight ? await vn(n.boundVariables.lineHeight) + '(' + lh + ')' : lh;
      var fn = n.fontName !== figma.mixed ? n.fontName.family + ' ' + n.fontName.style : 'misto';
      parts.push('font=' + fn + ' size=' + fs + ' lh=' + lhb);
    }
    if (n.type === 'INSTANCE') {
      var main = await n.getMainComponentAsync();
      if (main) parts.push('inst=' + (main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent.name : main.name));
    }
    lines.push(parts.join(' '));
    if (d < depth && 'children' in n) for (var i = 0; i < n.children.length; i++) await walk(n.children[i], d + 1);
    else if ('children' in n && n.children.length) lines[lines.length - 1] += ' (+' + n.children.length + ' filhos)';
  };
  await walk(root, 0);
  if (lines.length >= max) lines.push('… cortado em ' + max + ' linhas');
  return lines.join(NL);
}

// ─── componentes ────────────────────────────────────────────────────────────
// o = { id } transforma o nó em componente; { ids, n } junta componentes (ou
// frames, que viram componente antes) como variantes; props = { Nome:
// "TEXT:valor" | "BOOLEAN:true" } cria propriedades no componente/set.
async function component(o) {
  var toComp = async function (id) {
    var n = await figma.getNodeByIdAsync(id);
    if (!n) throw new Error('nó não encontrado: ' + id);
    return n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' ? n : figma.createComponentFromNode(n);
  };
  var target;
  if (o.ids && o.ids.length) {
    var comps = [];
    for (var i = 0; i < o.ids.length; i++) comps.push(await toComp(o.ids[i]));
    target = figma.combineAsVariants(comps, comps[0].parent || figma.currentPage);
  } else target = await toComp(o.id);
  if (o.n) target.name = o.n;
  var added = [];
  if (o.props) Object.keys(o.props).forEach(function (k) {
    var raw = String(o.props[k]);
    var cut = raw.indexOf(':');
    var type = (cut > 0 ? raw.slice(0, cut) : 'TEXT').toUpperCase();
    var val = cut > 0 ? raw.slice(cut + 1) : raw;
    added.push(target.addComponentProperty(k, type, type === 'BOOLEAN' ? val === 'true' : val));
  });
  return { v: V, id: target.id, type: target.type, ref: target.key, props: added };
}

return { v: V, build: build, edit: edit, variant: variant, link: link, catalog: catalog, reindex: reindex, inspect: inspect, component: component };

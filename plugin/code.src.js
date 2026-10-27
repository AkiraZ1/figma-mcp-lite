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
    if (figma.editorType === 'dev' && ['build', 'edit', 'component', 'variant', 'link'].indexOf(msg.cmd) >= 0) {
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
/*@BUILDER@*/
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
  if (a.find) return LITE.locate(a.find, a.max);
  let root;
  if (a.id) root = await nodeOrThrow(a.id);
  else root = figma.currentPage.selection[0] || figma.currentPage;
  const lines = [];
  const max = a.max || 40;
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
HANDLERS.edit = async function (a) { return LITE.edit(a.items || a.id || a.path, a.patch || {}); };
HANDLERS.variant = async function (a) { return LITE.variant(a.source, a); };
HANDLERS.link = async function (a) { return LITE.link(a.links || a); };
HANDLERS.inspect = async function (a) { return LITE.inspect(a.id, a.depth === undefined ? 3 : a.depth); };
HANDLERS.component = async function (a) { return LITE.component(a); };

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

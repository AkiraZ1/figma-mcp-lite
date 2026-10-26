#!/usr/bin/env node
// figma-mcp-lite — MCP enxuto pro Figma.
// Fala com um plugin de desenvolvimento aberto no Figma Desktop por um hub
// WebSocket local (só loopback). Várias sessões podem rodar ao mesmo tempo:
// a primeira que sobe vira o hub, as outras se conectam nele.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.FIGMA_LITE_PORT) || 3055;
const HERE = path.dirname(new URL(import.meta.url).pathname);
// No plugin empacotado a versão vem embutida pelo esbuild; no repo, do package.json.
const VERSION = typeof __LITE_VERSION__ !== 'undefined' ? __LITE_VERSION__
  : JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version;
const HOME = path.join(os.homedir(), '.figma-mcp-lite');
const DS_DIR = path.join(HOME, 'ds');
// Definido pelos agentes figma-lite (Claude Code / Codex). Sem ele, o cliente
// é desconhecido e o servidor exige que um subagente se apresente primeiro.
let subagentModel = process.env.FIGMA_LITE_SUBAGENT || null;
// Arquivo escolhido nesta sessão (figma_status file), quando há plugin em mais de um.
let targetFile = null;

// ─── hub ─────────────────────────────────────────────────────────────────────

function becomeHub() {
  const agents = new Map(); // gid -> { ws, id, plugin }
  // Um plugin por arquivo aberto (pode haver vários: o arquivo de trabalho e
  // a biblioteca do DS em Dev Mode). Mais recente por último.
  const plugins = new Map(); // ws -> { file }
  let seq = 0;

  const pick = (target) => {
    const open = [...plugins].filter(([w]) => w.readyState === WebSocket.OPEN);
    if (!open.length) return { error: NO_PLUGIN };
    if (target) {
      const t = target.toLowerCase();
      const hit = open.find(([, i]) => (i.file || '').toLowerCase() === t) || open.find(([, i]) => (i.file || '').toLowerCase().includes(t));
      return hit ? { ws: hit[0] } : { error: `nenhum plugin aberto no arquivo "${target}". Abertos: ${open.map(([, i]) => i.file).join(', ')}` };
    }
    if (open.length > 1) return { error: `plugin aberto em ${open.length} arquivos (${open.map(([, i]) => i.file).join(', ')}): chame figma_status com file pra escolher` };
    return { ws: open[0][0] };
  };

  // Quando o hub acabou de (re)subir, o plugin leva até ~2s pra notar e mais o
  // tempo de reconectar (medido: 4s não bastou no subagente recém-aberto):
  // espera um pouco antes de dizer que ele não está aberto.
  const forward = (ws, msg, since) => {
    const p = pick(msg.target);
    if (p.error) {
      if (Date.now() - since < 7000) return setTimeout(() => forward(ws, msg, since), 250);
      ws.send(JSON.stringify({ id: msg.id, ok: false, error: p.error }));
      return;
    }
    const gid = ++seq;
    agents.set(gid, { ws, id: msg.id, plugin: p.ws });
    const { target, ...rest } = msg;
    p.ws.send(JSON.stringify({ ...rest, id: gid }));
  };

  const onConnection = (ws, req) => {
    // Página web no navegador manda Origin; o iframe do plugin manda "null" e
    // o Node não manda nada. Qualquer outra origem é site tentando rodar
    // código no teu Figma — fora.
    const origin = req.headers.origin;
    if (origin && origin !== 'null') return ws.close(1008, 'origin');
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.hello === 'plugin') {
        plugins.delete(ws);
        plugins.set(ws, msg.info || {});
        return;
      }
      if (plugins.has(ws)) {
        const dest = agents.get(msg.id);
        if (!dest) return;
        agents.delete(msg.id);
        if (dest.ws.readyState === WebSocket.OPEN) dest.ws.send(JSON.stringify({ ...msg, id: dest.id }));
        return;
      }
      forward(ws, msg, Date.now());
    });
    ws.on('close', () => {
      if (!plugins.delete(ws)) return;
      for (const [gid, dest] of agents) {
        if (dest.plugin !== ws) continue;
        agents.delete(gid);
        if (dest.ws.readyState === WebSocket.OPEN) dest.ws.send(JSON.stringify({ id: dest.id, ok: false, error: 'plugin fechou no meio do comando' }));
      }
    });
  };

  // Dois listeners de loopback (IPv4 e IPv6) em vez de um em todas as
  // interfaces: o hub executa código no Figma, não pode ficar exposto na rede.
  const listen = (host) => new Promise((resolve) => {
    const wss = new WebSocketServer({ host, port: PORT });
    wss.on('listening', () => { wss.on('connection', onConnection); resolve(wss); });
    wss.on('error', () => resolve(null));
  });
  return listen('127.0.0.1').then(async (v4) => {
    if (!v4) return false;
    await listen('::1');
    return true;
  });
}

// Link da página do plugin na Figma Community (publicado oculto: só quem tem o
// link instala). Vem do package.json "figmaPluginUrl" no build, ou da env.
const PLUGIN_URL = process.env.FIGMA_LITE_PLUGIN_URL || (typeof __FIGMA_PLUGIN_URL__ !== 'undefined' ? __FIGMA_PLUGIN_URL__ : '');
const MANIFEST = [path.join(HERE, '..', 'figma-plugin', 'manifest.json'), path.join(HERE, '..', 'plugin', 'manifest.json')].find((p) => fs.existsSync(p));
const NO_PLUGIN = 'Plugin do Figma "figma-mcp-lite" não encontrado. ' + (PLUGIN_URL
  ? `Instale uma vez: ${PLUGIN_URL} . Depois, no Figma Desktop, abra o arquivo e rode Plugins → figma-mcp-lite: ele fica em segundo plano, com um aviso no rodapé.`
  : `Instale uma vez no Figma Desktop: Plugins → Development → Import plugin from manifest → ${MANIFEST || 'figma-plugin/manifest.json (dentro do plugin figma-mcp-lite)'} . Depois abra o arquivo e rode Plugins → Development → figma-mcp-lite: ele fica em segundo plano, com um aviso no rodapé.`);

// ─── cliente do hub ──────────────────────────────────────────────────────────

let conn = null;
let connecting = null;
let reqSeq = 0;
const pending = new Map();

function openConn() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
    });
    ws.on('close', () => {
      if (conn === ws) conn = null;
      for (const [id, p] of pending) { pending.delete(id); clearTimeout(p.timer); p.reject(new Error('conexão com o hub caiu; tenta de novo')); }
    });
  });
}

async function ensureConn() {
  if (conn && conn.readyState === WebSocket.OPEN) return conn;
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      conn = await openConn();
    } catch {
      // Ninguém escutando (ou o hub anterior morreu com a sessão dele): sobe um.
      await becomeHub();
      conn = await openConn();
    }
    return conn;
  })().finally(() => { connecting = null; });
  return connecting;
}

async function call(cmd, args = {}, timeoutMs = 30000) {
  const ws = await ensureConn();
  const id = ++reqSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout de ${timeoutMs / 1000}s esperando o Figma`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, cmd, args, target: targetFile }));
  });
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

const INSTRUCTIONS = `figma-mcp-lite: cria e edita no Figma Desktop por um plugin local.
Roda SEMPRE dentro de um subagente, nunca na conversa principal.
- Claude Code: agente \`figma-lite\` (Sonnet). Codex: agente \`figma-lite\` (gpt-6-luna).
- Outro cliente: pergunte ao usuário qual modelo usar, abra um subagente com ele e, dentro dele, chame figma_status com subagent_model.
Fluxo barato: figma_ds (cache) → UM figma_build por tela → UM figma_shot → correções pequenas com figma_run.`;

const server = new McpServer({ name: 'figma-mcp-lite', version: VERSION }, { instructions: INSTRUCTIONS });

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (e) => ({ content: [{ type: 'text', text: `erro: ${e.message || e}` }], isError: true });

function gate() {
  if (subagentModel) return null;
  return fail('cliente desconhecido. Pergunte ao usuário qual modelo deve rodar o trabalho de Figma, abra um subagente com esse modelo e, dentro dele, chame figma_status({subagent_model: "<modelo>"}) antes das outras ferramentas.');
}

const tool = (name, description, inputSchema, handler) =>
  server.registerTool(name, { description, inputSchema }, async (args) => {
    if (name !== 'figma_status') { const g = gate(); if (g) return g; }
    try { return await handler(args); } catch (e) { return fail(e); }
  });

tool('figma_status', 'Arquivo, página e seleção atuais. file escolhe o arquivo quando o plugin está aberto em mais de um (nome ou trecho). Em cliente desconhecido, informe subagent_model (o modelo que o usuário escolheu) pra liberar as outras ferramentas.',
  { subagent_model: z.string().optional(), file: z.string().optional() },
  async ({ subagent_model, file }) => {
    if (subagent_model) subagentModel = subagent_model;
    if (file) targetFile = file;
    const s = await call('status');
    return text(JSON.stringify(s));
  });

function dsPath(file) {
  return path.join(DS_DIR, `${String(file).replace(/[^\w.-]+/g, '_').slice(0, 80)}.md`);
}


const GUIDE_DIR = path.join(HOME, 'guides');
// Docs brutos (docs_vars) → guia compacto: só tokens públicos, alias resolvido
// até o valor final (light|dark) e a descrição sem a cauda de palavras-chave
// de busca que o DS anexa no fim ("fundo, background, plano de fundo, …").
function distill(raw) {
  const vars = {};
  const order = [];
  const lines = raw.split('\n');
  let primitive = false;
  for (let i = 0; i < lines.length; i++) {
    // Coleção com "_" ou "primit" no nome é camada bruta: só serve pra resolver alias.
    if (lines[i].startsWith('## ')) { primitive = /^## Coleção (_|.*primit)/i.test(lines[i]); continue; }
    const m = /^([^#\s][^=]*?) = (.+)$/.exec(lines[i]);
    if (!m) continue;
    const hidden = primitive || m[2].endsWith(' [oculto]');
    const desc = lines[i + 1] && lines[i + 1].startsWith('  ') ? lines[i + 1].trim() : '';
    vars[m[1]] = { vals: m[2].replace(' [oculto]', '').split(' | '), hidden, desc };
    order.push(m[1]);
  }
  const resolve = (v, mode, depth = 0) => {
    if (!v.startsWith('→') || depth > 8) return v;
    const t = vars[v.slice(1)];
    if (!t) return v.slice(1);
    return resolve(t.vals[Math.min(mode, t.vals.length - 1)], mode, depth + 1);
  };
  const trimDesc = (d) => {
    const parts = d.split(/(?<=\.)\s+/);
    // A cauda de busca é uma lista de palavras sem ponto final no fim.
    const last = parts[parts.length - 1];
    if (parts.length > 1 && !/[.!?)]$/.test(last) && (last.match(/,/g) || []).length >= 3) parts.pop();
    else if (!/[.!?)]$/.test(last) && (last.match(/,/g) || []).length >= 3) {
      const cut = last.lastIndexOf('. ');
      if (cut > 0) parts[parts.length - 1] = last.slice(0, cut + 1);
    }
    const out = parts.join(' ');
    return out.length > 260 ? out.slice(0, 258) + '…' : out;
  };
  // Exemplos de uso do Playground: "heading/x-small ¦ Especificações" vira
  // exemplo do papel (nome do Text Style por extenso → tier abreviado do token).
  const TIER = { '2x-large': '2xl', 'x-large': 'xl', large: 'lg', medium: 'md', small: 'sm', 'x-small': 'xs', '2x-small': '2xs' };
  const isStyle = (x) => /^(display|heading|body)\/[a-z0-9-]+(\/(default|strong))?$/.test(x);
  const examples = {};
  let inPlayground = false;
  for (const l of lines) {
    if (l.startsWith('## ')) { inPlayground = /playground/i.test(l); continue; }
    if (!inPlayground || l.startsWith('#')) continue;
    const items = l.split(' ¦ ');
    items.forEach((x, i) => {
      const next = items[i + 1];
      if (!isStyle(x) || !next || isStyle(next)) return;
      const [role, tier, emph] = x.split('/');
      examples[[role, TIER[tier] || tier].join('/') + (emph === 'strong' ? '/strong' : '')] = next;
    });
  }
  const fmtVal = (v) => (/^-?\d+\.\d{3,}$/.test(v) ? String(Math.round(Number(v) * 100) / 100) : v);
  const out = [];
  const roles = {};
  for (const n of order) {
    if (vars[n].hidden) continue;
    const v = vars[n];
    const vals = v.vals.map((x, i) => fmtVal(resolve(x, i)));
    const val = vals.every((x) => x === vals[0]) ? vals[0] : vals.join('|');
    // Papel tipográfico: 4–5 variáveis que sempre andam juntas viram uma linha.
    const m = /^text\/(display|heading|body)\/([^/]+)\/(.+)$/.exec(n);
    if (m) {
      const key = `${m[1]}/${m[2]}`;
      if (!roles[key]) { roles[key] = []; out.push({ role: key }); }
      roles[key].push(m[3].replace('font-', '').replace('letter-spacing', 'ls%').replace('line-height', 'lh') + ' ' + val);
      continue;
    }
    out.push(`$${n} ${val}${v.desc ? ' · ' + trimDesc(v.desc) : ''}`);
  }
  return out.map((o) => {
    if (typeof o === 'string') return o;
    const ex = [examples[o.role], examples[o.role + '/strong']].filter(Boolean);
    return `type ${o.role}: ${roles[o.role].join(', ')}` +
      (ex.length ? ` · ex.: "${ex[0]}"${ex[1] ? `, strong "${ex[1]}"` : ''}` : '');
  }).join('\n');
}

function guideLines(filter) {
  if (!fs.existsSync(GUIDE_DIR)) return '';
  const fs_ = (filter || '').toLowerCase().split('|').map((x) => x.trim()).filter(Boolean);
  const lines = fs.readdirSync(GUIDE_DIR).filter((f) => f.endsWith('.md'))
    .flatMap((f) => fs.readFileSync(path.join(GUIDE_DIR, f), 'utf8').split('\n'))
    .filter((l) => l && (!fs_.length || fs_.some((x) => l.toLowerCase().includes(x))));
  return compact(lines.join('\n'));
}

tool('figma_ds', 'Catálogo do design system do arquivo: variáveis locais e de todas as bibliotecas habilitadas (valor + descrição de uso), estilos e componentes (com key). Escaneia uma vez e guarda no arquivo; refresh=true reescaneia. Modo plugin.',
  {
    filter: z.string().optional().describe('só linhas com um destes trechos, separados por | (ex.: "bg/|text/|padding|gap|radius|heading|button")'),
    refresh: z.boolean().optional(),
    docs: z.boolean().optional().describe('só em arquivo de DEFINIÇÃO de uma biblioteca: extrai a documentação (variáveis com descrição completa, playgrounds, exemplos) pra um guia local; devolve só o tamanho'),
  },
  async ({ filter, refresh, docs }) => {
    let file = null;
    try { ({ file } = await call('status', {}, 8000)); } catch (e) { if (docs || refresh) throw e; }
    if (docs) {
      const dir = path.join(HOME, 'docs');
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, path.basename(dsPath(file)));
      fs.writeFileSync(p, await call('docs_vars', {}, 120000));
      const pages = await call('docs_pages');
      const failed = [];
      for (const pg of pages) {
        try { fs.appendFileSync(p, '\n' + (await call('docs_page', { id: pg.id }, 120000))); }
        catch (e) { failed.push(`${pg.name}: ${e.message}`); }
      }
      const raw = fs.readFileSync(p, 'utf8');
      const guide = distill(raw);
      fs.mkdirSync(GUIDE_DIR, { recursive: true });
      const gp = path.join(GUIDE_DIR, path.basename(p));
      fs.writeFileSync(gp, guide);
      return text(`docs de "${file}" em ${p}: ${pages.length} páginas, ~${Math.round(raw.length / 4)} tokens brutos → guia ${gp}: ${guide.split('\n').length} linhas, ~${Math.round(guide.length / 4)} tokens` +
        (failed.length ? `\nfalharam: ${failed.join('; ')}` : ''));
    }
    let md = file ? await call('ds', { filter, refresh }, 180000)
      : 'plugin fechado: no modo remoto o catálogo vem do use_figma (L.catalog).';
    // Guias extraídos de arquivos de definição (figma_ds docs): têm a descrição
    // escrita pelo dono da biblioteca; entram filtrados e compactos.
    const guide = guideLines(filter);
    if (guide) md += '\n## Guias extraídos das bibliotecas\n' + guide;
    return text(md);
  });

// Compacto: pra montar tela basta valor light e a 1ª frase da descrição, que
// diz o papel do token. O dark e o resto da descrição só com detail.
function compact(md) {
  return md.split('\n').map((l) => {
    const m = /^(\$\S+) (\S+?)(?:\|\S+)? · (.*)$/.exec(l);
    if (!m) return l;
    let d = m[3].split(/(?<=\.)\s/)[0].replace(/\.$/, '');
    if (d.length > 80) d = d.slice(0, 78) + '…';
    return `${m[1]} ${m[2]} · ${d}`;
  }).join('\n');
}

// Modo remoto (sem janela): o builder roda dentro do use_figma do MCP oficial,
// guardado no arquivo. Esta ferramenta só entrega o código de instalação.
const REMOTE = [path.join(HERE, 'remote.js'), path.join(HERE, '..', 'dist', 'remote.js')].find((p) => fs.existsSync(p));

tool('figma_lite_install', 'Modo remoto: devolve o código JS pra colar no use_figma oficial e instalar o builder lite no arquivo (uma vez por arquivo/versão). Cole o retorno EXATAMENTE como veio.',
  {},
  async () => {
    const src = fs.readFileSync(REMOTE, 'utf8');
    const version = VERSION;
    return text(`Versão ${version}. O use_figma deve devolver {"v":"${version}","len":${src.length}}; len diferente = erro de cópia, reinstale.\n` +
      `const s=String.raw\`${src}\`;figma.root.setSharedPluginData('lite','lib',s);return {v:new Function(s+';return L')()(figma).v,len:s.length}`);
  });

tool('figma_build', 'Cria uma tela/bloco inteiro a partir de uma spec JSON numa chamada só (formato no prompt do agente). Retorna id do nó raiz e avisos.',
  { spec: z.any().describe('nó raiz da spec'), parent: z.string().optional().describe('id do nó onde inserir; padrão: nova raiz na página') },
  async ({ spec, parent }) => {
    const s = typeof spec === 'string' ? JSON.parse(spec) : spec;
    return text(JSON.stringify(await call('build', { spec: s, parent }, 120000)));
  });

tool('figma_run', 'Executa JS da Plugin API (async; `figma` e helpers `h` disponíveis). Use pra correções pontuais. Retorne algo pequeno — a saída é cortada em max_chars.',
  { code: z.string(), max_chars: z.number().optional() },
  async ({ code, max_chars }) => text(await call('run', { code, max: max_chars || 2000 }, 120000)));

tool('figma_tree', 'Contorno compacto de um nó (tipo, id, nome, tamanho). Padrão: seleção ou página atual.',
  { id: z.string().optional(), depth: z.number().optional(), max_lines: z.number().optional() },
  async ({ id, depth, max_lines }) => text(await call('tree', { id, depth: depth ?? 2, max: max_lines || 120 })));

tool('figma_shot', 'PNG pequeno de um nó pra conferir o resultado. Use uma vez no fim, não a cada passo.',
  { id: z.string(), width: z.number().optional().describe('largura máx em px, padrão 480') },
  async ({ id, width }) => {
    const b64 = await call('shot', { id, width: width || 480 }, 60000);
    return { content: [{ type: 'image', data: b64, mimeType: 'image/png' }] };
  });

// Sobe o hub logo no boot (se a porta estiver livre) pra o plugin achar
// alguém escutando assim que o usuário abrir ele.
ensureConn().catch(() => {});
await server.connect(new StdioServerTransport());

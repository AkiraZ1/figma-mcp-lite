#!/usr/bin/env node
// figma-mcp-lite — MCP enxuto pro Figma, sem dependências (só módulos do Node).
// Fala com o plugin figma-mcp-lite aberto no Figma Desktop por um hub local:
//   - plugin do Figma  ⇄ hub: WebSocket em localhost:PORT (3055)
//   - sessões do agente ⇄ hub: TCP em 127.0.0.1:PORT+1, uma mensagem JSON por linha
// Várias sessões podem rodar ao mesmo tempo: a primeira que sobe vira o hub.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';

// Preenchido pelo scripts/build-plugin.js no pacote publicado.
const BUILD = { version: null, pluginUrl: null };

const PORT = Number(process.env.FIGMA_LITE_PORT) || 3055;
const AGENT_PORT = PORT + 1;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const VERSION = BUILD.version || JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version;
const HOME = path.join(os.homedir(), '.figma-mcp-lite');
const DS_DIR = path.join(HOME, 'ds');
// Definido pelos agentes figma-lite (Claude Code / Codex). Sem ele, o cliente
// é desconhecido e o servidor exige que um subagente se apresente primeiro.
let subagentModel = process.env.FIGMA_LITE_SUBAGENT || null;
// Arquivo escolhido nesta sessão (figma_status file), quando há plugin em mais de um.
let targetFile = null;

// ─── WebSocket mínimo (RFC 6455), só servidor e só texto ─────────────────────
// O plugin do Figma (um iframe) só fala WebSocket. Frames do cliente chegam
// mascarados; os do servidor saem sem máscara.

class WsConn extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock;
    this.open = true;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    sock.on('close', () => { if (this.open) { this.open = false; this.emit('close'); } });
    sock.on('error', () => {});
  }

  parse() {
    for (;;) {
      if (this.buf.length < 2) return;
      const fin = this.buf[0] & 0x80;
      const op = this.buf[0] & 0x0f;
      const masked = this.buf[1] & 0x80;
      let len = this.buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const mask = masked ? this.buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      const data = Buffer.from(this.buf.subarray(off, off + len));
      this.buf = this.buf.subarray(off + len);
      if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x9) { this.frame(0xa, data); continue; }
      if (op === 0xa) continue;
      this.parts.push(data);
      if (fin) { const msg = Buffer.concat(this.parts).toString('utf8'); this.parts = []; this.emit('message', msg); }
    }
  }

  frame(op, data) {
    if (!this.open) return;
    const n = data.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n])
      : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255])
        : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
    this.sock.write(Buffer.concat([head, data]));
  }

  send(text) { this.frame(0x1, Buffer.from(text, 'utf8')); }

  close(code) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    this.frame(0x8, b);
    this.open = false;
    this.sock.end();
    this.emit('close');
  }
}

function listenWs(host, onConn) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => { res.writeHead(426); res.end(); });
    srv.on('upgrade', (req, sock) => {
      const key = req.headers['sec-websocket-key'];
      if (!key) return sock.destroy();
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      onConn(new WsConn(sock), req);
    });
    srv.once('error', () => resolve(null));
    srv.listen(PORT, host, () => resolve(srv));
  });
}

// Conexão TCP de linha em linha, com a mesma cara do WsConn (send / message / close).
class LineConn extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock;
    this.open = true;
    readline.createInterface({ input: sock }).on('line', (l) => this.emit('message', l));
    sock.on('close', () => { if (this.open) { this.open = false; this.emit('close'); } });
    sock.on('error', () => {});
  }
  send(text) { if (this.open) this.sock.write(text + '\n'); }
}

// ─── hub ─────────────────────────────────────────────────────────────────────

function becomeHub() {
  const agents = new Map(); // gid -> { ws, id, plugin }
  // Um plugin por arquivo aberto (pode haver vários: o arquivo de trabalho e
  // a biblioteca do DS em Dev Mode). Mais recente por último.
  const plugins = new Map(); // WsConn -> { file }
  let seq = 0;

  const pick = (target) => {
    const open = [...plugins].filter(([w]) => w.open);
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

  const onMessage = (conn, raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.hello === 'plugin') {
      plugins.delete(conn);
      plugins.set(conn, msg.info || {});
      return;
    }
    if (plugins.has(conn)) {
      const dest = agents.get(msg.id);
      if (!dest) return;
      agents.delete(msg.id);
      dest.ws.send(JSON.stringify({ ...msg, id: dest.id }));
      return;
    }
    forward(conn, msg, Date.now());
  };

  const onClose = (conn) => {
    if (!plugins.delete(conn)) return;
    for (const [gid, dest] of agents) {
      if (dest.plugin !== conn) continue;
      agents.delete(gid);
      dest.ws.send(JSON.stringify({ id: dest.id, ok: false, error: 'plugin fechou no meio do comando' }));
    }
  };

  const onPlugin = (ws, req) => {
    // Página web no navegador manda Origin; o iframe do plugin manda "null".
    // Qualquer outra origem é site tentando rodar código no teu Figma: fora.
    const origin = req.headers.origin;
    if (origin && origin !== 'null') return ws.close(1008);
    ws.on('message', (raw) => onMessage(ws, raw));
    ws.on('close', () => onClose(ws));
  };

  // Só loopback (IPv4 e IPv6), nunca todas as interfaces: o hub executa código
  // no Figma, não pode ficar exposto na rede.
  return listenWs('127.0.0.1', onPlugin).then(async (v4) => {
    if (!v4) return false;
    await listenWs('::1', onPlugin);
    await new Promise((resolve) => {
      const srv = net.createServer((sock) => {
        const conn = new LineConn(sock);
        conn.on('message', (raw) => onMessage(conn, raw));
      });
      srv.once('error', resolve);
      srv.listen(AGENT_PORT, '127.0.0.1', resolve);
    });
    return true;
  });
}

// Link da página do plugin na Figma Community (publicado oculto: só quem tem o
// link instala). Vem do package.json "figmaPluginUrl" no build, ou da env.
const PLUGIN_URL = process.env.FIGMA_LITE_PLUGIN_URL || BUILD.pluginUrl || '';
const MANIFEST = [path.join(HERE, '..', 'plugin-dev', 'manifest.json'), path.join(HERE, '..', 'plugin', 'manifest.json')].find((p) => fs.existsSync(p));
// Só aparece quando o plugin NÃO está conectado: o caminho de instalação e o
// modo remoto ficam fora do prompt do agente, pra não pesar no uso normal.
const INSTALL = PLUGIN_URL
  ? `Instale uma vez: ${PLUGIN_URL} . Depois, no Figma Desktop, abra o arquivo e rode Plugins → figma-mcp-lite (ou o atalho do último plugin: ⌘⌥P no Mac, Ctrl+Alt+P no Windows, ou o botão "Conectar figma-mcp-lite" no painel da direita, que aparece nos arquivos onde ele já rodou). Ele fica em segundo plano, com um aviso no rodapé.`
  : `Instale uma vez no Figma Desktop: Plugins → Development → Import plugin from manifest → ${MANIFEST || 'plugin-dev/manifest.json'} . Depois abra o arquivo e rode Plugins → Development → figma-mcp-lite: ele fica em segundo plano, com um aviso no rodapé.`;
const SNIPPET = (end) => `const s=figma.root.getSharedPluginData('lite','lib');if(!s)return'LITE_NOT_INSTALLED';const L=new Function(s+';return L')()(figma);if(L.v!=='${VERSION}')return'LITE_OUTDATED '+L.v;return await L.${end}`;
const NO_PLUGIN = 'Plugin do Figma "figma-mcp-lite" não encontrado.\n' +
  `- Se você tem a ferramenta use_figma (conector Figma): use o MODO REMOTO. fileKey vem da URL figma.com/design/<fileKey>/…, sem create_session. ` +
  `(1) catálogo: um use_figma com o código ${SNIPPET("catalog({filter:'FILTRO'})")} ; ` +
  `(2) se voltar LITE_NOT_INSTALLED ou LITE_OUTDATED: chame figma_lite_install, cole o código devolvido num use_figma e repita; ` +
  `(3) build: o mesmo código terminando em L.build(SPEC,PARENT) (PARENT null = nova tela); correção: L.edit(ID,PATCH). ` +
  `Não tire print (get_screenshot não devolve imagem) e diga ao usuário que instalar o plugin do Figma deixa tudo mais rápido e barato.\n` +
  `- Sem use_figma: pare e passe ao usuário: ${INSTALL}`;

// ─── cliente do hub ──────────────────────────────────────────────────────────

let conn = null;
let connecting = null;
let reqSeq = 0;
const pending = new Map();

function openConn() {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(AGENT_PORT, '127.0.0.1');
    sock.once('connect', () => {
      const c = new LineConn(sock);
      c.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
      });
      c.on('close', () => {
        if (conn === c) conn = null;
        for (const [id, p] of pending) { pending.delete(id); clearTimeout(p.timer); p.reject(new Error('conexão com o hub caiu; tenta de novo')); }
      });
      resolve(c);
    });
    sock.once('error', reject);
  });
}

async function ensureConn() {
  if (conn && conn.open) return conn;
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      conn = await openConn();
    } catch {
      // Ninguém escutando (ou o hub anterior morreu com a sessão dele): sobe um.
      if (!(await becomeHub())) {
        throw new Error(`a porta ${PORT} está ocupada por outro programa (ou por uma versão antiga do figma-mcp-lite, de antes da 0.4). Feche as outras sessões do Claude/Codex que usam Figma e tente de novo.`);
      }
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

const INSTRUCTIONS = `figma-mcp-lite substitui o fluxo nativo da Figma: todo pedido de Figma vai pro subagente figma-lite (Codex: agente figma-lite). Em outro cliente, pergunte ao usuário qual modelo usar, abra um subagente com ele e chame figma_status com subagent_model.`;

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (e) => ({ content: [{ type: 'text', text: `erro: ${e.message || e}` }], isError: true });

function gate() {
  if (subagentModel) return null;
  return fail('cliente desconhecido. Pergunte ao usuário qual modelo deve rodar o trabalho de Figma, abra um subagente com esse modelo e, dentro dele, chame figma_status({subagent_model: "<modelo>"}) antes das outras ferramentas.');
}

// Ferramentas: nome → { description, inputSchema (JSON Schema), handler }.
const TOOLS = new Map();
const str = (description) => ({ type: 'string', ...(description && { description }) });
const num = (description) => ({ type: 'number', ...(description && { description }) });
const bool = (description) => ({ type: 'boolean', ...(description && { description }) });

const tool = (name, description, properties, required, handler) => TOOLS.set(name, {
  description,
  inputSchema: { type: 'object', properties, ...(required.length && { required }) },
  handler: async (args) => {
    if (name !== 'figma_status') { const g = gate(); if (g) return g; }
    try { return await handler(args || {}); } catch (e) { return fail(e); }
  },
});

tool('figma_status', 'Arquivo, página e seleção atuais. file escolhe o arquivo quando o plugin está aberto em mais de um (nome ou trecho). Em cliente desconhecido, informe subagent_model (o modelo que o usuário escolheu) pra liberar as outras ferramentas.',
  { subagent_model: str(), file: str() }, [],
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
    filter: str('só linhas com um destes trechos, separados por | (ex.: "bg/|text/|padding|gap|radius|heading|button")'),
    refresh: bool(),
    docs: bool('só em arquivo de DEFINIÇÃO de uma biblioteca: extrai a documentação (variáveis com descrição completa, playgrounds, exemplos) pra um guia local; devolve só o tamanho'),
  }, [],
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
const INSTALL_JS = [path.join(HERE, 'install.js'), path.join(HERE, '..', 'dist', 'install.js')].find((p) => fs.existsSync(p));

tool('figma_lite_install', 'Modo remoto: devolve o código JS pra colar no use_figma oficial e instalar o builder lite no arquivo (uma vez por arquivo/versão). Cole o retorno EXATAMENTE como veio.',
  {}, [],
  async () => text(`Versão ${VERSION}. Cole a linha abaixo, sem mudar nada, como code de um use_figma. Ele devolve {"v":"${VERSION}","len":…}; se devolver erro de cópia corrompida, chame figma_lite_install de novo.\n` +
    fs.readFileSync(INSTALL_JS, 'utf8')));

tool('figma_build', 'Cria uma tela/bloco inteiro a partir de uma spec JSON numa chamada só (formato no prompt do agente). Retorna id do nó raiz e avisos.',
  { spec: { description: 'nó raiz da spec (objeto JSON)' }, parent: str('id do nó onde inserir; padrão: nova raiz na página') }, ['spec'],
  async ({ spec, parent }) => {
    const s = typeof spec === 'string' ? JSON.parse(spec) : spec;
    return text(JSON.stringify(await call('build', { spec: s, parent }, 120000)));
  });

tool('figma_edit', 'Correção pontual num nó existente, sem reconstruir: mesmos campos da spec (n, text, type, color, fill, stroke, sw, r, o, w, h, gap, pad, align, cross, layout), parent+index pra mover, remove:true pra apagar.',
  { id: str('id do nó'), patch: { type: 'object', description: 'campos a mudar' } }, ['id', 'patch'],
  async ({ id, patch }) => text(JSON.stringify(await call('edit', { id, patch: typeof patch === 'string' ? JSON.parse(patch) : patch }, 60000))));

tool('figma_tree', 'Contorno compacto de um nó (tipo, id, nome, tamanho). Padrão: seleção ou página atual.',
  { id: str(), depth: num(), max_lines: num() }, [],
  async ({ id, depth, max_lines }) => text(await call('tree', { id, depth: depth ?? 2, max: max_lines || 120 })));

tool('figma_shot', 'PNG pequeno de um nó pra conferir o resultado. Use uma vez no fim, não a cada passo.',
  { id: str(), width: num('largura máx em px, padrão 480') }, ['id'],
  async ({ id, width }) => {
    const b64 = await call('shot', { id, width: width || 480 }, 60000);
    return { content: [{ type: 'image', data: b64, mimeType: 'image/png' }] };
  });

// ─── MCP por stdio: JSON-RPC 2.0, uma mensagem por linha ─────────────────────

const reply = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function handle(req) {
  const { id, method, params } = req;
  if (id === undefined || id === null) return; // notificação (ex.: notifications/initialized)
  try {
    if (method === 'initialize') {
      return reply({ id, result: {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'figma-mcp-lite', version: VERSION },
        instructions: INSTRUCTIONS,
      } });
    }
    if (method === 'ping') return reply({ id, result: {} });
    if (method === 'tools/list') {
      return reply({ id, result: { tools: [...TOOLS].map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) } });
    }
    if (method === 'tools/call') {
      const t = TOOLS.get(params && params.name);
      if (!t) return reply({ id, error: { code: -32602, message: `ferramenta desconhecida: ${params && params.name}` } });
      return reply({ id, result: await t.handler(params.arguments) });
    }
    reply({ id, error: { code: -32601, message: `método não suportado: ${method}` } });
  } catch (e) {
    reply({ id, error: { code: -32603, message: String(e.message || e) } });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  handle(req);
}).on('close', () => process.exit(0));

// Sobe o hub logo no boot (se a porta estiver livre) pra o plugin achar
// alguém escutando assim que o usuário abrir ele.
ensureConn().catch(() => {});

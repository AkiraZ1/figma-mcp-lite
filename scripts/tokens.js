#!/usr/bin/env node
// Medidor de tokens dos subagentes figma-lite (Claude Code).
// Lê os transcripts em ~/.claude/projects/*/<sessão>/subagents e imprime, por
// execução: modelo, turnos, entrada nova, cache gravado/lido, saída e quanto
// cada ferramenta mandou/devolveu. Com --log, acrescenta o que é novo em
// TOKENS.md (histórico do desenvolvimento).
//   node scripts/tokens.js            → todas as execuções figma-lite
//   node scripts/tokens.js --last 3   → só as 3 mais recentes
//   node scripts/tokens.js --log      → grava as novas no TOKENS.md
//   node scripts/tokens.js --type general-purpose --last 1 → outro tipo de subagente
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'TOKENS.md');
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const args = process.argv.slice(2);
const last = args.includes('--last') ? Number(args[args.indexOf('--last') + 1]) : Infinity;
// --type <agentType> mede outro tipo de subagente (ex.: general-purpose rodando o
// MCP nativo da Figma, pra comparar nos mesmos termos). Padrão: figma-lite.
const TYPE = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'figma-lite';

function runs() {
  const out = [];
  for (const proj of fs.readdirSync(PROJECTS)) {
    const pdir = path.join(PROJECTS, proj);
    if (!fs.statSync(pdir).isDirectory()) continue;
    for (const sess of fs.readdirSync(pdir)) {
      const sdir = path.join(pdir, sess, 'subagents');
      if (!fs.existsSync(sdir)) continue;
      for (const f of fs.readdirSync(sdir)) {
        if (!f.endsWith('.meta.json')) continue;
        const meta = JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8'));
        if (meta.agentType !== TYPE) continue;
        const jsonl = path.join(sdir, f.replace('.meta.json', '.jsonl'));
        if (fs.existsSync(jsonl)) out.push(measure(jsonl, meta));
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

function measure(file, meta) {
  const r = { id: path.basename(file, '.jsonl').replace('agent-', ''), desc: meta.description, start: '', model: new Set(), turns: 0,
    input: 0, cacheWrite: 0, cacheRead: 0, output: 0, tools: {}, images: 0 };
  const names = {};
  // O transcript repete a mesma mensagem em várias linhas (streaming): conta cada id uma vez.
  const seenMsg = new Set();
  const seenBlock = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!r.start && o.timestamp) r.start = o.timestamp;
    const m = o.message || {};
    if (o.type === 'assistant' && m.usage && !seenMsg.has(m.id)) {
      seenMsg.add(m.id);
      r.turns++;
      if (m.model) r.model.add(m.model);
      r.input += m.usage.input_tokens || 0;
      r.cacheWrite += m.usage.cache_creation_input_tokens || 0;
      r.cacheRead += m.usage.cache_read_input_tokens || 0;
      r.output += m.usage.output_tokens || 0;
    }
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      const bid = b.id || (b.type === 'tool_result' && 'r' + b.tool_use_id);
      if (bid) { if (seenBlock.has(bid)) continue; seenBlock.add(bid); }
      if (b.type === 'tool_use') {
        const n = b.name.split('__').pop();
        names[b.id] = n;
        const t = (r.tools[n] ||= { calls: 0, sent: 0, got: 0 });
        t.calls++;
        t.sent += JSON.stringify(b.input).length;
      }
      if (b.type === 'tool_result') {
        const t = r.tools[names[b.tool_use_id]];
        if (!t) continue;
        for (const c of Array.isArray(b.content) ? b.content : [{ type: 'text', text: String(b.content || '') }]) {
          if (c.type === 'text') t.got += c.text.length;
          else r.images++;
        }
      }
    }
  }
  r.model = [...r.model].join(',').replace('claude-', '');
  return r;
}

const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
const tok = (chars) => k(Math.round(chars / 4));

function row(r) {
  const tools = Object.entries(r.tools).map(([n, t]) => `${n}×${t.calls} (→${tok(t.sent)} ←${tok(t.got)})`).join(', ');
  return `| ${r.start.slice(0, 16).replace('T', ' ')} | ${r.desc} | ${r.model} | ${r.turns} | ${k(r.input + r.cacheWrite)} | ${k(r.cacheRead)} | ${k(r.output)} | ${tools}${r.images ? `, ${r.images} img` : ''} |`;
}

const HEAD = '| quando (UTC) | tarefa | modelo | turnos | entrada nova | cache lido | saída | ferramentas (→enviado ←recebido) |\n|---|---|---|---|---|---|---|---|';
const all = runs().slice(-last);

if (args.includes('--log')) {
  const old = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '# Gasto de tokens — figma-mcp-lite (desenvolvimento)\n\nEntrada nova = entrada sem cache + cache gravado. Cache lido custa ~10% do preço normal.\n\n' + HEAD + '\n';
  const fresh = all.filter((r) => !old.includes(r.id));
  fs.writeFileSync(LOG, old + fresh.map((r) => row(r) + ` <!-- ${r.id} -->`).join('\n') + (fresh.length ? '\n' : ''));
  console.log(`${fresh.length} execuções novas registradas em ${LOG}`);
} else {
  console.log(HEAD);
  all.forEach((r) => console.log(row(r)));
}

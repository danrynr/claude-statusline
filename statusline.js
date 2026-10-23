#!/usr/bin/env node
// Claude Code status line: dir, branch, model, effort, caveman mode, detailed context usage.
// Runs locally on each refresh; never calls the model, so it costs no tokens.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CFG = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};
const paint = (color, s) => `${color}${s}${c.reset}`;
const sep = paint(c.dim, ' │ ');

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// Strip C0/C1 control characters (incl. ESC) from any string that did not come from this
// script, so transcripts, project settings or folder names can't inject terminal escapes.
const clean = (s, max = 80) => String(s == null ? '' : s).replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, max);

function fmtTokens(n) {
  if (n == null || isNaN(n)) return '?';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

function pctColor(p) {
  return p >= 80 ? c.red : p >= 50 ? c.yellow : c.green;
}

// Tick bar with a zoned track: low (<50%) green, mid (<80%) yellow, high red.
// Filled ticks are bright in their zone's color; unfilled ticks are the same color dimmed,
// so the low/mid/high zones are always visible and the fill shows which zone you're in.
const ZONES = [
  { upTo: 50, on: '\x1b[1;92m', off: '\x1b[2;32m' },
  { upTo: 80, on: '\x1b[1;93m', off: '\x1b[2;33m' },
  { upTo: 101, on: '\x1b[1;91m', off: '\x1b[2;31m' },
];
function bar(p, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((p / 100) * width)));
  let out = '';
  for (let i = 0; i < width; i++) {
    const zone = ZONES.find((z) => ((i + 0.5) / width) * 100 < z.upTo);
    out += (i < filled ? zone.on : zone.off) + '|' + c.reset;
  }
  return out;
}

function gitBranch(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, '--no-optional-locks', 'branch', '--show-current'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 500,
    }).trim();
  } catch { return ''; }
}

// Same rules as caveman's own statusline: per-session file first, then global flag;
// refuse symlinks and strip anything outside [a-z0-9-].
function cavemanMode(sessionId) {
  let flag = path.join(CFG, '.caveman-active');
  if (/^[A-Za-z0-9_-]{1,128}$/.test(sessionId || '')) {
    const per = path.join(CFG, '.caveman-sessions', `${sessionId}.mode`);
    if (fs.existsSync(per)) flag = per;
  }
  try {
    if (fs.lstatSync(flag).isSymbolicLink()) return '';
    const fd = fs.openSync(flag, 'r');
    const buf = Buffer.alloc(64);
    const n = fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);
    return buf.toString('utf8', 0, n).toLowerCase().replace(/[^a-z0-9-]/g, '');
  } catch { return ''; }
}

// Only known levels are returned; project settings files are untrusted input.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
function effortLevel(input, cwd) {
  const known = (v) => {
    const s = typeof v === 'string' ? v.toLowerCase() : '';
    return EFFORT_LEVELS.includes(s) ? s : '';
  };
  const e = input.effort;
  const candidates = [
    e && typeof e === 'object' ? e.level : e,
    process.env.CLAUDE_CODE_EFFORT_LEVEL,
    // Most specific settings file wins.
    readJson(path.join(cwd, '.claude', 'settings.local.json')).effortLevel,
    readJson(path.join(cwd, '.claude', 'settings.json')).effortLevel,
    readJson(path.join(CFG, 'settings.json')).effortLevel,
  ];
  for (const v of candidates) {
    const lvl = known(v);
    if (lvl) return lvl;
  }
  return '';
}

// Per-user cache dir (not the shared temp dir), created private.
function cacheDir() {
  const dir = path.join(CFG, 'cache', 'statusline');
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
  return dir;
}

// Load a cache file only if it is a regular file (not a symlink) and its fields are sane.
function loadCache(cacheFile, file, size, empty) {
  try {
    if (!fs.lstatSync(cacheFile).isFile()) return null;
  } catch { return null; }
  const st = readJson(cacheFile);
  if (!st || st.file !== file || !Number.isInteger(st.offset) || st.offset < 0 || st.offset > size) return null;
  const counts = (o) => {
    const out = {};
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) if (Number.isInteger(v) && v > 0) out[clean(k, 40)] = v;
    }
    return out;
  };
  return {
    ...empty, file, offset: st.offset,
    ids: Array.isArray(st.ids) ? st.ids.filter((x) => typeof x === 'string').slice(-2000) : [],
    tools: counts(st.tools), plugins: counts(st.plugins), mcp: counts(st.mcp),
    last: clean(st.last, 40),
  };
}

// Write via a fresh temp file + rename, so a pre-planted symlink is replaced, never followed.
function saveCache(cacheFile, st) {
  const tmp = `${cacheFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(st), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, cacheFile);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// Scans the transcript incrementally (cached offset per session), so refreshes stay fast.
function scanTranscript(file, sessionId) {
  const empty = { offset: 0, ids: [], tools: {}, plugins: {}, mcp: {}, last: '' };
  if (!file || !fs.existsSync(file)) return empty;
  const id = /^[A-Za-z0-9_-]{1,128}$/.test(sessionId || '') ? sessionId : 'unknown';
  const cacheFile = path.join(cacheDir(), `${id}.json`);
  const size = fs.statSync(file).size;
  const st = loadCache(cacheFile, file, size, empty) || { ...empty, file };
  if (size > st.offset) {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - st.offset);
    fs.readSync(fd, buf, 0, buf.length, st.offset);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const end = text.lastIndexOf('\n');
    if (end >= 0) {
      const seen = new Set(st.ids);
      for (const line of text.slice(0, end).split('\n')) {
        if (!line.includes('"tool_use"')) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const content = msg && msg.message && msg.message.content;
        if (!Array.isArray(content)) continue;
        for (const b of content) {
          if (!b || b.type !== 'tool_use' || seen.has(b.id)) continue;
          seen.add(b.id);
          recordTool(st, b.name || '?', b.input || {});
        }
      }
      st.ids = [...seen].slice(-2000);
      st.offset += Buffer.byteLength(text.slice(0, end + 1), 'utf8');
    }
    saveCache(cacheFile, st);
  }
  return st;
}

function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

function recordTool(st, rawName, inp) {
  const name = clean(rawName, 120);
  st.last = name;
  let short = name;
  let m;
  if ((m = /^mcp__plugin_([^_]+)_([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name))) {
    bump(st.plugins, m[1]); bump(st.mcp, m[2]); short = `${m[2]}:${m[3]}`;
  } else if ((m = /^mcp__claude_ai_(.+?)__(.+)$/.exec(name))) {
    bump(st.mcp, m[1].replace(/_/g, ' ')); short = `${m[1]}:${m[2]}`;
  } else if ((m = /^mcp__(.+?)__(.+)$/.exec(name))) {
    bump(st.mcp, m[1]); short = `${m[1]}:${m[2]}`;
  }
  if (name === 'Skill' && typeof inp.skill === 'string' && inp.skill.includes(':')) {
    bump(st.plugins, clean(inp.skill.split(':')[0], 40));
  }
  if (name === 'Agent' && typeof inp.subagent_type === 'string' && inp.subagent_type.includes(':')) {
    bump(st.plugins, clean(inp.subagent_type.split(':')[0], 40));
  }
  if (name === 'Bash' || name === 'PowerShell') {
    if (/\bcodegraph(\.cmd)?\s/.test(String(inp.command || ''))) bump(st.mcp, 'codegraph');
  }
  st.last = short;
  bump(st.tools, short.length > 24 ? short.slice(0, 23) + '…' : short);
}

// Whether a command is on PATH, by file lookups alone (no process spawned).
function onPath(cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try { if (fs.statSync(path.join(dir, cmd + ext)).isFile()) return true; } catch {}
    }
  }
  return false;
}

function findUp(start, name) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, name))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return '';
    dir = parent;
  }
}

function resetIn(resetsAt) {
  if (resetsAt == null) return '';
  const t = typeof resetsAt === 'number' ? (resetsAt < 1e12 ? resetsAt * 1000 : resetsAt) : Date.parse(resetsAt);
  if (isNaN(t)) return '';
  const mins = Math.max(0, Math.round((t - Date.now()) / 60000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return d ? `${d}d ${String(h).padStart(2)}h` : h ? `${h}h ${String(m).padStart(2)}m` : `${m}m`;
}

// Effort badge matching Claude Code's own: same symbol per level and the same theme colors
// (low=warning, medium=success, high=permission, xhigh=autoAccept, max=rainbow).
const EFFORT_STYLE = {
  low: { sym: '○', dark: [255, 193, 7], light: [150, 108, 30] },
  medium: { sym: '◐', dark: [78, 186, 101], light: [44, 122, 57] },
  high: { sym: '●', dark: [177, 185, 249], light: [87, 105, 247] },
  xhigh: { sym: '◉', dark: [175, 135, 255], light: [135, 0, 255] },
  max: { sym: '◈', rainbow: true },
};
const RAINBOW = [[255, 95, 95], [255, 175, 0], [255, 255, 95], [95, 215, 95], [95, 175, 255], [175, 135, 255]];
const rgb = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`;
function effortBadge(level) {
  const st = EFFORT_STYLE[String(level).toLowerCase()];
  if (!st) return '';
  const text = `${st.sym} ${level}`;
  if (st.rainbow) return [...text].map((ch, i) => rgb(RAINBOW[i % RAINBOW.length]) + ch).join('') + c.reset;
  const theme = String(readJson(path.join(os.homedir(), '.claude.json')).theme || 'dark');
  return paint(rgb(theme.startsWith('light') ? st.light : st.dark), text);
}

const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
const dim = (s) => paint(c.dim, s);
const gap = '   ';
// Fixed-width row label so every row's content starts in the same column.
const row = (label, parts) => paint(c.bold + c.dim, label.padEnd(7)) + parts.filter(Boolean).join(gap);
const pctText = (p) => paint(pctColor(p), String(p).padStart(3) + '%');

// ---- gather ----
const input = readStdin();
const cwd = input.cwd || (input.workspace && input.workspace.current_dir) || process.cwd();
const home = os.homedir();
// Windows paths are case-insensitive; macOS/Linux compare exactly. Require a separator after
// home so /home/bob2 is not shown as ~2.
const norm = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
const underHome = norm(cwd) === norm(home) || norm(cwd).startsWith(norm(home) + path.sep);
let cwdDisplay = underHome ? '~' + cwd.slice(home.length) : cwd;
cwdDisplay = clean(cwdDisplay.split(path.sep).join('/'), 200);
const branch = clean(gitBranch(cwd));
const model = clean(input.model && (input.model.display_name || input.model.id));
const effort = effortLevel(input, cwd);
const mode = cavemanMode(input.session_id);
const enabledPlugins = readJson(path.join(CFG, 'settings.json')).enabledPlugins || {};
// Caveman and codegraph are optional: show them only for users who have them.
const hasCaveman = !!mode || Object.keys(enabledPlugins).some((k) => enabledPlugins[k] && k.startsWith('caveman@'));
const style = input.output_style && input.output_style.name;

const cw = input.context_window || {};
const size = cw.context_window_size || 200000;
const cu = cw.current_usage || null;
let used = null, cacheRead = 0, fresh = 0, lastOut = 0;
if (cu) {
  cacheRead = cu.cache_read_input_tokens || 0;
  fresh = (cu.input_tokens || 0) + (cu.cache_creation_input_tokens || 0);
  lastOut = cu.output_tokens || 0;
  used = cacheRead + fresh;
}
let pct = cw.used_percentage;
if (pct == null && used != null) pct = (used / size) * 100;
if (used == null && pct != null) used = (pct / 100) * size;

const rl = input.rate_limits;
const cost = input.cost && input.cost.total_cost_usd;
const scan = scanTranscript(input.transcript_path, input.session_id);

// ---- render ----
const lines = [];

// Header: who is answering (left), where (right)
const head = [];
if (model) head.push(paint(c.bold + c.yellow, model));
if (effort) head.push(effortBadge(effort));
if (mode && mode !== 'off') head.push(paint(c.yellow, `🪨 ${mode}`));
else if (hasCaveman) head.push(dim('caveman off'));
if (style && style !== 'default') head.push(dim(style));
if (input.vim && input.vim.mode) head.push(dim(`[${clean(input.vim.mode, 20)}]`));
let where = paint(c.cyan, cwdDisplay);
if (branch) where += ' ' + paint(c.magenta, `⎇ ${branch}`);
lines.push(head.join(dim('  ·  ')) + gap + dim('│') + gap + where);

// Context window
if (pct != null) {
  const p = Math.round(pct);
  lines.push(row('CTX', [
    `${bar(p)} ${pctText(p)}`,
    `${fmtTokens(used)} ${dim('/ ' + fmtTokens(size))}`,
    `${fmtTokens(Math.max(0, size - used))} ${dim('free')}`,
    cu && dim(`cache ${fmtTokens(cacheRead)} · new ${fmtTokens(fresh)} · out ${fmtTokens(lastOut)}`),
    p >= 80 && paint(c.red + c.bold, '⚠ /compact soon'),
  ]));
} else {
  lines.push(row('CTX', [dim('waiting for first response')]));
}

// Plan usage: one row per window, bars aligned under CTX, reset time in its own column
const limits = [['5H', rl && rl.five_hour], ['7D', rl && rl.seven_day]]
  .filter(([, w]) => w && w.used_percentage != null);
for (const [label, w] of limits) {
  const p = Math.round(w.used_percentage);
  const r = resetIn(w.resets_at);
  lines.push(row(label, [
    `${bar(p)} ${pctText(p)}`,
    r && dim('↻ resets in ') + r,
  ]));
}
if (!limits.length) lines.push(row('LIMITS', [dim('plan limits n/a')]));

// Session totals
const sess = [];
if (cw.total_input_tokens != null) sess.push(`${fmtTokens(cw.total_input_tokens)} ${dim('in')}`);
if (cw.total_output_tokens != null) sess.push(`${fmtTokens(cw.total_output_tokens)} ${dim('out')}`);
if (cost != null) sess.push(`$${cost.toFixed(2)} ${dim('api-equiv')}`);
if (sess.length) lines.push(row('SESS', [sess.join(dim('  ·  '))]));

// Tools
const totalCalls = Object.values(scan.tools).reduce((a, b) => a + b, 0);
lines.push(row('TOOLS', totalCalls ? [
  `${totalCalls} ${dim('calls')}`,
  top(scan.tools, 4).map(([k, v]) => `${k} ${dim(v)}`).join('  '),
  dim('last ') + scan.last,
] : [dim('none yet')]));

// Extensions: codegraph, plugins, MCP
const cgRoot = findUp(cwd, '.codegraph');
const cgUses = scan.mcp.codegraph || 0;
const cg = cgRoot
  ? paint(c.green, '●') + ' codegraph ' + (cgUses ? paint(c.green, `${cgUses}×`) : paint(c.yellow, 'idle'))
  : cgUses || onPath('codegraph') ? dim('○ codegraph' + (cgUses ? ` ${cgUses}×` : ' no index')) : '';
const enabled = Object.values(enabledPlugins).filter(Boolean).length;
const pluginsUsed = top(scan.plugins, 4).map(([k, v]) => `${k} ${dim(v)}`);
if (mode && mode !== 'off' && !scan.plugins.caveman) pluginsUsed.unshift(`caveman ${dim('hook')}`);
const mcpUsed = Object.keys(scan.mcp).filter((k) => k !== 'codegraph');
lines.push(row('EXT', [
  cg,
  dim(`plugins ${enabled}: `) + (pluginsUsed.length ? pluginsUsed.join('  ') : dim('none used')),
  mcpUsed.length && dim('mcp ') + top(scan.mcp, 4).map(([k]) => k).filter((k) => k !== 'codegraph').join(', '),
]));

process.stdout.write(lines.join('\n'));

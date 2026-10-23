#!/usr/bin/env node
// UwUSpeak installer. Installs, updates or removes the UwUSpeak plugin in a Vencord (or Equicord)
// source build, and points Discord or Vesktop at that build. install.ps1 and install.sh provide
// Node.js and start this file; it needs nothing else (git is optional). Run with --help for options.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const REPO = 'MagicCat3022/UwU_Speak';
const PLUGIN_DIR = 'uwuSpeak';
const PLUGIN_NAME = 'UwUSpeak';
const VERSION_FILE = '.uwuspeak-version';
const SNAPSHOT_FILE = '.uwuspeak-snapshot';
const MIN_NODE = [22, 13];

// `load` is what a patched Discord's app.asar requires and `renderer` holds the plugins, both
// relative to the source folder; `vesktop` is the folder Vesktop can load, when there is one.
const CLIENTS = {
  vencord: {
    name: 'Vencord',
    repo: 'Vendicated/Vencord',
    branch: 'main',
    load: 'dist/patcher.js',
    renderer: 'dist/renderer.js',
    vesktop: 'dist',
  },
  equicord: {
    name: 'Equicord',
    repo: 'Equicord/Equicord',
    branch: 'main',
    load: 'dist/desktop',
    renderer: 'dist/desktop/renderer.js',
  },
};

const inCheckout = (checkout, rel) => path.join(checkout.dir, ...rel.split('/'));
const samePath = (a, b) => Boolean(a && b) && path.resolve(a) === path.resolve(b);

const win = process.platform === 'win32';
const mac = process.platform === 'darwin';
const home = os.homedir();
const configHome = win
  ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  : mac
    ? path.join(home, 'Library', 'Application Support')
    : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
// install.ps1 and install.sh keep their private Node.js copy under the same folder.
export const stateDir = win
  ? path.join(localAppData, 'UwUSpeak')
  : mac
    ? path.join(configHome, 'UwUSpeak')
    : path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'uwuspeak');
const toolsDir = path.join(stateDir, 'tools');
const stateFile = path.join(stateDir, 'installer.json');

// ---------------------------------------------------------------------------------------------
// Options

const HELP = `UwUSpeak installer

Usage: install [options]

  -y, --yes              Accept every default without asking
      --uninstall        Remove UwUSpeak instead of installing it
      --target <list>    Comma-separated apps to set up: discord, discord-ptb, discord-canary,
                         discord-development, vesktop (add -flatpak for Flatpak installs),
                         all, or none to only build
      --dir <folder>     Vencord/Equicord source folder to use or create
      --client <name>    vencord (default) or equicord, for a new source folder
      --release <tag>    UwUSpeak release to install, such as v0.2.0 (default: latest)
      --plugin <file>    Install the plugin from a local uwuSpeak.tar.gz instead
      --no-git           Download Vencord as a snapshot even if git is installed
      --no-update        Don't update an existing Vencord/Equicord folder
      --reinstall        Download and rebuild even when everything is up to date
      --no-restart       Don't close or start Discord/Vesktop
      --dry-run          Show what would happen without changing anything
  -h, --help             Show this help`;

export function parseArgs(argv) {
  const opts = { yes: false, uninstall: false, git: true, update: true, restart: true };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s) : [arg];
    const take = (name) => (inline !== undefined ? inline : value(i++, name));
    switch (flag) {
      case '-y':
      case '--yes':
        opts.yes = true;
        break;
      case '--uninstall':
        opts.uninstall = true;
        break;
      case '--target':
        opts.targets = take(flag)
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        break;
      case '--dir':
        opts.dir = path.resolve(expandHome(take(flag)));
        break;
      case '--client': {
        const client = take(flag).toLowerCase();
        if (!CLIENTS[client]) throw new UsageError('--client must be vencord or equicord.');
        opts.client = client;
        break;
      }
      case '--release':
        opts.release = take(flag);
        break;
      case '--plugin':
        opts.plugin = path.resolve(expandHome(take(flag)));
        break;
      case '--no-git':
        opts.git = false;
        break;
      case '--reinstall':
        opts.reinstall = true;
        break;
      case '--no-update':
        opts.update = false;
        break;
      case '--no-restart':
        opts.restart = false;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new UsageError(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

class UsageError extends Error {}
class Cancelled extends Error {}

const expandHome = (p) =>
  p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? home + p.slice(1) : p;

// ---------------------------------------------------------------------------------------------
// Terminal UI

const out = process.stdout;
const tty = Boolean(out.isTTY);
const color = tty && !process.env.NO_COLOR;
// Legacy Windows consoles often lack these glyphs; Windows Terminal and VS Code have them.
const unicode = !win || Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM);
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  bold: paint(1),
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  magenta: paint(35),
  cyan: paint(36),
};
const sym = unicode
  ? {
      ok: '✔',
      fail: '✖',
      warn: '!',
      info: 'i',
      arrow: '›',
      pointer: '❯',
      dot: '•',
      frames: '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏',
    }
  : {
      ok: '+',
      fail: 'x',
      warn: '!',
      info: 'i',
      arrow: '>',
      pointer: '>',
      dot: '*',
      frames: '|/-\\',
    };

let interactive = false;

const say = (s = '') => out.write(s + '\n');
const ok = (s) => say(`${c.green(sym.ok)} ${s}`);
const warn = (s) => say(`${c.yellow(sym.warn)} ${s}`);
const info = (s) => say(`${c.cyan(sym.info)} ${s}`);
const note = (s) => say(c.dim(`  ${s}`));

function heading(title) {
  say();
  say(c.bold(c.magenta(title)));
}

function box(lines) {
  const width = Math.max(...lines.map((l) => strip(l).length));
  const [h, v, tl, tr, bl, br] = unicode ? '─│╭╮╰╯' : '-|++++';
  say(c.magenta(tl + h.repeat(width + 2) + tr));
  for (const l of lines)
    say(`${c.magenta(v)} ${l}${' '.repeat(width - strip(l).length)} ${c.magenta(v)}`);
  say(c.magenta(bl + h.repeat(width + 2) + br));
}

const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

function table(rows) {
  const width = Math.max(...rows.map((r) => strip(r[0]).length));
  for (const [a, b] of rows) say(`  ${a}${' '.repeat(width - strip(a).length)}  ${b}`);
}

/** Reads keypresses until `handle` returns true. */
function keys(handle) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    const done = (fn) => {
      input.off('keypress', onKey);
      input.setRawMode(false);
      input.pause();
      fn();
    };
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') return done(() => reject(new Cancelled()));
      try {
        if (handle(str, key)) done(resolve);
      } catch (e) {
        done(() => reject(e));
      }
    };
    input.on('keypress', onKey);
  });
}

/** Arrow-key menu. Returns the chosen item's value. */
async function select(question, items, defaultIndex = 0) {
  const index = Math.max(0, Math.min(defaultIndex, items.length - 1));
  if (!interactive) {
    say(`${c.cyan('?')} ${question} ${c.dim(sym.arrow)} ${items[index].label}`);
    return items[index].value;
  }
  let current = index;
  const render = (first) => {
    if (!first) out.write(`\x1b[${items.length + 1}A\x1b[0J`);
    say(`${c.cyan('?')} ${c.bold(question)} ${c.dim('(arrow keys, Enter to choose)')}`);
    // Lines must not wrap, or moving the cursor back up to redraw would miss some.
    const width = (out.columns || 80) - 1;
    items.forEach((item, i) => {
      const hint = item.hint ? c.dim(`  ${item.hint}`) : '';
      const mark = i === index ? c.dim(' (default)') : '';
      const line =
        i === current
          ? c.cyan(`${sym.pointer} ${item.label}`) + mark + hint
          : `  ${item.label}${mark}${hint}`;
      say(truncate(line, width));
    });
  };
  out.write('\x1b[?25l');
  render(true);
  try {
    await keys((str, key) => {
      if (key.name === 'up' || key.name === 'k')
        current = (current - 1 + items.length) % items.length;
      else if (key.name === 'down' || key.name === 'j' || key.name === 'tab')
        current = (current + 1) % items.length;
      else if (/^[1-9]$/.test(str ?? '') && Number(str) <= items.length) current = Number(str) - 1;
      else if (key.name === 'return' || key.name === 'enter') return true;
      else if (key.name === 'escape') throw new Cancelled();
      render(false);
      return false;
    });
  } finally {
    out.write('\x1b[?25h');
  }
  out.write(`\x1b[${items.length + 1}A\x1b[0J`);
  say(`${c.cyan('?')} ${question} ${c.dim(sym.arrow)} ${c.cyan(items[current].label)}`);
  return items[current].value;
}

/** Yes/no question answered with one key; Enter takes the default. */
async function confirm(question, def = true) {
  const hint = def ? 'Y/n' : 'y/N';
  if (!interactive) {
    say(`${c.cyan('?')} ${question} ${c.dim(sym.arrow)} ${def ? 'yes' : 'no'}`);
    return def;
  }
  out.write(`${c.cyan('?')} ${c.bold(question)} ${c.dim(`(${hint})`)} `);
  let answer = def;
  await keys((str, key) => {
    if (key.name === 'return' || key.name === 'enter') return true;
    if (key.name === 'escape') throw new Cancelled();
    if (/^y$/i.test(str ?? '')) return (answer = true);
    if (/^n$/i.test(str ?? '')) return !(answer = false);
    return false;
  });
  say(c.cyan(answer ? 'yes' : 'no'));
  return answer;
}

/** Free-text question; Enter takes the default. */
async function ask(question, def) {
  if (!interactive) {
    say(`${c.cyan('?')} ${question} ${c.dim(sym.arrow)} ${def}`);
    return def;
  }
  const rl = readline.createInterface({ input: process.stdin, output: out });
  try {
    const answer = await new Promise((resolve, reject) => {
      rl.on('SIGINT', () => reject(new Cancelled()));
      rl.question(`${c.cyan('?')} ${c.bold(question)} ${c.dim(`(${def})`)} `, resolve);
    });
    return answer.trim() || def;
  } finally {
    rl.close();
  }
}

let logStream;
let logPath;

function log(text) {
  logStream?.write(text.endsWith('\n') ? text : text + '\n');
}

/** Runs `fn` behind a spinner. `fn` receives `update(text)` to show progress next to the title. */
async function task(title, fn) {
  log(`\n=== ${title}`);
  const started = Date.now();
  let detail = '';
  let frame = 0;
  const draw = () => {
    const secs = Math.floor((Date.now() - started) / 1000);
    const extra = detail ? c.dim(`  ${detail}`) : '';
    const time = secs >= 3 ? c.dim(` ${secs}s`) : '';
    const line = `${c.cyan(sym.frames[frame++ % sym.frames.length])} ${title}${time}${extra}`;
    out.write(`\r\x1b[2K${truncate(line, (out.columns || 80) - 1)}`);
  };
  const timer = tty ? setInterval(draw, 100) : undefined;
  if (tty) {
    out.write('\x1b[?25l');
    draw();
  } else say(`${sym.dot} ${title}...`);
  const finish = (mark) => {
    if (timer) clearInterval(timer);
    if (tty) out.write('\r\x1b[2K\x1b[?25h');
    const secs = (Date.now() - started) / 1000;
    say(`${mark} ${title}${secs >= 1 ? c.dim(` (${secs.toFixed(0)}s)`) : ''}`);
  };
  try {
    const result = await fn((text) => {
      detail = String(text).replace(/\s+/g, ' ').trim();
    });
    finish(c.green(sym.ok));
    return result;
  } catch (e) {
    finish(c.red(sym.fail));
    throw e;
  }
}

function truncate(s, width) {
  if (strip(s).length <= width) return s;
  // Cut the visible text without breaking escape codes, then reset styles.
  let visible = 0;
  let result = '';
  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith('\x1b[')) result += part;
    else {
      const room = width - 1 - visible;
      if (room <= 0) break;
      result += part.slice(0, room);
      visible += Math.min(part.length, room);
    }
  }
  return result + (color ? '\x1b[0m' : '') + '…';
}

// ---------------------------------------------------------------------------------------------
// Processes

class CommandError extends Error {
  constructor(message, tail) {
    super(message);
    this.tail = tail;
  }
}

/** Runs a command with output going to the log; `update` receives each output line. */
function run(cmd, args, { cwd, env, update } = {}) {
  log(`$ ${[cmd, ...args].join(' ')}${cwd ? `   (in ${cwd})` : ''}`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const tail = [];
    let output = '';
    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      logStream?.write(text);
      for (const line of text.split(/\r?\n|\r/)) {
        const clean = strip(line).trim();
        if (!clean) continue;
        tail.push(clean);
        if (tail.length > 25) tail.shift();
        update?.(clean);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) =>
      reject(new CommandError(`Couldn't start ${path.basename(cmd)}: ${e.message}`, tail)),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new CommandError(
              `${path.basename(cmd)} ${args[0] ?? ''} failed (exit code ${code}).`,
              tail,
            ),
          ),
    );
  });
}

/** Runs a command attached to the terminal, for programs that may ask for a password. */
function runAttached(cmd, args, { cwd, env } = {}) {
  log(`$ ${[cmd, ...args].join(' ')} (attached)`);
  const result = spawnSync(cmd, args, { cwd, env: env ?? process.env, stdio: 'inherit' });
  return result.status === 0;
}

function capture(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

const which = (name) =>
  win
    ? capture('where.exe', [name])?.split(/\r?\n/)[0]
    : capture('sh', ['-c', `command -v "${name}"`]);

function runningProcesses() {
  if (win) {
    const list = capture('tasklist.exe', ['/FO', 'CSV', '/NH']) ?? '';
    return new Set(
      list.split(/\r?\n/).map((l) => l.split('","')[0].replace(/^"/, '').toLowerCase()),
    );
  }
  const list = capture('ps', ['-A', '-o', 'comm=']) ?? '';
  return new Set(list.split('\n').map((l) => path.basename(l.trim()).toLowerCase()));
}

async function killProcess(name) {
  if (win) capture('taskkill.exe', ['/IM', name, '/F', '/T']);
  else capture('pkill', ['-x', name]);
  for (let i = 0; i < 50 && runningProcesses().has(name.toLowerCase()); i++) await sleep(100);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The system tar. On Windows, Git's GNU tar on PATH can't handle C:\ paths, so use bsdtar. */
function tarCommand() {
  if (win) {
    const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (existsSync(system)) return system;
  }
  return 'tar';
}

const extract = (archive, dest) => run(tarCommand(), ['-xzf', archive, '-C', dest]);

// ---------------------------------------------------------------------------------------------
// Downloads

async function fetchRetry(url, init = {}) {
  let error;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          'User-Agent': `UwUSpeak-installer (https://github.com/${REPO})`,
          ...init.headers,
        },
      });
      if (res.ok || (res.status >= 300 && res.status < 400) || res.status === 404) return res;
      error = new Error(`HTTP ${res.status} from ${url}`);
    } catch (e) {
      error = new Error(`Couldn't reach ${new URL(url).host}: ${e.cause?.message ?? e.message}`);
    }
    log(`${error.message} (attempt ${attempt})`);
    if (attempt < 3) await sleep(1000 * attempt);
  }
  throw error;
}

async function fetchText(url, init) {
  const res = await fetchRetry(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

/** Downloads to `dest`, checking `sha256` (hex) or `integrity` (npm "sha512-…") when given. */
async function download(url, dest, { sha256, integrity, update } = {}) {
  log(`GET ${url}`);
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const [algorithm, expected] = integrity
    ? ['sha512', Buffer.from(integrity.replace(/^sha512-/, ''), 'base64').toString('hex')]
    : ['sha256', sha256];
  const hash = createHash(algorithm);
  let received = 0;
  const mb = (n) => (n / 1048576).toFixed(1);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(
    Readable.fromWeb(res.body),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        received += chunk.length;
        update?.(total ? `${mb(received)} of ${mb(total)} MB` : `${mb(received)} MB`);
        yield chunk;
      }
    },
    createWriteStream(dest),
  );
  if (expected && hash.digest('hex') !== expected.toLowerCase())
    throw new Error(`The download from ${url} is damaged (checksum mismatch). Try again.`);
}

/** Resolves "latest" to a release tag without using the rate-limited GitHub API. */
async function resolveRelease(tag) {
  if (tag && tag !== 'latest') return tag;
  const res = await fetchRetry(`https://github.com/${REPO}/releases/latest`, {
    redirect: 'manual',
  });
  const match = res.headers.get('location')?.match(/\/releases\/tag\/([^/?#]+)/);
  if (!match) throw new Error(`Couldn't find the latest UwUSpeak release on GitHub.`);
  return decodeURIComponent(match[1]);
}

const releaseUrl = (tag, file) => `https://github.com/${REPO}/releases/download/${tag}/${file}`;

// ---------------------------------------------------------------------------------------------
// Discord, Vesktop and Vencord detection

/** Extracts the patcher path from a Vencord-patched app.asar (see Vencord/Installer app_asar.go). */
export function parsePatchedAsar(buffer) {
  if (buffer.length > 65536) return undefined;
  const match = buffer.toString('utf8').match(/require\(("(?:[^"\\]|\\.)*")\)/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

/** Reads a source checkout's package.json, or undefined if `dir` isn't Vencord or Equicord. */
export function readCheckout(dir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const client = String(pkg.name).toLowerCase();
    if (!CLIENTS[client] || !existsSync(path.join(dir, 'src'))) return undefined;
    const git = existsSync(path.join(dir, '.git'));
    const pnpm = /^pnpm@(\d+\.\d+\.\d+)/.exec(pkg.packageManager ?? '')?.[1];
    return { dir, client, git, pnpm };
  } catch {
    return undefined;
  }
}

/** Describes what a patched app.asar requires or a Vesktop vencordDir points at. */
export function classifyLoad(loaded) {
  if (!loaded) return { kind: 'none' };
  // dist, dist/patcher.js or dist/desktop: the source folder is a few levels up.
  for (let dir = path.dirname(loaded), i = 0; i < 3; dir = path.dirname(dir), i++) {
    const checkout = readCheckout(dir);
    if (checkout) return { kind: 'source', checkout };
  }
  const lower = loaded.toLowerCase();
  if (lower.includes('equicord')) return { kind: 'prebuilt', client: 'equicord' };
  if (lower.includes('vencord') || lower.includes('vesktop'))
    return { kind: 'prebuilt', client: 'vencord' };
  return { kind: 'other', path: loaded };
}

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const BRANCHES = {
  stable: 'Discord',
  ptb: 'Discord PTB',
  canary: 'Discord Canary',
  development: 'Discord Development',
};

const branchOf = (name) => {
  const lower = name.toLowerCase();
  return Object.keys(BRANCHES).find((b) => b !== 'stable' && lower.includes(b)) ?? 'stable';
};

/**
 * The app-x.y.z/resources folder that Vencord's installer patches, for installs that update in
 * place. It picks the last one in plain text order, so this must too.
 */
export function newestAppResources(base) {
  if (!isDir(base)) return undefined;
  const apps = readdirSync(base)
    .filter((n) => /^app-\d/.test(n) && isDir(path.join(base, n, 'resources')))
    .sort();
  return apps.length ? path.join(base, apps.at(-1), 'resources') : undefined;
}

function discordInstall({ branch, location, resources, flatpak = false, exe, start }) {
  if (!resources || !existsSync(path.join(resources, 'app.asar'))) return undefined;
  const patched = existsSync(path.join(resources, '_app.asar'));
  let patcher;
  if (patched) {
    try {
      patcher = parsePatchedAsar(readFileSync(path.join(resources, 'app.asar')));
    } catch {}
  }
  const id = (branch === 'stable' ? 'discord' : `discord-${branch}`) + (flatpak ? '-flatpak' : '');
  const load = patched
    ? patcher
      ? classifyLoad(patcher)
      : { kind: 'other', path: resources }
    : { kind: 'none' };
  return {
    id,
    app: 'discord',
    label: BRANCHES[branch] + (flatpak ? ' (Flatpak)' : ''),
    branch,
    location,
    resources,
    flatpak,
    patcher,
    load,
    exe,
    start,
  };
}

export function findDiscords() {
  const found = [];
  if (win) {
    const names = {
      stable: 'Discord',
      ptb: 'DiscordPTB',
      canary: 'DiscordCanary',
      development: 'DiscordDevelopment',
    };
    for (const [branch, name] of Object.entries(names)) {
      const location = path.join(localAppData, name);
      found.push(
        discordInstall({
          branch,
          location,
          resources: newestAppResources(location),
          exe: `${name}.exe`,
          start: [path.join(location, 'Update.exe'), ['--processStart', `${name}.exe`]],
        }),
      );
    }
  } else if (mac) {
    for (const base of ['/Applications', path.join(home, 'Applications')])
      for (const [branch, name] of Object.entries(BRANCHES)) {
        const location = path.join(base, `${name}.app`);
        found.push(
          discordInstall({
            branch,
            location,
            resources: path.join(location, 'Contents', 'Resources'),
            exe: name,
            start: ['open', ['-a', location]],
          }),
        );
      }
  } else {
    const names = [
      'Discord',
      'DiscordPTB',
      'DiscordCanary',
      'DiscordDevelopment',
      'discord',
      'discordptb',
      'discordcanary',
      'discorddevelopment',
      'discord-ptb',
      'discord-canary',
      'discord-development',
    ];
    const exeOf = {
      stable: 'Discord',
      ptb: 'DiscordPTB',
      canary: 'DiscordCanary',
      development: 'DiscordDevelopment',
    };
    for (const dir of [
      '/usr/share',
      '/usr/lib64',
      '/usr/lib',
      '/opt',
      path.join(home, '.local/share'),
      path.join(home, '.dvm'),
    ])
      for (const name of names) {
        const location = path.join(dir, name);
        if (!isDir(location)) continue;
        const branch = branchOf(name);
        const exe = exeOf[branch];
        const binary = path.join(location, exe);
        found.push(
          discordInstall({
            branch,
            location,
            resources: path.join(location, 'resources'),
            exe,
            start: existsSync(binary) ? [binary, []] : undefined,
          }),
        );
      }
    // Newer Linux builds update themselves into ~/.config/<name>/app-x.y.z.
    for (const name of ['discord', 'discordptb', 'discordcanary']) {
      const location = path.join(configHome, name);
      const branch = branchOf(name);
      const launcher = which(name === 'discord' ? 'discord' : name.replace('discord', 'discord-'));
      found.push(
        discordInstall({
          branch,
          location,
          resources: newestAppResources(location),
          exe: exeOf[branch],
          start: launcher ? [launcher, []] : undefined,
        }),
      );
    }
    for (const [branch, name] of [
      ['stable', 'Discord'],
      ['ptb', 'DiscordPTB'],
      ['canary', 'DiscordCanary'],
    ]) {
      const appId = `com.discordapp.${name}`;
      const folder = branch === 'stable' ? 'discord' : `discord-${branch}`;
      for (const base of ['/var/lib/flatpak/app', path.join(home, '.local/share/flatpak/app')]) {
        const location = path.join(base, appId);
        found.push(
          discordInstall({
            branch,
            location,
            resources: path.join(location, 'current', 'active', 'files', folder, 'resources'),
            flatpak: true,
            exe: exeOf[branch],
            start: ['flatpak', ['run', appId]],
          }),
        );
      }
      const userLocation = path.join(home, '.var/app', appId, 'config', 'discord');
      found.push(
        discordInstall({
          branch,
          location: userLocation,
          resources: newestAppResources(userLocation),
          flatpak: true,
          exe: exeOf[branch],
          start: ['flatpak', ['run', appId]],
        }),
      );
    }
  }
  // The same install can be reachable through more than one path.
  const seen = new Set();
  return found.filter((d) => {
    if (!d) return false;
    const key = path.resolve(d.resources);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findVesktops() {
  const found = [];
  const add = (dataDir, flatpak, start) => {
    if (!isDir(dataDir)) return;
    let state = {};
    try {
      state = JSON.parse(readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
    } catch {}
    found.push({
      id: flatpak ? 'vesktop-flatpak' : 'vesktop',
      app: 'vesktop',
      label: flatpak ? 'Vesktop (Flatpak)' : 'Vesktop',
      dataDir,
      flatpak,
      vencordDir: state.vencordDir,
      load: state.vencordDir
        ? classifyLoad(state.vencordDir)
        : { kind: 'prebuilt', client: 'vencord' },
      exe: win ? 'Vesktop.exe' : mac ? 'Vesktop' : 'vesktop',
      start,
    });
  };
  if (win) {
    const exe = path.join(localAppData, 'Programs', 'vesktop', 'Vesktop.exe');
    add(path.join(configHome, 'vesktop'), false, existsSync(exe) ? [exe, []] : undefined);
  } else if (mac) {
    add(path.join(configHome, 'vesktop'), false, ['open', ['-a', 'Vesktop']]);
  } else {
    const launcher = which('vesktop');
    add(path.join(configHome, 'vesktop'), false, launcher ? [launcher, []] : undefined);
    add(path.join(home, '.var/app/dev.vencord.Vesktop/config/vesktop'), true, [
      'flatpak',
      ['run', 'dev.vencord.Vesktop'],
    ]);
  }
  return found;
}

function describeLoad(target) {
  const { load } = target;
  if (target.app === 'vesktop' && load.kind === 'prebuilt')
    return c.dim("Vesktop's built-in Vencord");
  switch (load.kind) {
    case 'none':
      return c.dim('no mod installed');
    case 'prebuilt':
      return `${CLIENTS[load.client].name} ${c.dim('(regular download)')}`;
    case 'source':
      return `${CLIENTS[load.checkout.client].name} ${c.dim(`built from ${load.checkout.dir}`)}`;
    default:
      return c.yellow('another mod');
  }
}

function toolVersion(cmd, args = ['--version']) {
  const text = capture(cmd, args);
  return text?.match(/\d+\.\d+(\.\d+)?/)?.[0];
}

// ---------------------------------------------------------------------------------------------
// Saved state

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

async function saveState(state) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2) + '\n');
}

async function openLog() {
  const dir = path.join(stateDir, 'logs');
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  logPath = path.join(dir, `install-${stamp}.log`);
  logStream = createWriteStream(logPath);
  log(
    `UwUSpeak installer, ${new Date().toISOString()}, ${process.platform} ${os.release()} ${process.arch}, Node ${process.version}`,
  );
  // Keep the ten most recent logs.
  const logs = (await fs.readdir(dir)).filter((n) => n.startsWith('install-')).sort();
  for (const old of logs.slice(0, -10)) await fs.rm(path.join(dir, old), { force: true });
}

// ---------------------------------------------------------------------------------------------
// Steps

/** Downloads (once) the pnpm version a checkout pins and returns the command to run it. */
async function ensurePnpm(version) {
  const dir = path.join(toolsDir, `pnpm-${version}`);
  const launcher = () =>
    ['bin/pnpm.mjs', 'bin/pnpm.cjs'].map((p) => path.join(dir, 'package', p)).find(existsSync);
  if (launcher()) return launcher();
  return task(`Downloading pnpm ${version}`, async (update) => {
    const meta = JSON.parse(await fetchText(`https://registry.npmjs.org/pnpm/${version}`));
    const archive = path.join(toolsDir, `pnpm-${version}.tgz`);
    await download(meta.dist.tarball, archive, { integrity: meta.dist.integrity, update });
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    await extract(archive, dir);
    await fs.rm(archive, { force: true });
    if (!launcher()) throw new Error(`pnpm ${version} has an unexpected layout.`);
    return launcher();
  });
}

function buildEnv(checkout) {
  const env = {
    ...process.env,
    PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
    npm_config_update_notifier: 'false',
  };
  const snapshot = readSnapshot(checkout.dir);
  if (snapshot) {
    // Without .git, the build scripts read the commit and remote from these variables.
    for (const prefix of ['VENCORD', 'EQUICORD']) {
      env[`${prefix}_HASH`] = snapshot.sha.slice(0, 7);
      env[`${prefix}_REMOTE`] = CLIENTS[checkout.client].repo;
    }
  }
  return env;
}

function readSnapshot(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'));
  } catch {
    return undefined;
  }
}

async function latestCommit(client) {
  const { repo, branch } = CLIENTS[client];
  const sha = await fetchText(`https://api.github.com/repos/${repo}/commits/${branch}`, {
    headers: { Accept: 'application/vnd.github.sha' },
  }).catch(() => undefined);
  return /^[0-9a-f]{40}$/.test(sha?.trim() ?? '') ? sha.trim() : undefined;
}

/** Downloads a source snapshot into `dir`, keeping its src/userplugins and node_modules. */
async function downloadSnapshot(client, dir, update) {
  const { repo, branch } = CLIENTS[client];
  const sha = await latestCommit(client);
  const ref = sha ?? branch;
  const parent = path.dirname(dir);
  await fs.mkdir(parent, { recursive: true });
  const temp = await fs.mkdtemp(path.join(parent, '.uwuspeak-'));
  try {
    const archive = path.join(temp, 'source.tar.gz');
    await download(`https://codeload.github.com/${repo}/tar.gz/${ref}`, archive, { update });
    update('unpacking');
    await extract(archive, temp);
    const top = readdirSync(temp).find((n) => n !== 'source.tar.gz' && isDir(path.join(temp, n)));
    if (!top) throw new Error('The downloaded snapshot is empty.');
    const fresh = path.join(temp, top);
    await fs.writeFile(
      path.join(fresh, SNAPSHOT_FILE),
      JSON.stringify({ sha: sha ?? 'unknown000', downloaded: new Date().toISOString() }) + '\n',
    );
    if (!existsSync(dir)) return await fs.rename(fresh, dir);
    // Swap the folders, carrying over the user's plugins and installed dependencies. Put
    // everything back if a file is locked, so a failed update leaves the old folder intact.
    const moved = [];
    try {
      for (const keep of ['src/userplugins', 'node_modules']) {
        const from = path.join(dir, keep);
        if (!existsSync(from)) continue;
        await fs.rm(path.join(fresh, keep), { recursive: true, force: true });
        await fs.rename(from, path.join(fresh, keep));
        moved.push(keep);
      }
      await fs.rename(dir, path.join(temp, 'previous'));
    } catch (e) {
      for (const keep of moved)
        await fs.rename(path.join(fresh, keep), path.join(dir, keep)).catch(() => {});
      throw new Error(
        `Couldn't replace ${dir} (${e.code ?? e.message}). Close Discord and try again.`,
      );
    }
    await fs.rename(fresh, dir);
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

async function cloneSource(client, dir, update) {
  const { repo } = CLIENTS[client];
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await run(
    'git',
    ['clone', '--progress', '--filter=blob:none', `https://github.com/${repo}`, dir],
    {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      update,
    },
  );
}

/** Pulls a git checkout when that is safe; returns a short message about what happened. */
async function updateGit(dir, update) {
  const git = (args) =>
    run('git', ['-C', dir, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, update });
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no'])).trim();
  if (dirty) return 'skipped: it has local changes';
  const upstream = capture('git', ['-C', dir, 'rev-parse', '--abbrev-ref', '@{upstream}']);
  if (!upstream) return 'skipped: the current branch has no upstream';
  const before = capture('git', ['-C', dir, 'rev-parse', 'HEAD']);
  try {
    await git(['pull', '--ff-only']);
  } catch {
    return `skipped: couldn't fast-forward to ${upstream}`;
  }
  return capture('git', ['-C', dir, 'rev-parse', 'HEAD']) === before
    ? 'already up to date'
    : 'updated';
}

async function getPluginArchive(opts, temp, update) {
  if (opts.plugin) {
    if (!existsSync(opts.plugin)) throw new Error(`${opts.plugin} doesn't exist.`);
    return { archive: opts.plugin, version: 'local build' };
  }
  const tag = await resolveRelease(opts.release);
  update(tag);
  const sums = await fetchText(releaseUrl(tag, 'SHA256SUMS.txt')).catch(() => '');
  const sha256 = sums.match(/^([0-9a-f]{64})\s+\*?uwuSpeak\.tar\.gz$/m)?.[1];
  const archive = path.join(temp, 'uwuSpeak.tar.gz');
  await download(releaseUrl(tag, 'uwuSpeak.tar.gz'), archive, { sha256, update });
  return { archive, version: tag };
}

async function installPlugin(archive, checkout) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'uwuspeak-plugin-'));
  try {
    await extract(archive, temp);
    const source = path.join(temp, PLUGIN_DIR);
    if (!existsSync(path.join(source, 'index.tsx')))
      throw new Error("The plugin download doesn't contain the plugin.");
    const userplugins = path.join(checkout.dir, 'src', 'userplugins');
    const target = path.join(userplugins, PLUGIN_DIR);
    await fs.mkdir(userplugins, { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(source, target, { recursive: true });
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Records the installed version. Written only after a successful build, so a version that matches
 * the latest release means that release is installed and built, and the rebuild can be skipped.
 */
async function markInstalled(checkout, version) {
  const file = path.join(checkout.dir, 'src', 'userplugins', PLUGIN_DIR, VERSION_FILE);
  await fs.writeFile(file, version + '\n');
}

function installedVersion(dir) {
  try {
    return readFileSync(
      path.join(dir, 'src', 'userplugins', PLUGIN_DIR, VERSION_FILE),
      'utf8',
    ).trim();
  } catch {
    return existsSync(path.join(dir, 'src', 'userplugins', PLUGIN_DIR, 'index.tsx'))
      ? 'unknown version'
      : undefined;
  }
}

async function buildCheckout(checkout) {
  if (!checkout.pnpm) throw new Error(`${checkout.dir}/package.json doesn't pin a pnpm version.`);
  const pnpm = await ensurePnpm(checkout.pnpm);
  const env = buildEnv(checkout);
  const pn = (args, update) =>
    run(process.execPath, [pnpm, ...args], { cwd: checkout.dir, env, update });
  await task('Installing build dependencies', (update) =>
    pn(['install', '--frozen-lockfile', '--config.confirm-modules-purge=false'], update),
  );
  await task(`Building ${CLIENTS[checkout.client].name}`, (update) => pn(['build'], update));
}

function buildIncludesPlugin(checkout) {
  try {
    const renderer = inCheckout(checkout, CLIENTS[checkout.client].renderer);
    return readFileSync(renderer, 'utf8').includes(PLUGIN_NAME);
  } catch {
    return false;
  }
}

/** Points a Discord install at the checkout's build using the client's own installer. */
async function patchDiscord(target, checkout) {
  const expected = inCheckout(checkout, CLIENTS[checkout.client].load);
  // The same variables the checkout's scripts/runInstaller.mjs sets, for the sudo retry below.
  const env = { ...buildEnv(checkout) };
  for (const prefix of ['VENCORD', 'EQUICORD']) {
    env[`${prefix}_USER_DATA_DIR`] = checkout.dir;
    env[`${prefix}_DEV_INSTALL`] = '1';
  }
  env.EQUICORD_DIRECTORY = inCheckout(checkout, CLIENTS.equicord.load);
  const patchedHere = () => samePath(discordInstall({ ...target })?.patcher, expected);
  // runInstaller.mjs exits successfully even when the patch fails, so check the result instead.
  let output = '';
  await task(`Pointing ${target.label} at ${CLIENTS[checkout.client].name}`, (update) =>
    run(
      process.execPath,
      ['scripts/runInstaller.mjs', '--', '--install', '--location', target.location],
      { cwd: checkout.dir, env, update },
    ).then(
      (text) => (output = text),
      (e) => (output = e.tail?.join('\n') ?? e.message),
    ),
  );
  if (patchedHere()) return;
  // System-wide Linux installs are owned by root; run the downloaded installer again with sudo.
  if (!win && !mac && !canWrite(target.resources)) {
    const bin = installerBinary(checkout);
    if (bin) {
      info(`${target.resources} belongs to root, so the patch needs your password.`);
      const vars = Object.entries(env)
        .filter(([k]) => /^(VENCORD|EQUICORD)_/.test(k))
        .map(([k, v]) => `${k}=${v}`);
      runAttached('sudo', ['env', ...vars, bin, '--install', '--location', target.location]);
      if (patchedHere()) return;
    }
  }
  const hints = output
    .split(/\r?\n/)
    .map((l) => strip(l).trim())
    .filter(Boolean)
    .slice(-6);
  hints.push(`See ${logPath} for details.`);
  if (mac)
    hints.unshift(
      'macOS may be blocking changes to apps: allow your terminal under System Settings > Privacy & Security > App Management, then run this again.',
    );
  if (win)
    hints.unshift(
      'Make sure Discord is fully closed (check the system tray), then run this again.',
    );
  throw new CommandError(`Couldn't patch ${target.label}.`, hints);
}

function canWrite(dir) {
  try {
    return spawnSync('sh', ['-c', `test -w "$1"`, 'sh', dir]).status === 0;
  } catch {
    return false;
  }
}

function installerBinary(checkout) {
  const dir = path.join(checkout.dir, 'dist', 'Installer');
  try {
    const bin = readdirSync(dir).find((n) => !n.endsWith('.txt'));
    return bin && path.join(dir, bin);
  } catch {
    return undefined;
  }
}

async function pointVesktop(target, checkout) {
  const dist = inCheckout(checkout, CLIENTS[checkout.client].vesktop);
  await task(`Pointing ${target.label} at ${CLIENTS[checkout.client].name}`, async () => {
    const file = path.join(target.dataDir, 'state.json');
    let state = {};
    try {
      state = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {}
    state.vencordDir = dist;
    await fs.writeFile(file, JSON.stringify(state, null, 4));
    if (target.flatpak)
      await run('flatpak', [
        'override',
        '--user',
        `--filesystem=${dist}:ro`,
        'dev.vencord.Vesktop',
      ]);
  });
}

/** Where Vencord keeps its settings for a target. */
function settingsDirFor(target, client) {
  if (target.app === 'vesktop') return path.join(target.dataDir, 'settings');
  const base = target.flatpak
    ? path.join(home, '.var/app', `com.discordapp.${target.exe}`, 'config')
    : configHome;
  return path.join(base, CLIENTS[client].name, 'settings');
}

function pluginEnabled(target, client) {
  try {
    const file = path.join(settingsDirFor(target, client), 'settings.json');
    return JSON.parse(readFileSync(file, 'utf8')).plugins?.[PLUGIN_NAME]?.enabled === true;
  } catch {
    return false;
  }
}

/** Turns the plugin on in Vencord's settings.json. Only safe while the app is closed. */
async function enablePlugin(target, client) {
  const file = path.join(settingsDirFor(target, client), 'settings.json');
  let settings = {};
  if (existsSync(file)) {
    const text = await fs.readFile(file, 'utf8');
    settings = JSON.parse(text);
    await fs.writeFile(file + '.uwuspeak-backup', text);
  }
  settings.plugins ??= {};
  if (settings.plugins[PLUGIN_NAME]?.enabled) return false;
  settings.plugins[PLUGIN_NAME] = { ...settings.plugins[PLUGIN_NAME], enabled: true };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(settings, null, 4));
  return true;
}

function startApp(target) {
  if (!target.start) return false;
  const [cmd, args] = target.start;
  if (path.isAbsolute(cmd) && !existsSync(cmd)) return false;
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', (e) => log(`Couldn't start ${target.label}: ${e.message}`));
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Flows

function pickDefaultTargets(targets, saved) {
  const remembered = targets.filter((t) => saved.targets?.includes(t.id));
  if (remembered.length) return remembered;
  const source = targets.filter((t) => t.load.kind === 'source');
  if (source.length) return source;
  const modded = targets.filter((t) => t.app === 'discord' && t.load.kind === 'prebuilt');
  if (modded.length) return modded;
  return [targets.find((t) => t.app === 'discord') ?? targets[0]];
}

async function chooseTargets(targets, opts, saved) {
  if (opts.targets) {
    if (opts.targets.includes('none')) return [];
    if (opts.targets.includes('all')) return targets;
    const chosen = targets.filter((t) => opts.targets.includes(t.id));
    const missing = opts.targets.filter((id) => !targets.some((t) => t.id === id));
    if (missing.length)
      throw new UsageError(
        `Not found: ${missing.join(', ')}. Found: ${targets.map((t) => t.id).join(', ') || 'nothing'}.`,
      );
    return chosen;
  }
  if (!targets.length) {
    warn("Couldn't find Discord or Vesktop on this computer.");
    note('Install Discord from https://discord.com/download (the Snap package is not supported).');
    const go = await select('What now?', [
      { label: 'Quit', value: false },
      { label: 'Only build the plugin', value: true, hint: 'for a custom setup' },
    ]);
    if (!go) throw new Cancelled();
    return [];
  }
  const defaults = pickDefaultTargets(targets, saved);
  if (targets.length === 1) return targets;
  const items = targets.map((t) => ({ label: t.label, value: [t], hint: strip(describeLoad(t)) }));
  items.push({ label: 'All of them', value: targets });
  items.push({ label: 'None, only build', value: [], hint: 'for a custom setup' });
  const def = defaults.length === 1 ? targets.indexOf(defaults[0]) : items.length - 2;
  return select('Which app should get UwUSpeak?', items, def);
}

async function chooseCheckout(chosen, opts, saved) {
  if (opts.dir) {
    const existing = readCheckout(opts.dir);
    if (existing) return { checkout: existing, isNew: false };
    await assertUsableFolder(opts.dir);
    return { checkout: { dir: opts.dir, client: opts.client ?? 'vencord' }, isNew: true };
  }
  const loaded = chosen.find((t) => t.load.kind === 'source')?.load.checkout;
  if (loaded) return { checkout: loaded, isNew: false };
  const remembered = saved.dir && readCheckout(saved.dir);
  if (remembered && (!opts.client || remembered.client === opts.client))
    return { checkout: remembered, isNew: false };
  const client =
    opts.client ??
    (chosen.some((t) => t.load.kind === 'prebuilt' && t.load.client === 'equicord')
      ? 'equicord'
      : 'vencord');
  const name = CLIENTS[client].name;
  const fallback = path.join(home, name);
  const existing = readCheckout(fallback);
  if (existing && existing.client === client) return { checkout: existing, isNew: false };
  let base = fallback;
  if (win && base.length > MAX_WINDOWS_DIR - 3)
    base = path.join(process.env.SystemDrive || 'C:', '\\', name);
  let def = base;
  for (let i = 2; existsSync(def); i++) def = `${base}-${i}`;
  for (;;) {
    const dir = path.resolve(expandHome(await ask(`Where should ${name} be downloaded to?`, def)));
    const there = readCheckout(dir);
    if (there) return { checkout: there, isNew: false };
    try {
      await assertUsableFolder(dir);
      return { checkout: { dir, client }, isNew: true };
    } catch (e) {
      if (!interactive) throw e;
      warn(e.message);
    }
  }
}

// Vencord's node_modules nests about 180 characters deep, and Windows tools still trip over paths
// longer than 260.
const MAX_WINDOWS_DIR = 75;

async function assertUsableFolder(dir) {
  if (win && dir.length > MAX_WINDOWS_DIR)
    throw new UsageError(
      `${dir} is too long a path for Windows build tools. Pick a folder with a shorter path, such as C:\\Vencord.`,
    );
  if (!existsSync(dir)) return;
  if (!isDir(dir) || (await fs.readdir(dir)).length)
    throw new UsageError(
      `${dir} already exists and isn't a Vencord or Equicord folder. Pick an empty or new folder.`,
    );
}

async function install(opts, saved, targets, tools) {
  const chosen = await chooseTargets(targets, opts, saved);
  const { checkout, isNew } = await chooseCheckout(chosen, opts, saved);
  const name = CLIENTS[checkout.client].name;
  const useGit = opts.git && Boolean(tools.git);
  const snapshot = isNew ? !useGit : !checkout.git;

  // Explain the situations that change how someone's Discord works.
  for (const t of chosen) {
    if (t.load.kind === 'prebuilt' && t.app === 'discord') {
      info(
        `${t.label} uses the regular ${CLIENTS[t.load.client].name} download, which can't load extra plugins.`,
      );
      note(`It will load ${name} built from ${checkout.dir} instead. Your settings, themes and`);
      note('enabled plugins stay as they are.');
    } else if (t.load.kind === 'prebuilt' && t.app === 'vesktop') {
      info(`Vesktop will load ${name} built from ${checkout.dir} instead of its built-in copy.`);
    } else if (
      t.load.kind === 'source' &&
      path.resolve(t.load.checkout.dir) !== path.resolve(checkout.dir)
    ) {
      info(`${t.label} will switch from ${t.load.checkout.dir} to ${checkout.dir}.`);
    } else if (t.load.kind === 'other') {
      warn(
        `${t.label} is patched by a mod this installer doesn't recognise. Installing ${name} replaces that patch.`,
      );
    }
  }
  if (snapshot && isNew && !tools.git)
    note(
      `Git isn't installed, so ${name} is downloaded as a snapshot. Run this installer again to update it.`,
    );

  let updateSource = false;
  if (!isNew && opts.update) {
    if (checkout.git && !tools.git)
      note(`Git isn't installed, so ${name} stays at its current version.`);
    else updateSource = await confirm(`Update ${name} to its latest version first?`, true);
  }

  // The plugin is current when the release it would download is the one already built here.
  const pluginCurrent =
    !isNew &&
    !opts.reinstall &&
    Boolean(opts.latest) &&
    installedVersion(checkout.dir) === opts.latest;
  const pnpmLabel = `pnpm ${checkout.pnpm ?? c.dim('(version from the download)')}`;
  heading('Plan');
  const plan = [
    [
      isNew ? `Download ${name}` : `Use ${name}`,
      checkout.dir + (isNew ? c.dim(snapshot ? ' (snapshot)' : ' (git clone)') : ''),
    ],
    pluginCurrent
      ? ['UwUSpeak', `${opts.latest} ${c.dim('(already installed)')}`]
      : ['Install UwUSpeak', opts.plugin ?? opts.latest ?? opts.release ?? 'latest release'],
    pluginCurrent
      ? ['Build', c.dim(`only if ${name} changes`)]
      : ['Build', `${name} with ${pnpmLabel}`],
  ];
  if (updateSource)
    plan.splice(1, 0, [`Update ${name}`, snapshot ? 'download the latest snapshot' : 'git pull']);
  for (const t of chosen) plan.push(['Set up', t.label]);
  if (!chosen.length) plan.push(['Set up', c.dim('nothing (build only)')]);
  table(plan.map(([a, b]) => [c.bold(a), b]));
  say();
  if (opts.dryRun) {
    info('Dry run: nothing was changed.');
    return;
  }
  if (!(await confirm('Continue?', true))) throw new Cancelled();
  say();

  let sourceChanged = isNew;
  if (isNew) {
    await task(`Downloading ${name}`, (update) =>
      snapshot
        ? downloadSnapshot(checkout.client, checkout.dir, update)
        : cloneSource(checkout.client, checkout.dir, update),
    );
  } else if (updateSource) {
    if (snapshot) {
      const current = readSnapshot(checkout.dir)?.sha;
      const latest = await latestCommit(checkout.client);
      if (latest && latest === current) ok(`${name} is already up to date`);
      else {
        await task(`Updating ${name}`, (update) =>
          downloadSnapshot(checkout.client, checkout.dir, update),
        );
        sourceChanged = true;
      }
    } else {
      const result = await task(`Updating ${name}`, (update) => updateGit(checkout.dir, update));
      if (result === 'updated') sourceChanged = true;
      else note(`${name} update ${result}.`);
    }
  }
  const fresh = readCheckout(checkout.dir);
  if (!fresh)
    throw new Error(`${checkout.dir} doesn't look like a ${name} folder after downloading.`);

  let version = opts.latest;
  if (!pluginCurrent) {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'uwuspeak-'));
    try {
      const plugin = await task('Downloading UwUSpeak', (update) =>
        getPluginArchive({ ...opts, release: opts.latest ?? opts.release }, temp, update),
      );
      version = plugin.version;
      await task(`Adding UwUSpeak ${version} to ${name}`, () =>
        installPlugin(plugin.archive, fresh),
      );
    } finally {
      await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }

  // An up-to-date plugin still needs a build when Vencord changed or the last build is missing.
  const rebuilt = !pluginCurrent || sourceChanged || !buildIncludesPlugin(fresh);
  if (rebuilt) {
    await buildCheckout(fresh);
    if (!buildIncludesPlugin(fresh))
      throw new CommandError(`The ${name} build finished but doesn't include UwUSpeak.`, [
        `See ${logPath}.`,
      ]);
    await markInstalled(fresh, version);
  } else ok(`UwUSpeak ${version} is already installed and built`);

  await saveState({
    ...saved,
    dir: fresh.dir,
    client: fresh.client,
    targets: chosen.map((t) => t.id),
    version,
  });

  // Connect apps. Each needs to be closed while its files or settings change.
  const running = runningProcesses();
  const wasRunning = new Set(
    chosen.filter((t) => running.has(t.exe.toLowerCase())).map((t) => t.id),
  );
  const restartable = [];
  for (const t of chosen) {
    const client = CLIENTS[fresh.client];
    if (t.app === 'vesktop' && !client.vesktop) {
      warn(`Skipped ${t.label}: it can't load ${client.name}. Use Vencord for Vesktop.`);
      continue;
    }
    const connected =
      t.app === 'discord'
        ? samePath(t.patcher, inCheckout(fresh, client.load))
        : samePath(t.vencordDir, inCheckout(fresh, client.vesktop));
    const isRunning = runningProcesses().has(t.exe.toLowerCase());
    let closed = !isRunning;
    // Nothing to load when the build didn't change and the app already uses it.
    if (connected && !rebuilt && pluginEnabled(t, fresh.client)) continue;
    if (isRunning && opts.restart) {
      const why = connected ? 'to load the new build' : 'to finish setting it up';
      if (await confirm(`${t.label} is running. Close it now ${why}?`, true)) {
        await task(`Closing ${t.label}`, () => killProcess(t.exe));
        closed = true;
      }
    }
    if (!connected) {
      // Vesktop rewrites its state when it quits, and on Windows Vencord's patcher force-closes
      // Discord, so both need the user's go-ahead to close first.
      if (!closed && (t.app === 'vesktop' || win)) {
        warn(`Skipped ${t.label}: close it, then run this installer again.`);
        continue;
      }
      if (t.app === 'discord') await patchDiscord(t, fresh);
      else await pointVesktop(t, fresh);
    }
    if (closed && !runningProcesses().has(t.exe.toLowerCase())) {
      try {
        if (await enablePlugin(t, fresh.client)) ok(`Turned UwUSpeak on in ${t.label}`);
      } catch (e) {
        log(`Couldn't enable the plugin in settings: ${e.message}`);
        note(`Turn UwUSpeak on yourself in ${t.label}: Settings > ${name} > Plugins.`);
      }
      restartable.push(t);
    } else {
      note(`Turn UwUSpeak on in ${t.label}: Settings > ${name} > Plugins.`);
    }
  }

  const started = [];
  if (opts.restart)
    for (const t of restartable) {
      const def = wasRunning.has(t.id) || chosen.length === 1;
      if (t.start && (await confirm(`Start ${t.label} now?`, def)) && startApp(t))
        started.push(t.label);
    }

  say();
  const label = version === 'local build' ? '(local build)' : version;
  if (!rebuilt && !restartable.length) {
    box([
      c.bold(c.green(`UwUSpeak ${label} is up to date`)) + ' ' + (unicode ? '(◕ᴗ◕✿)' : 'uwu'),
      '',
      'Nothing needed changing.',
      c.dim(`Discord shows a notification when a new version is out.`),
    ]);
    return;
  }
  const doneLines = [
    c.bold(c.green(`UwUSpeak ${label} is installed`)) + ' ' + (unicode ? '(◕ᴗ◕✿)' : 'uwu'),
    '',
    `Type ${c.cyan('/uwu')} in any chat, or use the UwU button next to the message box.`,
    `Settings: Settings > ${name} > Plugins > UwUSpeak`,
    `To update later, run the same install command again.`,
  ];
  if (chosen.some((t) => !started.includes(t.label) && runningProcesses().has(t.exe.toLowerCase())))
    doneLines.splice(2, 0, c.yellow('Fully restart Discord to load the new build.'));
  if (snapshot)
    doneLines.push(c.dim(`${name}'s own updater needs git; this installer updates it instead.`));
  box(doneLines);
}

async function uninstall(opts, saved, targets) {
  const candidates = new Map();
  const consider = (checkout) => {
    if (checkout && installedVersion(checkout.dir))
      candidates.set(path.resolve(checkout.dir), checkout);
  };
  if (opts.dir) consider(readCheckout(opts.dir));
  consider(saved.dir && readCheckout(saved.dir));
  for (const t of targets) if (t.load.kind === 'source') consider(t.load.checkout);
  for (const client of Object.values(CLIENTS)) consider(readCheckout(path.join(home, client.name)));
  const list = [...candidates.values()];
  if (!list.length) {
    info("UwUSpeak isn't installed in any Vencord or Equicord folder this installer can find.");
    return;
  }
  const checkout =
    list.length === 1
      ? list[0]
      : await select(
          'Remove UwUSpeak from which folder?',
          list.map((ch) => ({ label: ch.dir, value: ch, hint: installedVersion(ch.dir) })),
        );
  const name = CLIENTS[checkout.client].name;
  heading('Plan');
  table([
    [c.bold('Remove'), path.join(checkout.dir, 'src', 'userplugins', PLUGIN_DIR)],
    [c.bold('Rebuild'), `${name} without it`],
  ]);
  say();
  if (opts.dryRun) return info('Dry run: nothing was changed.');
  if (!(await confirm('Remove UwUSpeak?', true))) throw new Cancelled();
  const cacheDirs = [
    path.join(configHome, name, PLUGIN_NAME),
    ...targets.filter((t) => t.app === 'vesktop').map((t) => path.join(t.dataDir, PLUGIN_NAME)),
  ].filter(existsSync);
  const removeCache =
    cacheDirs.length > 0 &&
    (await confirm('Also delete the downloaded mood model (about 30 MB)?', true));
  say();
  await task('Removing UwUSpeak', () =>
    fs.rm(path.join(checkout.dir, 'src', 'userplugins', PLUGIN_DIR), {
      recursive: true,
      force: true,
    }),
  );
  await buildCheckout(checkout);
  if (removeCache)
    await task('Deleting the mood model', () =>
      Promise.all(cacheDirs.map((d) => fs.rm(d, { recursive: true, force: true }))),
    );
  await saveState({ ...saved, version: undefined });
  say();
  box([
    c.bold(c.green('UwUSpeak was removed')),
    '',
    'Fully restart Discord to finish.',
    c.dim(`${name} itself is still installed in ${checkout.dir}.`),
  ]);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message + '\n\n' + HELP);
    process.exit(2);
  }
  if (opts.help) return say(HELP);

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    console.error(`Node.js ${MIN_NODE.join('.')} or newer is needed; this is ${process.version}.`);
    console.error(
      'Run the installer through install.ps1 or install.sh, which download a suitable copy.',
    );
    process.exit(1);
  }

  interactive = !opts.yes && Boolean(process.stdin.isTTY && out.isTTY);
  await openLog();
  log(`Options: ${JSON.stringify(opts)}`);

  say();
  box([
    `${c.bold('UwUSpeak installer')}  ${c.dim('for Vencord, Equicord and Vesktop')}`,
    c.dim(`github.com/${REPO}`),
  ]);

  const saved = await loadState();
  const targets = [...findDiscords(), ...findVesktops()];
  const tools = { git: toolVersion('git'), node: process.versions.node };
  log(
    `Targets: ${JSON.stringify(targets, null, 1)}\nTools: ${JSON.stringify(tools)}\nSaved: ${JSON.stringify(saved)}`,
  );

  heading('Found on this computer');
  const rows = targets.map((t) => [t.label, describeLoad(t)]);
  if (!targets.length) rows.push(['Discord', c.yellow('not found')]);
  if (!win && !mac && existsSync('/snap/discord'))
    rows.push(['Discord (Snap)', c.yellow('not supported by Vencord')]);
  rows.push([
    'git',
    tools.git ? `${tools.git} ${c.green(sym.ok)}` : c.dim('not installed (optional)'),
  ]);
  rows.push(['Node.js', `${tools.node} ${c.green(sym.ok)}`]);
  const installedIn = [saved.dir, ...targets.map((t) => t.load.checkout?.dir)].find(
    (d) => d && installedVersion(d),
  );
  // Knowing the latest release up front lets an up-to-date install skip the rebuild. Offline, the
  // download step reports the problem instead.
  if (!opts.plugin && !opts.uninstall)
    opts.latest = await resolveRelease(opts.release).catch((e) => void log(e.message));
  const installed = installedIn && installedVersion(installedIn);
  const upToDate = Boolean(opts.latest) && installed === opts.latest;
  if (installedIn) {
    const status = upToDate
      ? c.green('(latest)')
      : opts.latest
        ? c.yellow(`${sym.arrow} ${opts.latest} available`)
        : '';
    rows.push(['UwUSpeak', `${installed} ${status} ${c.dim(`in ${installedIn}`)}`]);
  }
  table(rows);
  say();

  const installItem = !installedIn
    ? { label: 'Install UwUSpeak', value: 'install' }
    : upToDate
      ? { label: 'Check for updates', value: 'install', hint: 'updates Vencord, repairs Discord' }
      : { label: `Update UwUSpeak${opts.latest ? ` to ${opts.latest}` : ''}`, value: 'install' };
  installItem.hint ??= 'also repairs Discord after an update';
  const items = [installItem];
  if (installedIn)
    items.push({ label: 'Reinstall UwUSpeak', value: 'reinstall', hint: 'download and rebuild' });
  items.push({ label: 'Uninstall UwUSpeak', value: 'uninstall' }, { label: 'Quit', value: 'quit' });
  const action = opts.uninstall ? 'uninstall' : await select('What would you like to do?', items);
  if (action === 'quit') return;
  if (action === 'uninstall') await uninstall(opts, saved, targets);
  else
    await install(
      { ...opts, reinstall: opts.reinstall || action === 'reinstall' },
      saved,
      targets,
      tools,
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then(() => {
      logStream?.end();
    })
    .catch((e) => {
      if (tty) out.write('\x1b[?25h');
      say();
      if (e instanceof Cancelled) {
        say(c.dim('Cancelled. Nothing else was changed.'));
        process.exitCode = 130;
      } else {
        say(`${c.red(sym.fail)} ${c.bold(e.message)}`);
        if (e instanceof UsageError) process.exitCode = 2;
        else {
          for (const line of e.tail ?? []) say(c.dim(`  ${line}`));
          log(e.stack ?? String(e));
          if (logPath) say(`\nFull log: ${logPath}`);
          say(`Need help? https://github.com/${REPO}/issues`);
          process.exitCode = 1;
        }
      }
      logStream?.end();
    });
}

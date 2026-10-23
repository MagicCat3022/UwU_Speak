import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  classifyLoad,
  newestAppResources,
  parseArgs,
  parsePatchedAsar,
  readCheckout,
} from '../install/installer.mjs';

// Same bytes as Vencord/Installer's WriteAppAsar for a given patcher path.
function patchedAsar(patcher) {
  const index = `require(${JSON.stringify(patcher)})`;
  const pkg = '{\n\t"name": "discord",\n\t"main": "index.js"\n}';
  const header = JSON.stringify({
    files: {
      'index.js': { size: Buffer.byteLength(index), offset: '0' },
      'package.json': { size: pkg.length, offset: String(Buffer.byteLength(index)) },
    },
  });
  const sizes = Buffer.alloc(16);
  sizes.writeInt32LE(4, 0);
  sizes.writeInt32LE(header.length + 8, 4);
  return Buffer.concat([sizes, Buffer.from(header + index + pkg)]);
}

test('reads the patcher path from a Vencord-patched app.asar', () => {
  const windows = 'C:\\Users\\Ünï Cödé\\Vencord\\dist\\patcher.js';
  assert.equal(parsePatchedAsar(patchedAsar(windows)), windows);
  assert.equal(
    parsePatchedAsar(patchedAsar('/home/a "b"/Vencord/dist/patcher.js')),
    '/home/a "b"/Vencord/dist/patcher.js',
  );
  assert.equal(parsePatchedAsar(Buffer.from('not an asar')), undefined);
  assert.equal(parsePatchedAsar(Buffer.alloc(70000)), undefined);
});

test('tells source builds from regular downloads', () => {
  const root = mkdtempSync(join(tmpdir(), 'uwuspeak-test-'));
  try {
    const checkout = join(root, 'My Vencord');
    mkdirSync(join(checkout, 'src'), { recursive: true });
    writeFileSync(
      join(checkout, 'package.json'),
      JSON.stringify({ name: 'vencord', packageManager: 'pnpm@11.9.0' }),
    );
    assert.deepEqual(readCheckout(checkout), {
      dir: checkout,
      client: 'vencord',
      git: false,
      pnpm: '11.9.0',
    });
    assert.equal(classifyLoad(join(checkout, 'dist')).kind, 'source');
    assert.deepEqual(classifyLoad(join(root, 'AppData', 'Roaming', 'Vencord', 'dist')), {
      kind: 'prebuilt',
      client: 'vencord',
    });
    assert.deepEqual(classifyLoad(join(root, 'Equicord', 'dist')), {
      kind: 'prebuilt',
      client: 'equicord',
    });
    assert.equal(classifyLoad(join(root, 'SomethingElse', 'dist')).kind, 'other');
    assert.equal(classifyLoad(undefined).kind, 'none');

    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'not-vencord' }));
    assert.equal(readCheckout(checkout), undefined);
    assert.equal(readCheckout(join(root, 'missing')), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finds Equicord source builds from the folder Discord loads', () => {
  const root = mkdtempSync(join(tmpdir(), 'uwuspeak-test-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'equicord' }));
    const load = classifyLoad(join(root, 'dist', 'desktop'));
    assert.equal(load.kind, 'source');
    assert.equal(load.checkout.client, 'equicord');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('picks the app folder Vencord installer patches', () => {
  const root = mkdtempSync(join(tmpdir(), 'uwuspeak-test-'));
  try {
    for (const v of ['1.0.10', '1.0.9', '1.0.9264'])
      mkdirSync(join(root, `app-${v}`, 'resources'), { recursive: true });
    mkdirSync(join(root, 'app-1.0.9999'));
    // Vencord's installer compares the folder names as text.
    assert.equal(newestAppResources(root), join(root, 'app-1.0.9264', 'resources'));
    assert.equal(newestAppResources(join(root, 'missing')), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parses installer options', () => {
  const opts = parseArgs(['-y', '--target', 'discord, Vesktop', '--release=v1.2.3', '--no-git']);
  assert.equal(opts.yes, true);
  assert.deepEqual(opts.targets, ['discord', 'vesktop']);
  assert.equal(opts.release, 'v1.2.3');
  assert.equal(opts.git, false);
  assert.equal(opts.update, true);
  assert.throws(() => parseArgs(['--client', 'betterdiscord']), /vencord or equicord/);
  assert.throws(() => parseArgs(['--target']), /needs a value/);
  assert.throws(() => parseArgs(['--frobnicate']), /Unknown option/);
});

// Helpers for the installer end-to-end CI jobs.
//   node tests/installer-e2e.mjs fake <resources dir>
//     Creates a fake, unmodified Discord install (an app.asar in its resources folder).
//   node tests/installer-e2e.mjs verify <source dir> [<resources dir> <settings.json>]
//     Checks that the build includes UwUSpeak and, when given, that Discord loads that build and
//     the plugin is enabled.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { classifyLoad, parsePatchedAsar } from '../install/installer.mjs';

const [command, ...args] = process.argv.slice(2);

if (command === 'fake') {
  mkdirSync(args[0], { recursive: true });
  writeFileSync(join(args[0], 'app.asar'), 'original Discord app');
  console.log(`Fake Discord at ${args[0]}`);
} else if (command === 'verify') {
  const [source, resources, settings] = args;
  const renderers = ['dist/renderer.js', 'dist/desktop/renderer.js'].map((p) => join(source, p));
  const renderer = renderers.filter(existsSync).map((p) => readFileSync(p, 'utf8'));
  assert.ok(
    renderer.some((r) => r.includes('UwUSpeak')),
    'The build does not include UwUSpeak.',
  );
  assert.ok(readFileSync(join(source, 'src', 'userplugins', 'uwuSpeak', 'index.tsx')));
  if (resources) {
    const patcher = parsePatchedAsar(readFileSync(join(resources, 'app.asar')));
    const load = classifyLoad(patcher);
    assert.equal(load.kind, 'source', `Discord loads ${patcher}, not a source build.`);
    assert.equal(resolve(load.checkout.dir), resolve(source), 'Discord loads another folder.');
    assert.equal(readFileSync(join(resources, '_app.asar'), 'utf8'), 'original Discord app');
    const plugins = JSON.parse(readFileSync(settings, 'utf8')).plugins;
    assert.equal(plugins.UwUSpeak?.enabled, true, 'UwUSpeak is not enabled in settings.');
  }
  console.log('Install verified.');
} else {
  console.error('Usage: installer-e2e.mjs fake <dir> | verify <source> [<resources> <settings>]');
  process.exit(2);
}

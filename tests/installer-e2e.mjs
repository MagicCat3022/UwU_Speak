// Helpers for the installer end-to-end CI jobs.
//   node tests/installer-e2e.mjs fake <resources dir>
//     Creates a fake, unmodified Discord install (an app.asar in its resources folder).
//   node tests/installer-e2e.mjs verify <source dir> [<resources dir> <settings.json>]
//     Checks that the build includes UwUSpeak and, when given, that Discord loads that build and
//     the plugin is enabled.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parsePatchedAsar } from '../install/installer.mjs';

const [command, ...args] = process.argv.slice(2);

if (command === 'fake') {
  mkdirSync(args[0], { recursive: true });
  writeFileSync(join(args[0], 'app.asar'), 'original Discord app');
  console.log(`Fake Discord at ${args[0]}`);
} else if (command === 'verify') {
  const [source, resources, settings] = args;
  const renderer = readFileSync(join(source, 'dist', 'renderer.js'), 'utf8');
  assert.ok(renderer.includes('UwUSpeak'), 'The build does not include UwUSpeak.');
  assert.ok(readFileSync(join(source, 'src', 'userplugins', 'uwuSpeak', 'index.tsx')));
  if (resources) {
    const patcher = parsePatchedAsar(readFileSync(join(resources, 'app.asar')));
    assert.equal(
      resolve(patcher),
      resolve(source, 'dist', 'patcher.js'),
      'Discord is not patched.',
    );
    assert.equal(readFileSync(join(resources, '_app.asar'), 'utf8'), 'original Discord app');
    const plugins = JSON.parse(readFileSync(settings, 'utf8')).plugins;
    assert.equal(plugins.UwUSpeak?.enabled, true, 'UwUSpeak is not enabled in settings.');
  }
  console.log('Install verified.');
} else {
  console.error('Usage: installer-e2e.mjs fake <dir> | verify <source> [<resources> <settings>]');
  process.exit(2);
}

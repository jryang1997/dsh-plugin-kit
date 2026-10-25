import assert from 'node:assert/strict';
import test from 'node:test';
import { checkManifest } from '../src/checks/manifest.mjs';
import { baseManifest, makePlugin } from './helpers.mjs';

async function run(overrides = {}, files = {}) {
  const manifest = { ...baseManifest(), ...overrides };
  const root = await makePlugin({ manifest, files });
  return checkManifest({ root, manifest });
}

test('a valid plugin manifest passes', async () => {
  const report = await run();
  assert.deepEqual(report.errors, []);
});

test('a missing dsh.bundle.patch is an error', async () => {
  const report = await run({ dsh: { client: { platform: 'web' } } });
  assert.match(report.errors.join('\n'), /dsh\.bundle\.patch/);
});

test('a bundle patch file that does not exist is an error', async () => {
  const report = await run({
    dsh: { bundle: { patch: './missing.patch.yml' }, client: { platform: 'web' } },
  });
  assert.match(report.errors.join('\n'), /missing\.patch\.yml/);
});

test('dsh.bundle.patch accepts an array of existing files', async () => {
  const report = await run(
    { dsh: { bundle: { patch: ['./cordis.patch.yml', './extra.patch.yml'] }, client: { platform: 'web' } } },
    { 'extra.patch.yml': ['- insert: []'].join('\n') + '\n' },
  );
  assert.deepEqual(report.errors, []);
});

test('an array patch entry that escapes the root is an error', async () => {
  const report = await run({
    dsh: { bundle: { patch: ['./cordis.patch.yml', '../outside.yml'] }, client: { platform: 'web' } },
  });
  assert.match(report.errors.join('\n'), /escapes the repository root/);
});

test('dsh.client.platform must be web', async () => {
  const report = await run({ dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'node' } } });
  assert.match(report.errors.join('\n'), /platform must be "web"/);
});

test('dsh.client.inject must be an array of strings', async () => {
  const report = await run({
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: 'slots' } },
  });
  assert.match(report.errors.join('\n'), /inject must be an array/);
  const itemReport = await run({
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [42] } },
  });
  assert.match(itemReport.errors.join('\n'), /inject must contain only non-empty strings/);
});

test('dsh.client.immediately must be a boolean', async () => {
  const report = await run({
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', immediately: 'yes' } },
  });
  assert.match(report.errors.join('\n'), /immediately must be a boolean/);
});

test('dsh.client requires exports["./client"]', async () => {
  const manifest = baseManifest();
  delete manifest.exports['./client'];
  const root = await makePlugin({ manifest });
  const report = await checkManifest({ root, manifest });
  assert.match(report.errors.join('\n'), /exports\["\.\/client"\]/);
});

test('a client export pointing at a missing file is an error', async () => {
  const report = await run({ exports: { '.': './index.js', './client': './gone.js', './package.json': './package.json' } });
  assert.match(report.errors.join('\n'), /gone\.js/);
});

test('install hooks are forbidden', async () => {
  const report = await run({ scripts: { postinstall: 'node evil.js' } });
  assert.match(report.errors.join('\n'), /scripts\.postinstall must not be defined/);
});

test('a missing exports["./package.json"] is only a warning', async () => {
  const manifest = baseManifest();
  delete manifest.exports['./package.json'];
  const root = await makePlugin({ manifest });
  const report = await checkManifest({ root, manifest });
  assert.deepEqual(report.errors, []);
  assert.match(report.warnings.join('\n'), /exports\["\.\/package\.json"\] is recommended/);
});

test('a host-only bundle without dsh.client is a warning, not an error', async () => {
  const manifest = baseManifest();
  delete manifest.dsh.client;
  delete manifest.exports['./client'];
  const root = await makePlugin({ manifest });
  const report = await checkManifest({ root, manifest });
  assert.deepEqual(report.errors, []);
  assert.match(report.warnings.join('\n'), /host-only bundle/);
});

test('a package without name or version is reported', async () => {
  const manifest = baseManifest();
  delete manifest.name;
  manifest.version = '';
  const root = await makePlugin({ manifest });
  const report = await checkManifest({ root, manifest });
  assert.equal(report.errors.filter(message => /name|version/.test(message)).length, 2);
});

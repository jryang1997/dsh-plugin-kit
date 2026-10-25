import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  ConfigError,
  UsageError,
  defaultConfig,
  loadProject,
  validateConfig,
} from '../src/config.mjs';
import { baseManifest, makePlugin, runCli, tempDir, writeTree } from './helpers.mjs';

test('a package with no dshPluginKit key gets safe defaults', async () => {
  const root = await makePlugin();
  const project = await loadProject(root);
  assert.deepEqual(project.config, defaultConfig());
  assert.deepEqual(project.warnings, []);
  assert.equal(project.manifest.name, 'test-plugin');
});

test('a partial dshPluginKit block merges over the defaults', async () => {
  const root = await makePlugin({
    manifest: {
      ...baseManifest(),
      dshPluginKit: { version: 1, pack: { forbid: ['docs/'] }, tests: { runner: 'script' } },
    },
  });
  const project = await loadProject(root);
  assert.deepEqual(project.config.pack.forbid, ['docs/']);
  assert.deepEqual(project.config.pack.require, ['locale/en.json']);
  assert.equal(project.config.tests.runner, 'script');
  assert.deepEqual(project.config.tests.include, ['*.test.js', '*.test.mjs']);
});

test('an unknown configuration version is rejected', () => {
  assert.throws(() => validateConfig({ ...defaultConfig(), version: 2 }), ConfigError);
});

test('an unsupported sources mode is rejected with the v1 message', () => {
  assert.throws(
    () => validateConfig({ ...defaultConfig(), sources: { mode: 'inline' } }),
    error => error instanceof ConfigError && /only "json"/.test(error.message),
  );
});

test('an unknown test runner is rejected', () => {
  assert.throws(() => validateConfig({ ...defaultConfig(), tests: { include: ['*.test.js'], runner: 'jest' } }), ConfigError);
});

test('an invalid version site pattern is rejected', () => {
  assert.throws(
    () => validateConfig({ ...defaultConfig(), versionSites: [{ file: 'client.js', pattern: '([' }] }),
    ConfigError,
  );
});

test('an icon budget above the DSH limit is clamped with a warning', () => {
  const config = defaultConfig();
  config.icon.budgetBytes = 1024 * 1024;
  const result = validateConfig(config);
  assert.equal(result.config.icon.budgetBytes, 256 * 1024);
  assert.equal(result.warnings.length, 1);
});

test('loadProject rejects a directory without package.json', async () => {
  const root = await tempDir();
  await assert.rejects(() => loadProject(root), UsageError);
});

test('loadProject rejects invalid package.json', async () => {
  const root = await tempDir();
  await writeTree(root, { 'package.json': '{ nope' });
  await assert.rejects(() => loadProject(root), UsageError);
});

test('the check command exits 2 on a configuration error', async () => {
  const root = await makePlugin();
  await writeFile(join(root, 'package.json'), JSON.stringify({
    ...baseManifest(),
    dshPluginKit: { version: 3 },
  }, null, 2));
  const result = runCli(['check', '--root', root]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /version must be 1/);
});

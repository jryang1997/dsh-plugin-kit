import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { baseManifest, makePlugin, runCli, tempDir, textLines } from './helpers.mjs';

const PASSING_TEST = textLines([
  "import test from 'node:test';",
  '',
  "test('passes', () => {});",
]);

const STALE_PRODUCER = textLines([
  "import { readFile, writeFile } from 'node:fs/promises';",
  '',
  "const content = 'fresh' + String.fromCharCode(10);",
  "const check = process.argv.includes('--check');",
  'let current = null;',
  'try {',
  "  current = await readFile('client.txt', 'utf8');",
  '} catch {',
  '}',
  'if (check) {',
  '  if (current !== content) process.exitCode = 1;',
  '} else if (current !== content) {',
  "  await writeFile('client.txt', content);",
  '}',
]);

test('--help lists every command and exits 0', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  for (const command of ['check', 'test', 'verify', 'pack', 'screenshots', 'artifacts', 'review', 'probe', 'init']) {
    assert.ok(result.stdout.includes(command), 'help is missing ' + command);
  }
});

test('--version prints the kit version', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const result = runCli(['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), manifest.version);
});

test('an unknown command exits 2', () => {
  const result = runCli(['frobnicate']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command/);
});

test('an unknown option exits 2', async () => {
  const root = await makePlugin();
  const result = runCli(['check', '--root', root, '--wat']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option/);
});

test('check exits 0 for a valid plugin and prints every check', async () => {
  const root = await makePlugin();
  const result = runCli(['check', '--root', root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const name of ['manifest', 'locale', 'readme', 'version', 'syntax']) {
    assert.ok(result.stdout.includes('[ok] ' + name), 'missing check: ' + name);
  }
  assert.match(result.stdout, /check: 5 checks, 0 errors/);
});

test('check exits 1 when the manifest is broken', async () => {
  const manifest = baseManifest();
  delete manifest.dsh;
  const root = await makePlugin({ manifest });
  const result = runCli(['check', '--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[FAIL\] manifest/);
  assert.match(result.stdout, /dsh\.bundle\.patch/);
});

test('test exits 1 when no tests exist', async () => {
  const root = await makePlugin();
  const result = runCli(['test', '--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /No test files matched/);
});

test('test exits 0 and runs discovered tests', async () => {
  const root = await makePlugin({ files: { 'tests/ok.test.js': PASSING_TEST } });
  const result = runCli(['test', '--root', root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /test: ok \(1 test files\)/);
});

test('verify stops at the first failing stage and never rebuilds', async () => {
  const manifest = {
    ...baseManifest(),
    dshPluginKit: { version: 1, artifacts: [{ file: 'client.txt', produce: 'scripts/make.mjs' }] },
  };
  const root = await makePlugin({
    files: { 'scripts/make.mjs': STALE_PRODUCER, 'client.txt': 'stale\n' },
    manifest,
  });
  const result = runCli(['verify', '--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /failed at artifacts \(nothing was rebuilt\)/);
  assert.ok(!result.stdout.includes('verify: pack ok'));
  assert.equal(await readFile(join(root, 'client.txt'), 'utf8'), 'stale\n');
});

test('verify exits 0 and reports every stage for a passing plugin', async () => {
  const root = await makePlugin({
    files: { 'tests/ok.test.js': PASSING_TEST },
    manifest: { ...baseManifest() },
  });
  const result = runCli(['verify', '--root', root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const stage of ['verify: check ok', 'verify: artifacts ok', 'verify: pack ok', 'verify: screenshots ok', 'verify: ok']) {
    assert.ok(result.stdout.includes(stage), 'missing stage: ' + stage);
  }
});

test('screenshots check passes with a warning when no manifest exists and --strict fails', async () => {
  const root = await makePlugin();
  const lenient = runCli(['screenshots', 'check', '--root', root]);
  assert.equal(lenient.status, 0, lenient.stdout + lenient.stderr);
  assert.match(lenient.stdout, /warn: screenshot manifest screenshots\.json was not found/);
  const strict = runCli(['screenshots', 'check', '--root', root, '--strict']);
  assert.equal(strict.status, 1);
});

test('probe accepts positional paths after --', async () => {
  const root = await makePlugin();
  const result = runCli(['probe', '--root', root, '--', 'README.md']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).files[0].path, 'README.md');
});

test('a missing project root exits 2', async () => {
  const parent = await tempDir();
  const result = runCli(['check', '--root', join(parent, 'absent')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /project root does not exist/);
});

test('a directory without package.json exits 2', async () => {
  const root = await tempDir();
  await writeFile(join(root, 'README.md'), '# no manifest\n');
  const result = runCli(['check', '--root', root]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no package\.json/);
});

test('pack exits 1 when a dev directory leaks into the tarball', async () => {
  const manifest = {
    ...baseManifest(),
    files: ['index.js', 'client.js', 'cordis.patch.yml', 'locale/', 'icon.svg', 'README.md', 'tests/'],
  };
  const root = await makePlugin({ files: { 'tests/leak.test.js': "import test from 'node:test';\n" }, manifest });
  const result = runCli(['pack', '--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /tests\/ leaked into the tarball/);
});
test('screenshots without the check subcommand exits 2', async () => {
  const root = await makePlugin();
  const result = runCli(['screenshots', '--root', root]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /screenshots check/);
});

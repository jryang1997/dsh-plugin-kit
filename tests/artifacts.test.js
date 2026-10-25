import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  ArtifactStaleError,
  runArtifacts,
  writeArtifact,
} from '../src/artifacts.mjs';
import { loadProject } from '../src/config.mjs';
import { baseManifest, makePlugin, runCli, tempDir, textLines } from './helpers.mjs';

const PRODUCER = textLines([
  "import { readFile, writeFile } from 'node:fs/promises';",
  '',
  "const content = 'generated artifact' + String.fromCharCode(10);",
  "const check = process.argv.includes('--check');",
  'let current = null;',
  'try {',
  "  current = await readFile('out.txt', 'utf8');",
  '} catch {',
  '  // missing output',
  '}',
  'if (check) {',
  '  if (current !== content) process.exitCode = 1;',
  '} else if (current !== content) {',
  "  await writeFile('out.txt', content);",
  '}',
]);

async function run(files, { check = true, artifacts } = {}) {
  const manifest = {
    ...baseManifest(),
    dshPluginKit: {
      version: 1,
      artifacts: artifacts ?? [{ file: 'out.txt', produce: 'scripts/make.mjs' }],
    },
  };
  const root = await makePlugin({ files: { 'scripts/make.mjs': PRODUCER, ...files }, manifest });
  const project = await loadProject(root);
  return { report: await runArtifacts({ root, config: project.config, check }), root };
}

test('writeArtifact writes when the file is absent and reports the change', async () => {
  const root = await tempDir();
  const target = join(root, 'generated.txt');
  const first = await writeArtifact(target, 'one\n');
  assert.deepEqual(first, { changed: true, written: true, bytes: 4 });
  const second = await writeArtifact(target, 'one\n');
  assert.deepEqual(second, { changed: false, written: false, bytes: 4 });
  assert.equal(await readFile(target, 'utf8'), 'one\n');
});

test('writeArtifact --check throws without touching a stale file', async () => {
  const root = await tempDir();
  const target = join(root, 'generated.txt');
  await writeFile(target, 'stale\n');
  await assert.rejects(() => writeArtifact(target, 'fresh\n', { check: true }), ArtifactStaleError);
  assert.equal(await readFile(target, 'utf8'), 'stale\n');
});

test('writeArtifact --check passes when the committed bytes match', async () => {
  const root = await tempDir();
  const target = join(root, 'generated.txt');
  await writeFile(target, 'same\n');
  const result = await writeArtifact(target, 'same\n', { check: true });
  assert.deepEqual(result, { changed: false, written: false, bytes: 5 });
});

test('a producer whose --check passes is reported ok', async () => {
  const { report } = await run({ 'out.txt': 'generated artifact\n' });
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.producers, 1);
});

test('stale committed output fails artifacts --check and is not rebuilt', async () => {
  const { report, root } = await run({ 'out.txt': 'stale\n' });
  assert.match(report.errors.join('\n'), /artifact out\.txt is stale/);
  assert.equal(await readFile(join(root, 'out.txt'), 'utf8'), 'stale\n');
});

test('artifacts without --check rebuilds stale output', async () => {
  const { report, root } = await run({ 'out.txt': 'stale\n' }, { check: false });
  assert.deepEqual(report.errors, []);
  assert.equal(await readFile(join(root, 'out.txt'), 'utf8'), 'generated artifact\n');
});

test('a missing producer is an error', async () => {
  const { report } = await run({}, { artifacts: [{ file: 'out.txt', produce: 'scripts/gone.mjs' }] });
  assert.match(report.errors.join('\n'), /producer does not exist: scripts\/gone\.mjs/);
});

test('artifacts --check CLI exits 1 on a stale artifact and 0 once rebuilt', async () => {
  const manifest = {
    ...baseManifest(),
    dshPluginKit: { version: 1, artifacts: [{ file: 'out.txt', produce: 'scripts/make.mjs' }] },
  };
  const root = await makePlugin({ files: { 'scripts/make.mjs': PRODUCER, 'out.txt': 'stale\n' }, manifest });
  const stale = runCli(['artifacts', '--check', '--root', root]);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /artifact out\.txt is stale/);
  const rebuild = runCli(['artifacts', '--root', root]);
  assert.equal(rebuild.status, 0);
  const fresh = runCli(['artifacts', '--check', '--root', root]);
  assert.equal(fresh.status, 0);
});

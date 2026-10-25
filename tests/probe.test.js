import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { readProbe } from '../src/probe.mjs';
import { runCli, tempDir, writeTree } from './helpers.mjs';

test('a readable file reports bytes and SHA-256 but never content', async () => {
  const root = await tempDir();
  const secret = 'TOP-SECRET-DICTATION-TEXT\n';
  await writeTree(root, { 'AGENTS.md': secret, 'src/engine.js': 'export {};\n' });
  const report = await readProbe({ root, paths: ['AGENTS.md', 'src/engine.js'] });
  assert.equal(report.files.length, 2);
  const first = report.files[0];
  assert.equal(first.readable, true);
  assert.equal(first.bytes, Buffer.byteLength(secret));
  assert.equal(first.sha256, createHash('sha256').update(secret).digest('hex'));
  assert.ok(!JSON.stringify(report).includes('TOP-SECRET-DICTATION-TEXT'));
});

test('a missing file is reported with its error code', async () => {
  const root = await tempDir();
  const report = await readProbe({ root, paths: ['missing.txt'] });
  assert.equal(report.files[0].readable, false);
  assert.equal(report.files[0].error, 'ENOENT');
});

test('paths outside the root are rejected without being read', async () => {
  const root = await tempDir();
  // A Windows drive path is only absolute on Windows; use each platform's own
  // absolute escape so the rejection is the outside-root guard, not ENOENT.
  const escapes = ['../escape.txt', process.platform === 'win32' ? 'C:/Windows/win.ini' : '/etc/passwd'];
  const outside = await readProbe({ root, paths: escapes });
  for (const file of outside.files) {
    assert.equal(file.readable, false);
    assert.equal(file.error, 'OUTSIDE_ROOT');
  }
});

test('a file that is not valid UTF-8 reports READ_FAILED', async () => {
  const root = await tempDir();
  await writeFile(join(root, 'binary.bin'), Buffer.from([0xff, 0xfe, 0xfd]));
  const report = await readProbe({ root, paths: ['binary.bin'] });
  assert.equal(report.files[0].readable, false);
  assert.match(report.files[0].error, /READ_FAILED|ERR_ENCODING_INVALID_ENCODED_DATA/);
});

test('the probe CLI exits 1 when any requested file is unreadable', async () => {
  const root = await tempDir();
  await writeTree(root, { 'AGENTS.md': '# rules\n' });
  const ok = runCli(['probe', '--root', root, 'AGENTS.md']);
  assert.equal(ok.status, 0, ok.stderr);
  const parsed = JSON.parse(ok.stdout);
  assert.equal(parsed.files[0].path, 'AGENTS.md');
  assert.equal(parsed.files[0].readable, true);
  const failed = runCli(['probe', '--root', root, '--', 'AGENTS.md', 'missing.md']);
  assert.equal(failed.status, 1);
});

test('the probe CLI default path is AGENTS.md', async () => {
  const root = await tempDir();
  await writeTree(root, { 'AGENTS.md': '# rules\n' });
  const result = runCli(['probe', '--root', root]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).files[0].path, 'AGENTS.md');
});

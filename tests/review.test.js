import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { reviewSnapshot } from '../src/review.mjs';
import {
  baseManifest,
  commitAll,
  initGitRepo,
  makePlugin,
  runCli,
  textLines,
} from './helpers.mjs';

async function repo() {
  const root = await makePlugin();
  initGitRepo(root);
  commitAll(root, 'initial commit');
  return root;
}

test('a review snapshot reports commits, worktree changes and hashes', async () => {
  const root = await repo();
  await writeFile(join(root, 'README.md'), '# Changed\n');
  await writeFile(join(root, 'untracked.txt'), 'new file\n');
  const snapshot = await reviewSnapshot({ root, base: 'HEAD' });
  assert.equal(snapshot.requestedBase, 'HEAD');
  assert.equal(snapshot.baseCommit, snapshot.head);
  const paths = snapshot.files.map(file => file.path).sort();
  assert.deepEqual(paths, ['README.md', 'untracked.txt']);
  const readme = snapshot.files.find(file => file.path === 'README.md');
  assert.equal(readme.unstaged, true);
  assert.equal(readme.sha256, createHash('sha256').update('# Changed\n').digest('hex'));
  const untracked = snapshot.files.find(file => file.path === 'untracked.txt');
  assert.equal(untracked.untracked, true);
});

test('a base commit between HEAD includes the commits in between', async () => {
  const root = await repo();
  const first = (await import('node:child_process')).spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  await writeFile(join(root, 'notes.txt'), 'second\n');
  commitAll(root, 'second commit');
  const snapshot = await reviewSnapshot({ root, base: first });
  assert.equal(snapshot.mergeBase, first);
  assert.equal(snapshot.commits.length, 1);
  assert.equal(snapshot.commits[0].subject, 'second commit');
  assert.ok(snapshot.files.some(file => file.path === 'notes.txt'));
});

test('configured generated paths are flagged', async () => {
  const root = await repo();
  await writeFile(join(root, 'client.js'), 'changed client\n');
  const snapshot = await reviewSnapshot({ root, base: 'HEAD', generated: ['client.js'] });
  const client = snapshot.files.find(file => file.path === 'client.js');
  assert.equal(client.generated, true);
});

test('an invalid base reference is rejected', async () => {
  const root = await repo();
  await assert.rejects(() => reviewSnapshot({ root, base: 'does-not-exist' }), /Invalid base/);
});

test('a repository without HEAD is rejected', async () => {
  const root = await makePlugin();
  initGitRepo(root);
  await assert.rejects(() => reviewSnapshot({ root, base: 'HEAD' }), /HEAD has no commit/);
});

test('the review CLI prints a JSON snapshot and fails on a bad base', async () => {
  const root = await repo();
  await writeFile(join(root, 'untracked.txt'), 'x\n');
  const ok = runCli(['review', '--root', root, '--base', 'HEAD']);
  assert.equal(ok.status, 0, ok.stderr);
  const snapshot = JSON.parse(ok.stdout);
  assert.ok(snapshot.files.some(file => file.path === 'untracked.txt'));
  const bad = runCli(['review', '--root', root, '--base', 'nope']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Invalid base/);
});

test('review reads generated paths from dshPluginKit.review.generated', async () => {
  const manifest = {
    ...baseManifest(),
    dshPluginKit: { version: 1, review: { generated: ['client.js'] } },
  };
  const root = await makePlugin({ manifest });
  initGitRepo(root);
  commitAll(root, 'initial');
  await writeFile(join(root, 'client.js'), 'changed\n');
  const result = runCli(['review', '--root', root]);
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.files.find(file => file.path === 'client.js').generated, true);
});

test('review snapshot never echoes file content', async () => {
  const root = await repo();
  const secret = textLines(['SECRET-TOKEN-42']);
  await writeFile(join(root, 'README.md'), secret);
  const snapshot = await reviewSnapshot({ root, base: 'HEAD' });
  assert.ok(!JSON.stringify(snapshot).includes('SECRET-TOKEN-42'));
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat, readlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const execute = promisify(execFile);

async function git(root, args) {
  try {
    const { stdout } = await execute('git', ['-c', 'core.fsmonitor=false', '-c', 'diff.autoRefreshIndex=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout;
  } catch (error) {
    // Never echo git stderr: repository-specific helpers may expose local data.
    throw new Error('Git ' + args[0] + ' failed (' + (error.code ?? 'unknown') + '). Check the repository and commit reference.');
  }
}

const fields = text => {
  const parts = text.split('\0');
  if (parts.at(-1) === '') parts.pop();
  return parts;
};

const line = text => text.replace(/\r?\n$/, '');

function changesFrom(text) {
  const parts = fields(text);
  const changes = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    const first = parts[i++];
    if (!status || first === undefined) throw new Error('Incomplete Git name-status output.');
    if (status.startsWith('R') || status.startsWith('C')) {
      const path = parts[i++];
      if (path === undefined) throw new Error('Incomplete Git rename output.');
      changes.push({ path, oldPath: first, status });
    } else {
      changes.push({ path: first, status });
    }
  }
  return changes;
}

function worktreeStatuses(text) {
  const parts = fields(text);
  const statuses = new Map();
  for (let i = 0; i < parts.length;) {
    const item = parts[i++];
    const status = item.slice(0, 2);
    const path = item.slice(3);
    if (item[2] !== ' ') throw new Error('Unexpected Git porcelain output.');
    const entry = { status };
    statuses.set(path, entry);
    if (/[RC]/.test(status)) {
      const oldPath = parts[i++];
      if (oldPath === undefined) throw new Error('Incomplete Git porcelain rename.');
      entry.oldPath = oldPath;
    }
  }
  return statuses;
}

async function fileBytes(root, path) {
  try {
    const target = resolve(root, path);
    const info = await lstat(target);
    // Hash the link's own stored bytes rather than reading a target outside the repo.
    const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(target)) : await readFile(target);
    return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    if (error.code === 'ENOENT') return { bytes: null, sha256: null };
    throw new Error('Cannot read changed file ' + JSON.stringify(path) + ' (' + (error.code ?? 'unknown') + ').');
  }
}

/**
 * Repository review snapshot ported from the whale plugin. The fixed baseline is
 * merge-base(resolved base, HEAD); changes include commits, index and worktree, and
 * untracked non-ignored files. Only metadata and hashes are reported, never content.
 */
export async function reviewSnapshot({ root = process.cwd(), base = 'HEAD', generated = [] } = {}) {
  if (typeof base !== 'string' || !base.trim()) throw new Error('Base must be a non-empty commit reference.');
  if (!Array.isArray(generated)) throw new Error('generated must be an array of repository paths.');
  const requestedRoot = resolve(root);
  const repoRoot = line(await git(requestedRoot, ['rev-parse', '--show-toplevel']));
  let head;
  try {
    head = line(await git(repoRoot, ['rev-parse', '--verify', '--end-of-options', 'HEAD' + '^{commit}']));
  } catch {
    throw new Error('Repository HEAD has no commit. Create a commit before taking a review snapshot.');
  }
  let baseCommit;
  try {
    baseCommit = line(await git(repoRoot, ['rev-parse', '--verify', '--end-of-options', base + '^{commit}']));
  } catch {
    throw new Error('Invalid base: expected a reference resolving to a commit.');
  }
  const mergeBase = line(await git(repoRoot, ['merge-base', baseCommit, head]));
  const [diff, porcelain, untracked, history] = await Promise.all([
    git(repoRoot, ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', mergeBase, '--']),
    git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
    git(repoRoot, ['log', '--format=%H%x00%s', '-z', mergeBase + '..' + head, '--']),
  ]);
  const states = worktreeStatuses(porcelain);
  const changes = changesFrom(diff);
  const known = new Set(changes.map(change => change.path));
  // Net baseline-to-worktree changes can cancel staged changes. Keep those index
  // states visible too; porcelain rename sources are metadata, not extra files.
  for (const [path, entry] of states) {
    if (entry.status !== '??' && !known.has(path)) {
      changes.push({ path, ...(entry.oldPath ? { oldPath: entry.oldPath } : {}), status: entry.status });
      known.add(path);
    }
  }
  for (const path of fields(untracked)) {
    if (!known.has(path)) changes.push({ path, status: '??' });
  }
  const files = [];
  for (const change of changes) {
    const worktreeStatus = states.get(change.path)?.status ?? '  ';
    files.push({
      ...change,
      worktreeStatus,
      staged: ![' ', '?'].includes(worktreeStatus[0]),
      unstaged: ![' ', '?'].includes(worktreeStatus[1]),
      untracked: change.status === '??',
      generated: generated.includes(change.path),
      ...(await fileBytes(repoRoot, change.path)),
    });
  }
  const entries = fields(history);
  const commits = [];
  for (let i = 0; i < entries.length; i += 2) commits.push({ hash: entries[i], subject: entries[i + 1] });
  return { root: repoRoot, requestedBase: base, baseCommit, head, mergeBase, commits, files };
}

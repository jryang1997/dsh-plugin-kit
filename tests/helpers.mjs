import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';

export const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = join(KIT_ROOT, 'bin', 'dsh-plugin-kit.mjs');
const createdDirectories = [];

/** Every temp directory is removed when the test file finishes. */
after(async () => {
  await Promise.all(createdDirectories.map(dir => rm(dir, { recursive: true, force: true })));
});

export async function tempDir(prefix = 'dsh-kit-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(dir);
  return dir;
}

export async function writeTree(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
}

/** A complete, passing plugin package. Override individual files or the manifest. */
export async function makePlugin({ files = {}, manifest } = {}) {
  const root = await tempDir();
  const all = {
    'index.js': 'export function apply() {}\n',
    'client.js': 'window.__ModuleLoader__.load({ id: "test-plugin", factory() { return { apply() {} }; } });\n',
    'cordis.patch.yml': ['- insert:', '    - id: test-plugin', "      name: 'test-plugin'"].join('\n') + '\n',
    'locale/en.json': JSON.stringify({ meta: { title: 'Test plugin', description: 'A test plugin.' } }, null, 2) + '\n',
    'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"></svg>\n',
    'README.md': '# Test plugin\n\nA test plugin.\n',
    ...files,
  };
  all['package.json'] = JSON.stringify(manifest ?? baseManifest(), null, 2) + '\n';
  await writeTree(root, all);
  return root;
}

export function baseManifest() {
  return {
    name: 'test-plugin',
    version: '1.2.3',
    type: 'module',
    license: 'MIT',
    exports: {
      '.': './index.js',
      './client': './client.js',
      './package.json': './package.json',
    },
    files: ['index.js', 'client.js', 'cordis.patch.yml', 'locale/', 'icon.svg', 'README.md'],
    icon: './icon.svg',
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', immediately: true, inject: [] },
    },
  };
}

export function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: options.cwd ?? KIT_ROOT,
    encoding: 'utf8',
    timeout: options.timeout ?? 240000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) {
    throw new Error('git ' + args.join(' ') + ' failed: ' + (result.stderr || result.stdout));
  }
  return result.stdout;
}

export function initGitRepo(root) {
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.email', 'kit@example.com']);
  runGit(root, ['config', 'user.name', 'Kit Tests']);
  runGit(root, ['config', 'core.autocrlf', 'false']);
}

export function commitAll(root, message) {
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '-qm', message]);
}

/** Lines helper for fixtures that need readable multi-line text files. */
export function textLines(list) {
  return list.join('\n') + '\n';
}

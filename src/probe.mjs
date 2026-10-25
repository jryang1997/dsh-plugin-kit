import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const DEFAULT_PATHS = ['AGENTS.md'];

function inside(root, target) {
  const path = relative(root, target);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
}

/**
 * Read probe ported from the whale plugin. It reports only path, readability, byte
 * count and SHA-256: never file content. A successful probe does not establish that
 * the agent's native file tools can read the same path.
 */
export async function readProbe({ root = process.cwd(), paths = DEFAULT_PATHS } = {}) {
  const declaredRoot = resolve(root);
  const actualRoot = await realpath(declaredRoot);
  const files = [];
  for (const path of paths) {
    try {
      if (typeof path !== 'string' || !path || isAbsolute(path)) {
        throw Object.assign(new Error(), { code: 'OUTSIDE_ROOT' });
      }
      const target = resolve(declaredRoot, path);
      if (!inside(declaredRoot, target)) throw Object.assign(new Error(), { code: 'OUTSIDE_ROOT' });
      const actual = await realpath(target);
      if (!inside(actualRoot, actual)) throw Object.assign(new Error(), { code: 'OUTSIDE_ROOT' });
      const bytes = await readFile(actual);
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      files.push({
        path,
        readable: true,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    } catch (error) {
      files.push({
        path: String(path),
        readable: false,
        bytes: null,
        sha256: null,
        error: error.code ?? 'READ_FAILED',
      });
    }
  }
  return { root: declaredRoot, files };
}

export { DEFAULT_PATHS };

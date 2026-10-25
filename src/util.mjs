import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const FENCE_CHAR = String.fromCharCode(96);
const REGEX_SPECIALS = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

/** Convert Windows separators to forward slashes; every check and report uses POSIX paths. */
export function toPosix(path) {
  return String(path).replace(/\\/g, '/');
}

/** Strip a leading "./" and duplicate slashes; keeps the path relative. */
export function normalizeRel(path) {
  let value = toPosix(path).trim();
  while (value.startsWith('./')) value = value.slice(2);
  return value.replace(/\/{2,}/g, '/');
}

/** Resolve a package-relative path and refuse anything that escapes the repository root. */
export function resolveInside(root, path) {
  const value = normalizeRel(path);
  if (value === '' || isAbsolute(value) || value.split('/').includes('..')) {
    throw new Error('path escapes the repository root: ' + JSON.stringify(path));
  }
  return join(root, value);
}

/** True when target resolves inside root (used for manifest path checks). */
export function isInside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readText(path) {
  return readFile(path, 'utf8');
}

export async function readJson(path) {
  const text = await readFile(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(path + ' is not valid JSON: ' + error.message);
  }
}

/** List a directory, returning [] when it does not exist. */
export async function listDir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Refuse to overwrite a directory that already holds files. */
export async function isNonEmptyDir(dir) {
  const entries = await listDir(dir);
  return entries.length > 0;
}

/** Recursively list files under dir, skipping dot directories and node_modules. */
export async function walkFiles(dir, visit) {
  for (const entry of await listDir(dir)) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const target = join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(target, visit);
    else if (entry.isFile()) await visit(target);
  }
}

function escapeRegExpChar(char) {
  return REGEX_SPECIALS.has(char) ? '\\' + char : char;
}

/** Convert a simple glob (only * and ?) to an anchored regular expression. */
export function globToRegExp(pattern) {
  let source = '';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += escapeRegExpChar(char);
  }
  return new RegExp('^' + source + '$');
}

export function matchesAny(name, patterns) {
  return patterns.some(pattern => globToRegExp(pattern).test(name));
}

const REMOTE = /^[a-z][a-z0-9+.-]*:/i;
const IMAGE = /\.(?:svg|png|jpe?g|webp|gif)$/i;

export function isImagePath(path) {
  return IMAGE.test(normalizeRel(path));
}

/** Relative image references from Markdown images and HTML img tags. */
export function relativeImageRefs(markdown) {
  const refs = new Set();
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))[^)]*\)/g)) {
    const raw = match[1] ?? match[2];
    if (raw) addRef(refs, raw);
  }
  for (const match of markdown.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    const raw = match[1] ?? match[2];
    if (raw) addRef(refs, raw);
  }
  return [...refs];
}

function addRef(refs, raw) {
  const value = raw.trim();
  if (!value) return;
  if (value.startsWith('#') || value.startsWith('/')) return;
  if (REMOTE.test(value)) return;
  if (value.startsWith('data:')) return;
  const withoutFragment = value.split('#')[0].split('?')[0];
  if (!withoutFragment) return;
  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // Keep the raw path when percent-decoding fails.
  }
  refs.add(normalizeRel(decoded));
}

/** Count Markdown headings per level, ignoring fenced code blocks. */
export function headingCounts(markdown) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let fence = null;
  const fenceMarker = FENCE_CHAR.repeat(3);
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    const isFence = trimmed.startsWith(fenceMarker) || trimmed.startsWith('~~~');
    if (isFence) {
      const marker = trimmed[0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const match = /^(#{1,6})\s+\S/.exec(line);
    if (match) counts[match[1].length] += 1;
  }
  return counts;
}

/** Flatten nested JSON into a Map of dotted keys to leaf values. */
export function flattenLeaves(value, prefix = '', out = new Map()) {
  if (Array.isArray(value)) {
    out.set(prefix, value);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flattenLeaves(child, prefix === '' ? key : prefix + '.' + key, out);
    }
    return out;
  }
  out.set(prefix, value);
  return out;
}

/** Placeholder names used by a locale string, in {name} or {{name}} form. */
export function placeholdersOf(value) {
  const found = new Set();
  if (typeof value !== 'string') return found;
  for (const match of value.matchAll(/\{\{?\s*([A-Za-z0-9_.-]+)\s*\}?\}/g)) found.add(match[1]);
  return found;
}

/** Detect the icon format from the first bytes; returns svg|png|jpeg|webp or null. */
export function sniffImageFormat(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  const head = buffer.subarray(0, 1024).toString('utf8').trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return null;
}

/** Shorten long stderr/JSON for one-line error messages. */
export function tail(text, limit = 800) {
  const value = String(text ?? '').trim();
  return value.length > limit ? '...' + value.slice(-limit) : value;
}

/** Conventional locale dictionary path: locale/<language>.json. */
export function joinLocalePath(root, language) {
  return join(root, 'locale', language + '.json');
}

/** JSON stringify with a trailing newline; fixtures use it for stable bytes. */
export function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

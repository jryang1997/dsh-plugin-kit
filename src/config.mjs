import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Usage problems: bad arguments or a directory that is not a plugin package. Exit code 2. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Invalid dshPluginKit configuration. Exit code 2. */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** The DSH icon budget from the installed build, 256 KiB. Repositories may tighten it. */
export const MAX_ICON_BYTES = 256 * 1024;

const DEFAULT_TEST_INCLUDE = ['*.test.js', '*.test.mjs'];
const DEFAULT_PACK_FORBID = ['tests/', 'scripts/', 'preview/', '.github/', '.node-version', 'pnpm-workspace.yaml'];
const DEFAULT_PACK_REQUIRE = ['locale/en.json'];

export function defaultConfig() {
  return {
    version: 1,
    dshRulesVersion: null,
    sources: { mode: 'json' },
    tests: { include: [...DEFAULT_TEST_INCLUDE], runner: 'auto' },
    artifacts: [],
    pack: { forbid: [...DEFAULT_PACK_FORBID], require: [...DEFAULT_PACK_REQUIRE] },
    icon: { declaration: 'auto', budgetBytes: MAX_ICON_BYTES },
    locale: { required: ['en'], metadata: ['title', 'description'] },
    readme: { files: ['README.md'], parity: ['headings', 'figures'] },
    screenshots: { manifest: 'screenshots.json', strict: false },
    versionSites: [],
    review: { generated: [] },
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Merge user configuration over defaults; arrays and scalars replace, objects recurse. */
function mergeConfig(base, override) {
  if (!isPlainObject(override)) return override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) && isPlainObject(base?.[key])
      ? mergeConfig(base[key], value)
      : value;
  }
  return result;
}
function fail(message) {
  throw new ConfigError(message);
}

function requireStringArray(value, name, options = {}) {
  const allowEmpty = options.allowEmpty === true;
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(name + ' must be a ' + (allowEmpty ? '' : 'non-empty ') + 'array of strings.');
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') fail(name + ' must contain only non-empty strings.');
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail(name + ' must be a non-empty string.');
  return value;
}

function oneOf(value, name, allowed) {
  if (!allowed.includes(value)) fail(name + ' must be one of: ' + allowed.join(', ') + '.');
  return value;
}

/**
 * Validate a merged configuration and return { config, warnings }.
 * Warnings never change the exit code; bad configuration always throws ConfigError.
 */
export function validateConfig(config) {
  const warnings = [];
  if (config.version !== 1) fail('dshPluginKit.version must be 1; this kit implements version 1 only.');
  if (config.dshRulesVersion !== null && typeof config.dshRulesVersion !== 'string') {
    fail('dshPluginKit.dshRulesVersion must be a string or null.');
  }

  if (!isPlainObject(config.sources)) fail('dshPluginKit.sources must be an object such as { "mode": "json" }.');
  if (config.sources.mode !== 'json') {
    fail('dshPluginKit.sources.mode ' + JSON.stringify(config.sources.mode) + ' is not supported in v1; only "json" locale dictionaries are implemented.');
  }

  if (!isPlainObject(config.tests)) fail('dshPluginKit.tests must be an object.');
  requireStringArray(config.tests.include, 'dshPluginKit.tests.include');
  oneOf(config.tests.runner, 'dshPluginKit.tests.runner', ['auto', 'script']);

  if (!Array.isArray(config.artifacts)) fail('dshPluginKit.artifacts must be an array.');
  const artifactFiles = new Set();
  for (const [index, entry] of config.artifacts.entries()) {
    if (!isPlainObject(entry)) fail('dshPluginKit.artifacts[' + index + '] must be an object with file and produce.');
    requireString(entry.file, 'dshPluginKit.artifacts[' + index + '].file');
    requireString(entry.produce, 'dshPluginKit.artifacts[' + index + '].produce');
    if (artifactFiles.has(entry.file)) warnings.push('dshPluginKit.artifacts lists ' + entry.file + ' more than once.');
    artifactFiles.add(entry.file);
  }

  if (!isPlainObject(config.pack)) fail('dshPluginKit.pack must be an object.');
  requireStringArray(config.pack.forbid, 'dshPluginKit.pack.forbid', { allowEmpty: true });
  requireStringArray(config.pack.require, 'dshPluginKit.pack.require', { allowEmpty: true });

  if (!isPlainObject(config.icon)) fail('dshPluginKit.icon must be an object.');
  oneOf(config.icon.declaration, 'dshPluginKit.icon.declaration', ['auto', 'field', 'exports']);
  if (!Number.isInteger(config.icon.budgetBytes) || config.icon.budgetBytes <= 0) {
    fail('dshPluginKit.icon.budgetBytes must be a positive integer.');
  }
  if (config.icon.budgetBytes > MAX_ICON_BYTES) {
    warnings.push('dshPluginKit.icon.budgetBytes ' + config.icon.budgetBytes + ' exceeds the DSH limit; using ' + MAX_ICON_BYTES + ' bytes.');
    config.icon.budgetBytes = MAX_ICON_BYTES;
  }

  if (!isPlainObject(config.locale)) fail('dshPluginKit.locale must be an object.');
  requireStringArray(config.locale.required, 'dshPluginKit.locale.required');
  for (const language of config.locale.required) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(language)) fail('dshPluginKit.locale.required contains an invalid language code: ' + JSON.stringify(language));
  }
  requireStringArray(config.locale.metadata, 'dshPluginKit.locale.metadata');

  if (!isPlainObject(config.readme)) fail('dshPluginKit.readme must be an object.');
  requireStringArray(config.readme.files, 'dshPluginKit.readme.files');
  requireStringArray(config.readme.parity, 'dshPluginKit.readme.parity', { allowEmpty: true });
  for (const item of config.readme.parity) {
    oneOf(item, 'dshPluginKit.readme.parity entry', ['headings', 'figures']);
  }

  if (!isPlainObject(config.screenshots)) fail('dshPluginKit.screenshots must be an object.');
  requireString(config.screenshots.manifest, 'dshPluginKit.screenshots.manifest');
  if (typeof config.screenshots.strict !== 'boolean') fail('dshPluginKit.screenshots.strict must be a boolean.');

  if (!Array.isArray(config.versionSites)) fail('dshPluginKit.versionSites must be an array.');
  for (const [index, site] of config.versionSites.entries()) {
    if (!isPlainObject(site)) fail('dshPluginKit.versionSites[' + index + '] must be an object with file and pattern.');
    requireString(site.file, 'dshPluginKit.versionSites[' + index + '].file');
    requireString(site.pattern, 'dshPluginKit.versionSites[' + index + '].pattern');
    if (site.group !== undefined && (!Number.isInteger(site.group) || site.group < 0)) {
      fail('dshPluginKit.versionSites[' + index + '].group must be a non-negative integer.');
    }
    if (site.flags !== undefined && typeof site.flags !== 'string') {
      fail('dshPluginKit.versionSites[' + index + '].flags must be a string.');
    }
    try {
      new RegExp(site.pattern, site.flags ?? '');
    } catch (error) {
      fail('dshPluginKit.versionSites[' + index + '].pattern is not a valid regular expression: ' + error.message);
    }
  }

  if (!isPlainObject(config.review)) fail('dshPluginKit.review must be an object.');
  requireStringArray(config.review.generated, 'dshPluginKit.review.generated', { allowEmpty: true });

  return { config, warnings };
}

/**
 * Load package.json and the dshPluginKit configuration for a project root.
 * A package with no dshPluginKit key gets safe defaults; only a broken package.json
 * or invalid configuration stops the kit.
 */
export async function loadProject(rootArgument = process.cwd()) {
  const root = resolve(rootArgument);
  let info;
  try {
    info = await stat(root);
  } catch {
    throw new UsageError('project root does not exist: ' + root);
  }
  if (!info.isDirectory()) throw new UsageError('project root is not a directory: ' + root);

  const manifestPath = join(root, 'package.json');
  let text;
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new UsageError('no package.json in ' + root + '; dsh-plugin-kit verifies npm plugin packages.');
    }
    throw new UsageError('cannot read ' + manifestPath + ': ' + error.message);
  }

  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new UsageError(manifestPath + ' is not valid JSON: ' + error.message);
  }
  if (!isPlainObject(manifest)) throw new UsageError(manifestPath + ' must contain a JSON object.');

  const raw = manifest.dshPluginKit;
  if (raw === undefined) {
    return { root, manifest, config: defaultConfig(), warnings: [] };
  }
  if (!isPlainObject(raw)) throw new ConfigError('package.json "dshPluginKit" must be an object.');
  const merged = mergeConfig(defaultConfig(), raw);
  const { config, warnings } = validateConfig(merged);
  return { root, manifest, config, warnings };
}

/** Review/audit commands also work in a repository that is not a plugin package. */
export async function loadOptionalProject(rootArgument = process.cwd()) {
  try {
    return await loadProject(rootArgument);
  } catch (error) {
    if (error instanceof UsageError) {
      return { root: resolve(rootArgument), manifest: null, config: defaultConfig(), warnings: [] };
    }
    throw error;
  }
}

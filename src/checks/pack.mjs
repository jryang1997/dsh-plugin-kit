import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createReport, reportError, reportWarning } from '../report.mjs';
import {
  normalizeRel,
  readText,
  relativeImageRefs,
  resolveInside,
  sniffImageFormat,
  tail,
} from '../util.mjs';

const ICON_EXTENSIONS = /\.(?:svg|png|jpe?g|webp)$/i;

/**
 * Ask npm what it would ship. --ignore-scripts keeps the check read-only even when a
 * repository defines prepack hooks; --dry-run guarantees nothing is written.
 */
export function runNpmPack(root) {
  const options = {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
  };
  // npm is a cmd shim on Windows. Run the fixed literal through cmd.exe instead of
  // shell:true, which Node deprecates for argument arrays.
  const commandLine = 'npm pack --dry-run --json --ignore-scripts';
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], options)
    : spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], options);
  if (result.error) throw new Error('could not run npm pack: ' + result.error.message);
  if (result.status !== 0) throw new Error('npm pack --dry-run failed: ' + tail(result.stderr || result.stdout));
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('npm pack --dry-run --json did not return JSON: ' + tail(result.stdout));
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || !Array.isArray(entry.files)) throw new Error('npm pack --dry-run --json returned no file list.');
  return entry.files.map(file => ({ path: normalizeRel(file.path), size: Number(file.size) || 0 }));
}

/** Resolve the declared icon path according to dshPluginKit.icon.declaration. */
export function resolveIcon(manifest, declaration = 'auto') {
  if (declaration === 'field' || declaration === 'auto') {
    if (typeof manifest.icon === 'string' && manifest.icon.trim() !== '') {
      return { path: normalizeRel(manifest.icon), declaration: 'field' };
    }
    if (declaration === 'field') {
      return { error: 'dshPluginKit.icon.declaration is "field" but package.json has no "icon" path.' };
    }
  }
  if (declaration === 'exports' || declaration === 'auto') {
    const value = manifest.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)
      ? manifest.exports['./icon']
      : undefined;
    if (typeof value === 'string' && value.trim() !== '') {
      return { path: normalizeRel(value), declaration: 'exports' };
    }
    if (value !== undefined) {
      return { error: 'exports["./icon"] must be a string path to an SVG, PNG, JPEG or WebP file.' };
    }
    if (declaration === 'exports') {
      return { error: 'dshPluginKit.icon.declaration is "exports" but exports["./icon"] is missing.' };
    }
  }
  return null;
}

function matchesForbidden(entry, packedPath) {
  const normalized = normalizeRel(entry);
  if (normalized.endsWith('/')) return packedPath.startsWith(normalized);
  return packedPath === normalized || packedPath.startsWith(normalized + '/');
}

/**
 * Packaging gate: files whitelist, README figures, dev-file leaks, icon budget.
 * Runs the real npm pack so the answer is what npm publish would ship, not an
 * interpretation of the manifest.
 */
export async function checkPack({ root, manifest, config }) {
  const report = createReport('pack');
  let packed;
  try {
    packed = runNpmPack(root);
  } catch (error) {
    reportError(report, error.message);
    return report;
  }
  const packedSet = new Set(packed.map(file => file.path));

  if (!Array.isArray(manifest.files)) {
    reportWarning(report, 'package.json has no "files" whitelist; npm would ship everything not ignored.');
  } else {
    for (const entry of manifest.files) {
      if (typeof entry !== 'string' || entry.trim() === '') {
        reportError(report, 'files must contain only non-empty strings.');
        continue;
      }
      if (entry.includes('*')) continue;
      const normalized = normalizeRel(entry);
      if (normalized === '') {
        reportError(report, 'files entry ' + JSON.stringify(entry) + ' is empty after normalisation.');
        continue;
      }
      if (normalized.endsWith('/')) {
        if (!packed.some(file => file.path.startsWith(normalized))) {
          reportError(report, 'files lists the directory ' + entry + ' but npm pack did not include anything under it.');
        }
      } else if (!packedSet.has(normalized)) {
        reportError(report, 'files lists ' + entry + ' but npm pack did not include it; the path is missing or ignored.');
      }
    }
  }

  for (const forbidden of config.pack.forbid) {
    const leaks = packed.filter(file => matchesForbidden(forbidden, file.path));
    if (leaks.length > 0) {
      reportError(report, 'development path ' + forbidden + ' leaked into the tarball: ' + leaks.slice(0, 3).map(file => file.path).join(', '));
    }
  }

  for (const required of config.pack.require) {
    const normalized = normalizeRel(required);
    const present = normalized.endsWith('/')
      ? packed.some(file => file.path.startsWith(normalized))
      : packedSet.has(normalized);
    if (!present) reportError(report, 'required package path ' + required + ' is not in the tarball.');
  }

  for (const readmeFile of config.readme.files) {
    let markdown;
    try {
      markdown = await readText(resolveInside(root, readmeFile));
    } catch {
      continue; // the readme check reports a missing README itself.
    }
    for (const reference of relativeImageRefs(markdown)) {
      if (!packedSet.has(reference)) {
        reportError(report, readmeFile + ' references ' + reference + ', which the package does not ship.');
      }
    }
  }

  const icon = resolveIcon(manifest, config.icon.declaration);
  if (icon === null) {
    reportWarning(report, 'no package icon declared (manifest "icon" or exports["./icon"]); DSH falls back to a generic mark.');
  } else if (icon.error) {
    reportError(report, icon.error);
  } else {
    let target;
    try {
      target = resolveInside(root, icon.path);
    } catch (error) {
      reportError(report, 'icon: ' + error.message);
      target = null;
    }
    if (target !== null) {
      if (!ICON_EXTENSIONS.test(icon.path)) {
        reportError(report, 'icon ' + icon.path + ' must be SVG, PNG, JPEG or WebP.');
      }
      let info = null;
      try {
        info = await stat(target);
      } catch {
        reportError(report, 'icon file does not exist: ' + icon.path);
      }
      if (info !== null) {
        if (!info.isFile()) {
          reportError(report, 'icon must be a file: ' + icon.path);
        } else {
          const budget = config.icon.budgetBytes;
          if (info.size > budget) {
            reportError(report, 'icon ' + icon.path + ' is ' + info.size + ' bytes; the budget is ' + budget + ' bytes.');
          }
          const bytes = await readFile(target);
          const format = sniffImageFormat(bytes);
          if (format === null) {
            reportError(report, 'icon ' + icon.path + ' is not SVG, PNG, JPEG or WebP content.');
          }
          if (!packedSet.has(icon.path)) {
            reportError(report, 'icon ' + icon.path + ' is not in the tarball; add it to package.json "files".');
          }
        }
      }
    }
  }

  report.stats = { files: packed.length };
  return report;
}

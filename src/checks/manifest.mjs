import { stat } from 'node:fs/promises';
import { createReport, reportError, reportWarning } from '../report.mjs';
import { resolveInside } from '../util.mjs';

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare'];
const CLIENT_ARRAY_FIELDS = ['inject', 'external'];

async function requireFile(report, root, label, relativePath) {
  let target;
  try {
    target = resolveInside(root, relativePath);
  } catch (error) {
    reportError(report, label + ': ' + error.message);
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) reportError(report, label + ' must point at a file: ' + relativePath);
  } catch {
    reportError(report, label + ' file does not exist: ' + relativePath);
  }
}

/**
 * Manifest gate: the two keys DSH needs to load a bundle, the browser-half shape,
 * exports["./client"], and the install-hook ban. No plugin behaviour is checked here.
 */
export async function checkManifest({ root, manifest }) {
  const report = createReport('manifest');

  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    reportError(report, 'package.json must declare a non-empty "name".');
  }
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    reportError(report, 'package.json must declare a non-empty "version".');
  }

  const dsh = manifest.dsh;
  const bundle = dsh && typeof dsh === 'object' && !Array.isArray(dsh) ? dsh.bundle : undefined;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    reportError(report, 'package.json must declare dsh.bundle.patch; without it DSH never loads the bundle.');
  } else {
    const patch = bundle.patch;
    const entries = typeof patch === 'string' ? [patch] : Array.isArray(patch) ? patch : null;
    if (entries === null) {
      reportError(report, 'dsh.bundle.patch must be a string or an array of strings.');
    } else if (entries.length === 0) {
      reportError(report, 'dsh.bundle.patch must not be empty.');
    } else {
      for (const [index, entry] of entries.entries()) {
        if (typeof entry !== 'string' || entry.trim() === '') {
          reportError(report, 'dsh.bundle.patch[' + index + '] must be a non-empty string.');
          continue;
        }
        await requireFile(report, root, 'dsh.bundle.patch[' + index + ']', entry);
      }
    }
  }

  const client = dsh && typeof dsh === 'object' && !Array.isArray(dsh) ? dsh.client : undefined;
  if (client === undefined) {
    reportWarning(report, 'no dsh.client declaration: this package installs as a host-only bundle.');
  } else if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    reportError(report, 'dsh.client must be an object.');
  } else {
    if (client.platform !== 'web') {
      reportError(report, 'dsh.client.platform must be "web"; DSH only mounts browser modules.');
    }
    for (const field of CLIENT_ARRAY_FIELDS) {
      if (client[field] === undefined) continue;
      if (!Array.isArray(client[field])) {
        reportError(report, 'dsh.client.' + field + ' must be an array of service names.');
        continue;
      }
      if (client[field].some(item => typeof item !== 'string' || item.trim() === '')) {
        reportError(report, 'dsh.client.' + field + ' must contain only non-empty strings.');
      }
    }
    if (client.immediately !== undefined && typeof client.immediately !== 'boolean') {
      reportError(report, 'dsh.client.immediately must be a boolean.');
    }
    const clientExport = manifest.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)
      ? manifest.exports['./client']
      : undefined;
    if (typeof clientExport !== 'string' || clientExport.trim() === '') {
      reportError(report, 'dsh.client requires exports["./client"]; DSH imports the browser half through that specifier.');
    } else {
      await requireFile(report, root, 'exports["./client"]', clientExport);
    }
  }

  const pkgExport = manifest.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)
    ? manifest.exports['./package.json']
    : undefined;
  if (pkgExport === undefined) {
    reportWarning(report, 'exports["./package.json"] is recommended so tooling can read the manifest; it is optional for DSH.');
  }

  const scripts = manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {};
  for (const hook of INSTALL_HOOKS) {
    if (Object.prototype.hasOwnProperty.call(scripts, hook)) {
      reportError(report, 'scripts.' + hook + ' must not be defined; install-time scripts are outside the DSH plugin contract.');
    }
  }

  return report;
}

import { readFile } from 'node:fs/promises';
import { createReport, reportError } from '../report.mjs';
import { resolveInside } from '../util.mjs';

/**
 * Version gate: configured version sites must resolve to package.json's version.
 * Each site is a file plus a regular expression whose configured capture group
 * contains the version string; a leading "v" is accepted.
 */
export async function checkVersionSites({ root, manifest, config }) {
  const report = createReport('version');
  const version = String(manifest.version ?? '');
  for (const site of config.versionSites) {
    let text;
    try {
      text = await readFile(resolveInside(root, site.file), 'utf8');
    } catch (error) {
      reportError(report, 'version site ' + site.file + ' cannot be read: ' + error.message);
      continue;
    }
    const expression = new RegExp(site.pattern, site.flags ?? '');
    const match = expression.exec(text);
    if (match === null) {
      reportError(report, 'version site ' + site.file + ' does not match its pattern: ' + site.pattern);
      continue;
    }
    const group = site.group ?? 1;
    const captured = match[group];
    if (captured === undefined) {
      reportError(report, 'version site ' + site.file + ' pattern must capture the version in group ' + group + '.');
      continue;
    }
    const declared = captured.startsWith('v') ? captured.slice(1) : captured;
    if (declared !== version) {
      reportError(report, site.file + ' declares version ' + captured + '; package.json has ' + version + '.');
    }
  }
  report.stats = { sites: config.versionSites.length };
  return report;
}

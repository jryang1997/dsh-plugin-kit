import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { checkManifest } from './checks/manifest.mjs';
import { checkLocale } from './checks/locale.mjs';
import { checkReadme } from './checks/readme.mjs';
import { checkVersionSites } from './checks/version.mjs';
import { createReport, reportError } from './report.mjs';
import { listDir, matchesAny, tail } from './util.mjs';

const DISCOVERY_DIRECTORIES = ['src', 'tests', 'scripts', 'preview'];
const SOURCE_FILE = /\.(?:mjs|js)$/;

/**
 * Discovery is deliberately boring: root-level JavaScript modules plus the four
 * conventional project directories, recursively, skipping dot directories and
 * node_modules. Backup folders and dependencies never become project files.
 */
export async function projectFiles({ root, config }) {
  const include = config?.tests?.include ?? ['*.test.js', '*.test.mjs'];
  const sources = [];
  const rootEntries = await readdir(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && SOURCE_FILE.test(entry.name)) sources.push(entry.name);
  }
  async function visit(relativeDirectory) {
    const absoluteDirectory = join(root, relativeDirectory);
    for (const entry of await listDir(absoluteDirectory)) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relative = relativeDirectory + '/' + entry.name;
      if (entry.isDirectory()) {
        await visit(relative);
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        sources.push(relative);
      }
    }
  }
  for (const directory of DISCOVERY_DIRECTORIES) await visit(directory);
  const unique = [...new Set(sources)].sort();
  const tests = unique.filter(relative => matchesAny(basename(relative), include));
  return { sources: unique, tests };
}

function nodeCheck(root, relativePath) {
  return spawnSync(process.execPath, ['--check', relativePath], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** Syntax gate: node --check every discovered project source, report each failure. */
export function checkSyntax({ root, sources }) {
  const report = createReport('syntax');
  for (const source of sources) {
    const result = nodeCheck(root, source);
    if (result.error) {
      reportError(report, source + ': could not run node --check: ' + result.error.message);
      continue;
    }
    if (result.status !== 0) {
      reportError(report, source + ': ' + tail(result.stderr || result.stdout, 600));
    }
  }
  report.stats = { files: sources.length };
  return report;
}

function executeTests(root, files, config) {
  const env = { ...process.env };
  // A test may exercise this runner inside a fixture; its child suite is independent.
  delete env.NODE_TEST_CONTEXT;
  const options = {
    cwd: root,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024,
    env,
  };
  if (config.tests.runner === 'script') {
    let output = '';
    for (const file of files) {
      const result = spawnSync(process.execPath, [file], options);
      output += (result.stdout ?? '') + (result.stderr ?? '');
      if (result.error) return { ok: false, files, output: output + '\ncould not run ' + file + ': ' + result.error.message };
      if (result.status !== 0) return { ok: false, files, output };
    }
    return { ok: true, files, output };
  }
  const result = spawnSync(process.execPath, ['--test', ...files], options);
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  if (result.error) return { ok: false, files, output: output + '\ncould not run node --test: ' + result.error.message };
  return { ok: result.status === 0, files, output };
}

/**
 * Test gate: discover tests with dshPluginKit.tests.include and refuse an empty suite.
 * "auto" runs node --test; "script" runs each file directly for repositories that
 * assert with plain scripts instead of node:test.
 */
export async function runTests({ root, config }) {
  const { tests } = await projectFiles({ root, config });
  if (tests.length === 0) {
    const include = config.tests.include.join(', ');
    return { ok: false, files: tests, output: 'No test files matched ' + include + '; refusing to run an empty suite.' };
  }
  return executeTests(root, tests, config);
}

/** The static half of verify: manifest, locale, README, version sites, syntax. */
export async function runStaticChecks({ root, manifest, config }) {
  const reports = [];
  reports.push(await checkManifest({ root, manifest }));
  reports.push(await checkLocale({ root, config }));
  reports.push(await checkReadme({ root, config }));
  reports.push(await checkVersionSites({ root, manifest, config }));
  const { sources } = await projectFiles({ root, config });
  reports.push(checkSyntax({ root, sources }));
  return reports;
}

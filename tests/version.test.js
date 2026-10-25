import assert from 'node:assert/strict';
import test from 'node:test';
import { checkVersionSites } from '../src/checks/version.mjs';
import { loadProject } from '../src/config.mjs';
import { baseManifest, makePlugin, runCli, textLines } from './helpers.mjs';

const VERSION_PATTERN = "const VERSION = '([^']+)'";

function manifestWithSites(sites) {
  return {
    ...baseManifest(),
    dshPluginKit: { version: 1, versionSites: sites },
  };
}

async function run(files, sites) {
  const manifest = manifestWithSites(sites);
  const root = await makePlugin({ files, manifest });
  const project = await loadProject(root);
  return checkVersionSites({ root, manifest: project.manifest, config: project.config });
}

test('a matching version site passes', async () => {
  const report = await run(
    { 'client.js': textLines(["const VERSION = '1.2.3';", 'export { VERSION };']) },
    [{ file: 'client.js', pattern: VERSION_PATTERN }],
  );
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.sites, 1);
});

test('a version site that disagrees with package.json is an error', async () => {
  const report = await run(
    { 'client.js': textLines(["const VERSION = '9.9.9';", 'export { VERSION };']) },
    [{ file: 'client.js', pattern: VERSION_PATTERN }],
  );
  assert.match(report.errors.join('\n'), /declares version 9\.9\.9; package\.json has 1\.2\.3/);
});

test('a version site file that is missing is an error', async () => {
  const report = await run({}, [{ file: 'gone.js', pattern: VERSION_PATTERN }]);
  assert.match(report.errors.join('\n'), /gone\.js cannot be read/);
});

test('a version site pattern that does not match is an error', async () => {
  const report = await run(
    { 'client.js': textLines(['const OTHER = 1;']) },
    [{ file: 'client.js', pattern: VERSION_PATTERN }],
  );
  assert.match(report.errors.join('\n'), /does not match its pattern/);
});

test('a version site pattern without a capture group is an error', async () => {
  const report = await run(
    { 'client.js': textLines(["const VERSION = '1.2.3';"]) },
    [{ file: 'client.js', pattern: 'const VERSION = .+' }],
  );
  assert.match(report.errors.join('\n'), /must capture the version/);
});

test('a leading v is accepted in the captured version', async () => {
  const report = await run(
    { 'client.js': textLines(["const VERSION = 'v1.2.3';"]) },
    [{ file: 'client.js', pattern: VERSION_PATTERN }],
  );
  assert.deepEqual(report.errors, []);
});

test('check exits 1 when a configured version site drifts', async () => {
  const manifest = manifestWithSites([{ file: 'client.js', pattern: VERSION_PATTERN }]);
  const root = await makePlugin({
    files: { 'client.js': textLines(["const VERSION = '0.0.1';"]) },
    manifest,
  });
  const result = runCli(['check', '--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[FAIL\] version/);
});

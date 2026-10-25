import assert from 'node:assert/strict';
import test from 'node:test';
import { checkScreenshots } from '../src/checks/screenshots.mjs';
import { loadProject } from '../src/config.mjs';
import { baseManifest, makePlugin } from './helpers.mjs';

const PNG_BYTES = '\x89PNG\r\n\x1a\nfake';
const SHOT_A = { 'docs/a.png': PNG_BYTES };
const SHOT_B = { 'docs/b.gif': 'GIF89a' };

async function run(files, { strict = false, manifest = baseManifest() } = {}) {
  const root = await makePlugin({ files, manifest });
  const project = await loadProject(root);
  return checkScreenshots({ root, config: project.config, strict });
}

test('the legacy array manifest passes when its files exist', async () => {
  const report = await run({
    ...SHOT_A,
    ...SHOT_B,
    'screenshots.json': JSON.stringify(['docs/a.png', 'docs/b.gif'], null, 2) + '\n',
  });
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.shots, 2);
});

test('the version 2 manifest accepts referencedBy paths that mention the file', async () => {
  const report = await run({
    ...SHOT_A,
    'README.md': '# Test plugin\n\n![Overview](docs/a.png)\n',
    'screenshots.json': JSON.stringify({
      version: 2,
      shots: [{ file: 'docs/a.png', id: 'overview', viewport: '1440x900', theme: 'dark', referencedBy: ['README.md'] }],
    }, null, 2) + '\n',
  });
  assert.deepEqual(report.errors, []);
});

test('a screenshot file that does not exist is an error', async () => {
  const report = await run({ 'screenshots.json': JSON.stringify(['docs/gone.png'], null, 2) + '\n' });
  assert.match(report.errors.join('\n'), /does not exist: docs\/gone\.png/);
});

test('a screenshot path with a non-image extension is an error', async () => {
  const report = await run({
    'docs/notes.txt': 'text',
    'screenshots.json': JSON.stringify(['docs/notes.txt'], null, 2) + '\n',
  });
  assert.match(report.errors.join('\n'), /not an image file/);
});

test('duplicate entries are warnings and become errors under strict', async () => {
  const files = {
    ...SHOT_A,
    'screenshots.json': JSON.stringify(['docs/a.png', 'docs/a.png'], null, 2) + '\n',
  };
  const lenient = await run(files);
  assert.deepEqual(lenient.errors, []);
  assert.match(lenient.warnings.join('\n'), /duplicate screenshot entry/);
  const strict = await run(files, { strict: true });
  assert.match(strict.errors.join('\n'), /duplicate screenshot entry/);
});

test('duplicate ids are warnings and become errors under strict', async () => {
  const files = {
    ...SHOT_A,
    'screenshots.json': JSON.stringify({
      version: 2,
      shots: [{ file: 'docs/a.png', id: 'same' }, { file: 'docs/a.png', id: 'same' }],
    }, null, 2) + '\n',
  };
  const lenient = await run(files);
  assert.match(lenient.warnings.join('\n'), /duplicate screenshot id/);
  const strict = await run(files, { strict: true });
  assert.match(strict.errors.join('\n'), /duplicate screenshot id/);
});

test('a referencedBy path that does not mention the file is an error', async () => {
  const report = await run({
    ...SHOT_A,
    'README.md': '# Test plugin\n\nNo screenshots here.\n',
    'screenshots.json': JSON.stringify({
      version: 2,
      shots: [{ file: 'docs/a.png', referencedBy: ['README.md'] }],
    }, null, 2) + '\n',
  });
  assert.match(report.errors.join('\n'), /is not referenced by README\.md/);
});

test('a README figure missing from the manifest is a warning, an error under strict', async () => {
  const files = {
    ...SHOT_A,
    'README.md': '# Test plugin\n\n![Extra](docs/extra.png)\n',
    'screenshots.json': JSON.stringify(['docs/a.png'], null, 2) + '\n',
  };
  const lenient = await run(files);
  assert.deepEqual(lenient.errors, []);
  assert.match(lenient.warnings.join('\n'), /docs\/extra\.png/);
  const strict = await run(files, { strict: true });
  assert.match(strict.errors.join('\n'), /docs\/extra\.png/);
});

test('a missing manifest is a warning and an error under strict', async () => {
  const lenient = await run({});
  assert.deepEqual(lenient.errors, []);
  assert.match(lenient.warnings.join('\n'), /screenshots\.json was not found/);
  const strict = await run({}, { strict: true });
  assert.match(strict.errors.join('\n'), /screenshots\.json was not found/);
});

test('a malformed manifest is an error', async () => {
  const report = await run({ 'screenshots.json': JSON.stringify({ shots: [] }, null, 2) + '\n' });
  assert.match(report.errors.join('\n'), /must be an array of image paths/);
});

test('screenshots.strict in configuration upgrades warnings without a flag', async () => {
  const manifest = {
    ...baseManifest(),
    dshPluginKit: { version: 1, screenshots: { strict: true } },
  };
  const report = await run({}, { manifest });
  assert.match(report.errors.join('\n'), /was not found/);
});

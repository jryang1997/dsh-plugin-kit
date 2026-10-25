import assert from 'node:assert/strict';
import test from 'node:test';
import { loadProject } from '../src/config.mjs';
import { checkSyntax, projectFiles, runTests } from '../src/runner.mjs';
import { baseManifest, makePlugin, textLines } from './helpers.mjs';

const PASSING_TEST = textLines([
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  '',
  "test('fixture passes', () => {",
  '  assert.equal(1 + 1, 2);',
  '});',
]);

const FAILING_TEST = textLines([
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  '',
  "test('fixture fails', () => {",
  '  assert.equal(1 + 1, 3);',
  '});',
]);

async function project(files, extraConfig = {}) {
  const manifest = {
    ...baseManifest(),
    dshPluginKit: { version: 1, ...extraConfig },
  };
  const root = await makePlugin({ files, manifest });
  return loadProject(root);
}

test('projectFiles discovers root modules and the four conventional directories', async () => {
  const loaded = await project({
    'main.js': 'export {};\n',
    'src/a.js': 'export {};\n',
    'src/nested/deep.mjs': 'export {};\n',
    'tests/foo.test.js': PASSING_TEST,
    'scripts/tool.mjs': 'export {};\n',
    'preview/page.js': 'export {};\n',
    '.cache/ignored.js': 'export {};\n',
    'node_modules/dep/index.js': 'export {};\n',
  });
  const files = await projectFiles(loaded);
  assert.ok(files.sources.includes('main.js'));
  assert.ok(files.sources.includes('src/a.js'));
  assert.ok(files.sources.includes('src/nested/deep.mjs'));
  assert.ok(files.sources.includes('scripts/tool.mjs'));
  assert.ok(files.sources.includes('preview/page.js'));
  assert.ok(!files.sources.some(file => file.includes('.cache')));
  assert.ok(!files.sources.some(file => file.includes('node_modules')));
  assert.deepEqual(files.tests, ['tests/foo.test.js']);
});

test('the syntax gate accepts valid sources', async () => {
  const loaded = await project({ 'index.js': 'export function apply() {}\n', 'src/a.mjs': 'export const a = 1;\n' });
  const { sources } = await projectFiles(loaded);
  const report = checkSyntax({ root: loaded.root, sources });
  assert.deepEqual(report.errors, []);
  assert.ok(report.stats.files >= 3);
});

test('the syntax gate reports the failing file', async () => {
  const loaded = await project({ 'src/broken.js': 'export function (\n' });
  const { sources } = await projectFiles(loaded);
  const report = checkSyntax({ root: loaded.root, sources });
  assert.match(report.errors.join('\n'), /src\/broken\.js/);
});

test('runTests passes when discovered tests pass', async () => {
  const loaded = await project({ 'tests/foo.test.js': PASSING_TEST });
  const result = await runTests(loaded);
  assert.equal(result.ok, true, result.output);
  assert.equal(result.files.length, 1);
  assert.match(result.output, /pass 1/);
});

test('runTests fails when a discovered test fails', async () => {
  const loaded = await project({ 'tests/foo.test.js': FAILING_TEST });
  const result = await runTests(loaded);
  assert.equal(result.ok, false);
  assert.match(result.output, /fail 1/);
});

test('runTests refuses an empty suite', async () => {
  const loaded = await project({});
  const result = await runTests(loaded);
  assert.equal(result.ok, false);
  assert.match(result.output, /No test files matched/);
});

test('tests.include changes which files count as tests', async () => {
  const loaded = await project({
    'tests/a.test.js': PASSING_TEST,
    'tests/b.spec.js': PASSING_TEST,
  }, { tests: { include: ['*.spec.js'], runner: 'auto' } });
  const result = await runTests(loaded);
  assert.equal(result.ok, true, result.output);
  assert.deepEqual(result.files, ['tests/b.spec.js']);
});

test('the script runner executes plain assertion files', async () => {
  const script = textLines([
    "import assert from 'node:assert/strict';",
    '',
    'assert.equal(2 + 2, 4);',
  ]);
  const loaded = await project({ 'tests/plain.test.js': script }, { tests: { include: ['*.test.js'], runner: 'script' } });
  const result = await runTests(loaded);
  assert.equal(result.ok, true, result.output);
});

test('the script runner reports a failing plain script', async () => {
  const script = textLines([
    "import assert from 'node:assert/strict';",
    '',
    'assert.equal(2 + 2, 5);',
  ]);
  const loaded = await project({ 'tests/plain.test.js': script }, { tests: { include: ['*.test.js'], runner: 'script' } });
  const result = await runTests(loaded);
  assert.equal(result.ok, false);
});

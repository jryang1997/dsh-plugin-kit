import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLocale } from '../src/checks/locale.mjs';
import { loadProject } from '../src/config.mjs';
import { baseManifest, makePlugin } from './helpers.mjs';

function manifestWithLocale(required = ['en', 'zh'], extra = {}) {
  return {
    ...baseManifest(),
    dshPluginKit: { version: 1, locale: { required, metadata: ['title', 'description'] }, ...extra },
  };
}

function dictionary(title, description, ui = {}) {
  return JSON.stringify({ meta: { title, description }, ui }, null, 2) + '\n';
}

async function run(files, manifest = manifestWithLocale()) {
  const root = await makePlugin({ files, manifest });
  const project = await loadProject(root);
  return checkLocale({ root, config: project.config });
}

test('matching locale dictionaries pass', async () => {
  const report = await run({
    'locale/en.json': dictionary('Test plugin', 'A test plugin.', { title: 'Test plugin', save: 'Save {count} items' }),
    'locale/zh.json': dictionary('测试插件', '一个测试插件。', { title: '测试插件', save: '保存 {count} 项' }),
  });
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.languages, 2);
});

test('a missing required language file is an error', async () => {
  const report = await run({
    'locale/en.json': dictionary('Test plugin', 'A test plugin.'),
  });
  assert.match(report.errors.join('\n'), /locale\/zh\.json is missing or unreadable/);
});

test('a key present in one language and absent from the other is an error', async () => {
  const report = await run({
    'locale/en.json': dictionary('Test plugin', 'A test plugin.', { title: 'T', extra: 'Only here' }),
    'locale/zh.json': dictionary('测试插件', '一个测试插件。', { title: 'T' }),
  });
  assert.match(report.errors.join('\n'), /missing keys: ui\.extra/);
});

test('placeholder sets must match between languages', async () => {
  const report = await run({
    'locale/en.json': dictionary('Test plugin', 'A test plugin.', { count: 'Save {count} of {total}' }),
    'locale/zh.json': dictionary('测试插件', '一个测试插件。', { count: '保存 {count} 项' }),
  });
  assert.match(report.errors.join('\n'), /placeholders differ: missing total/);
});

test('English metadata must carry title and description', async () => {
  const report = await run({
    'locale/en.json': JSON.stringify({ meta: { title: 'Only title' } }, null, 2) + '\n',
    'locale/zh.json': JSON.stringify({ meta: { title: 'Only title' } }, null, 2) + '\n',
  });
  assert.match(report.errors.join('\n'), /meta\.description/);
});

test('a single configured language needs no parity checks', async () => {
  const report = await run(
    { 'locale/en.json': dictionary('Test plugin', 'A test plugin.') },
    manifestWithLocale(['en']),
  );
  assert.deepEqual(report.errors, []);
});

test('nested dictionaries are compared leaf by leaf', async () => {
  const en = { meta: { title: 'T', description: 'D' }, ui: { group: { a: 'A', b: 'B' } } };
  const zh = { meta: { title: 'T2', description: 'D2' }, ui: { group: { a: 'A2' } } };
  const report = await run({
    'locale/en.json': JSON.stringify(en, null, 2) + '\n',
    'locale/zh.json': JSON.stringify(zh, null, 2) + '\n',
  });
  assert.match(report.errors.join('\n'), /missing keys: ui\.group\.b/);
});

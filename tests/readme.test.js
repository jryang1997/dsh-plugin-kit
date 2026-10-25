import assert from 'node:assert/strict';
import test from 'node:test';
import { checkReadme } from '../src/checks/readme.mjs';
import { loadProject } from '../src/config.mjs';
import { baseManifest, makePlugin, textLines } from './helpers.mjs';

const EN_README = textLines([
  '# Test plugin',
  '',
  'English documentation.',
  '',
  '[中文](README.md)',
  '',
  '## Install',
  '',
  '![Overview](docs/overview.png)',
  '',
  '## Usage',
  '',
  'More text.',
]);

const ZH_README = textLines([
  '# 测试插件',
  '',
  '中文文档。',
  '',
  '[English](README.en.md)',
  '',
  '## 安装',
  '',
  '![概览](docs/overview.png)',
  '',
  '## 用法',
  '',
  '更多文字。',
]);

function manifestWithReadmes() {
  return {
    ...baseManifest(),
    dshPluginKit: { version: 1, readme: { files: ['README.md', 'README.en.md'] } },
  };
}

async function run(files, manifest = manifestWithReadmes()) {
  const root = await makePlugin({ files, manifest });
  const project = await loadProject(root);
  return checkReadme({ root, config: project.config });
}

test('matching README translations pass', async () => {
  const report = await run({ 'README.md': ZH_README, 'README.en.md': EN_README });
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.files, 2);
});

test('a heading-level count mismatch is an error', async () => {
  const broken = EN_README.replace('## Usage', '### Usage');
  const report = await run({ 'README.md': ZH_README, 'README.en.md': broken });
  assert.match(report.errors.join('\n'), /level-2 heading/);
});

test('a relative figure count mismatch is an error', async () => {
  const broken = ZH_README.replace('![概览](docs/overview.png)\n', '');
  const report = await run({ 'README.md': broken, 'README.en.md': EN_README });
  assert.match(report.errors.join('\n'), /relative figure reference/);
});

test('each translation must link to the other by filename', async () => {
  const broken = EN_README.replace('[中文](README.md)', '中文');
  const report = await run({ 'README.md': ZH_README, 'README.en.md': broken });
  assert.match(report.errors.join('\n'), /README\.en\.md must link to README\.md/);
});

test('a missing configured README is an error', async () => {
  const report = await run({ 'README.md': ZH_README });
  assert.match(report.errors.join('\n'), /README\.en\.md/);
});

test('headings inside fenced code blocks are not counted', async () => {
  const fence = String.fromCharCode(96).repeat(3);
  const en = textLines([
    '# Test plugin',
    '',
    '[中文](README.md)',
    '',
    fence + 'md',
    '## not a heading',
    fence,
    '',
    '## Usage',
    '',
    '![Overview](docs/overview.png)',
  ]);
  const zh = textLines([
    '# 测试插件',
    '',
    '[English](README.en.md)',
    '',
    fence + 'md',
    '## 不是标题',
    fence,
    '',
    '## 用法',
    '',
    '![概览](docs/overview.png)',
  ]);
  const report = await run({ 'README.md': zh, 'README.en.md': en });
  assert.deepEqual(report.errors, []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPack, runNpmPack } from '../src/checks/pack.mjs';
import { loadProject } from '../src/config.mjs';
import { baseManifest, makePlugin } from './helpers.mjs';

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"></svg>\n';

function manifestWith(files, extra = {}) {
  return { ...baseManifest(), files, ...extra };
}

async function run(files, manifest) {
  const root = await makePlugin({ files, manifest });
  const project = await loadProject(root);
  return { report: await checkPack({ root, manifest: project.manifest, config: project.config }), root };
}

test('a clean plugin package passes the pack check', async () => {
  const { report } = await run(
    {
      'docs/overview.png': 'png',
      'README.md': '# Test plugin\n\n![Overview](docs/overview.png)\n',
    },
    manifestWith(['index.js', 'client.js', 'cordis.patch.yml', 'locale/', 'icon.svg', 'README.md', 'docs/']),
  );
  assert.deepEqual(report.errors, []);
  assert.ok(report.stats.files >= 6);
});

test('npm pack paths are normalised to forward slashes', async () => {
  const root = await makePlugin();
  const files = runNpmPack(root);
  assert.ok(files.length > 0);
  for (const file of files) assert.ok(!file.path.includes('\\'), 'packed path contains a backslash: ' + file.path);
});

test('a files entry that npm pack did not include is an error', async () => {
  const { report } = await run(
    { 'gone.js': 'export {};\n' },
    manifestWith(['index.js', 'client.js', 'cordis.patch.yml', 'locale/', 'icon.svg', 'README.md', 'not-there.js']),
  );
  assert.match(report.errors.join('\n'), /files lists not-there\.js but npm pack did not include it/);
});

test('a README figure that is not shipped is an error', async () => {
  const { report } = await run({
    'README.md': '# Test plugin\n\n![Missing](docs/missing.png)\n',
  }, manifestWith(['index.js', 'client.js', 'cordis.patch.yml', 'locale/', 'icon.svg', 'README.md']));
  assert.match(report.errors.join('\n'), /references docs\/missing\.png, which the package does not ship/);
});

test('a leaked development directory is an error', async () => {
  const { report } = await run(
    { 'tests/manifest.test.js': '// test\n' },
    manifestWith(['index.js', 'client.js', 'cordis.patch.yml', 'locale/', 'icon.svg', 'README.md', 'tests/']),
  );
  assert.match(report.errors.join('\n'), /development path tests\/ leaked into the tarball/);
});

test('a required package path that is absent is an error', async () => {
  const manifest = manifestWith(['index.js', 'client.js', 'cordis.patch.yml', 'locale/', 'icon.svg', 'README.md'], {
    dshPluginKit: { version: 1, pack: { require: ['docs/missing.png'] } },
  });
  const { report } = await run({}, manifest);
  assert.match(report.errors.join('\n'), /required package path docs\/missing\.png is not in the tarball/);
});

test('an icon over the configured budget is an error', async () => {
  const manifest = manifestWith(['index.js', 'client.js', 'cordis.patch.yml', 'locale/', 'icon.svg', 'README.md'], {
    dshPluginKit: { version: 1, icon: { declaration: 'field', budgetBytes: 32 } },
  });
  const { report } = await run({}, manifest);
  assert.match(report.errors.join('\n'), /bytes; the budget is 32 bytes/);
});

test('an icon that is not an image format is an error', async () => {
  const { report } = await run({ 'icon.svg': 'this is not an image\n' });
  assert.match(report.errors.join('\n'), /is not SVG, PNG, JPEG or WebP content/);
});

test('an icon declared but absent from the tarball is an error', async () => {
  const { report } = await run({}, manifestWith(['index.js', 'client.js', 'cordis.patch.yml', 'locale/', 'README.md']));
  assert.match(report.errors.join('\n'), /icon icon\.svg is not in the tarball/);
});

test('a package without an icon only warns', async () => {
  const manifest = baseManifest();
  delete manifest.icon;
  const { report } = await run({}, manifest);
  assert.deepEqual(report.errors, []);
  assert.match(report.warnings.join('\n'), /no package icon declared/);
});

test('manifest files entries with Windows separators still match the tarball', async () => {
  const manifest = manifestWith(['index.js', 'client.js', 'cordis.patch.yml', 'locale\\en.json', 'icon.svg', 'README.md']);
  manifest.icon = './icon.svg';
  // locale/ is also listed so the directory itself is packed.
  manifest.files.push('locale/');
  const { report } = await run({}, manifest);
  assert.deepEqual(report.errors, []);
});

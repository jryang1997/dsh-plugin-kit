import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { KIT_ROOT } from './helpers.mjs';

const manifest = JSON.parse(await readFile(join(KIT_ROOT, 'package.json'), 'utf8'));

test('the kit package is ESM with a bin and no runtime dependencies', () => {
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.bin['dsh-plugin-kit'], './bin/dsh-plugin-kit.mjs');
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies, undefined);
  assert.match(manifest.engines.node, /\b20\.19\b/);
});

test('the kit defines no install-time scripts', () => {
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.equal(manifest.scripts?.[hook], undefined, hook + ' must not run on install');
  }
});

test('the published files whitelist is only bin, src and README', () => {
  assert.deepEqual(manifest.files, ['bin/', 'src/', 'README.md']);
});

test('every exported subpath resolves to an existing source file', async () => {
  for (const [specifier, target] of Object.entries(manifest.exports)) {
    assert.equal(typeof target, 'string', 'export ' + specifier + ' must map to one file');
    if (specifier === './package.json') continue; // data export, not a module
    const module = await import(new URL('../' + target, import.meta.url));
    assert.ok(Object.keys(module).length > 0, 'export ' + specifier + ' has no named exports');
  }
});

test('each documented export group exposes its promised functions', async () => {
  const groups = {
    config: ['loadProject', 'validateConfig'],
    checks: ['checkManifest', 'checkPack', 'checkLocale', 'checkReadme', 'checkScreenshots'],
    runner: ['projectFiles', 'checkSyntax', 'runTests'],
    artifacts: ['writeArtifact', 'runArtifacts'],
    review: ['reviewSnapshot'],
    probe: ['readProbe'],
    scaffold: ['initProject'],
  };
  for (const [group, names] of Object.entries(groups)) {
    const module = await import('@jryang1997/dsh-plugin-kit/' + group).catch(async () => {
      return import(new URL('../src/' + group + (group === 'checks' ? '/index' : '') + '.mjs', import.meta.url));
    });
    for (const name of names) assert.equal(typeof module[name], 'function', group + '.' + name);
  }
});

# dsh-plugin-kit

Zero-dependency verification and scaffolding for DeepSeek Harness plugins.

Local MVP of `@jryang1997/dsh-plugin-kit` 1.0.0. The package is ESM, has no runtime
dependencies, runs no install scripts, and requires Node 20.19 or newer. It ships only
`bin/`
, 
`src/`
 and this README (plus the license npm always includes).

## What it does

- **Static checks** — the DSH manifest contract, locale dictionary parity, README
  translation parity, version sites, and `node --check` on every project source.
- **Real packaging gate** — asks `npm pack --dry-run` what would ship, then compares
  that against the `files` whitelist, README figures, forbidden dev paths, and the icon budget.
- **Test runner** — discovers `*.test.js` / `*.test.mjs` and runs them with `node --test`
  (or directly, with `tests.runner: "script"`), refusing an empty suite.
- **Artifact consistency** — producers run with `--check` during verify and may never
  rebuild; the `writeArtifact` helper makes that contract one call.
- **Review snapshot and read probe** — portable forms of the workflows the whale plugin
  already used: git change metadata with hashes, and path/readability/byte/SHA-256 checks
  that never print file content.
- **Scaffolding** — `init` writes a runnable plugin skeleton that passes `verify` immediately.

## Install

Add it as a development dependency, pinned to an exact version:

```json
{
  "devDependencies": {
    "@jryang1997/dsh-plugin-kit": "1.0.0"
  }
}
```

Wire the standard commands (names are the repository choice; these are the defaults
the scaffold uses):

```json
{
  "scripts": {
    "check": "dsh-plugin-kit check",
    "test": "dsh-plugin-kit test",
    "verify": "dsh-plugin-kit verify"
  }
}
```

## CLI

```text
dsh-plugin-kit check                      # manifest, locale, README, version sites, syntax
dsh-plugin-kit test                       # discover and run tests
dsh-plugin-kit verify                     # check -> artifacts --check -> pack -> screenshots -> test
dsh-plugin-kit pack                       # what npm publish would ship, against the policy
dsh-plugin-kit screenshots check [--strict]
dsh-plugin-kit artifacts [--check]        # run producers, or compare without rebuilding
dsh-plugin-kit review [--base <ref>]      # JSON review snapshot (default base: HEAD)
dsh-plugin-kit probe [--root <dir>] [--] <paths...>
dsh-plugin-kit init [--dir <dir>] [--matrix minimal|built] [--name <pkg>] --yes
```

Every command except `init` accepts `--root <dir>` (default: the current directory).
Exit codes: `0` success, `1` a check or test failed, `2` a usage or
configuration error. `verify` stops at the first failing stage.

## Configuration

Configuration lives in one `package.json` key, `dshPluginKit`. A package with no
such key still runs `check` and `test` with the defaults below; only the
packaging, locale, README and screenshot policies need entries to become stricter.

```json
{
  "dshPluginKit": {
    "version": 1,
    "dshRulesVersion": "installed-2026-10-23",
    "sources": { "mode": "json" },
    "tests": { "include": ["*.test.js", "*.test.mjs"], "runner": "auto" },
    "artifacts": [{ "file": "client.js", "produce": "scripts/build.mjs" }],
    "pack": {
      "forbid": ["tests/", "scripts/", "preview/", ".github/", ".node-version", "pnpm-workspace.yaml"],
      "require": ["locale/en.json"]
    },
    "icon": { "declaration": "auto", "budgetBytes": 262144 },
    "locale": { "required": ["en"], "metadata": ["title", "description"] },
    "readme": { "files": ["README.md"], "parity": ["headings", "figures"] },
    "screenshots": { "manifest": "screenshots.json", "strict": false },
    "versionSites": [],
    "review": { "generated": [] }
  }
}
```

Field notes:

- `version` must be `1`; a mismatch exits 2.
- `sources.mode` — v1 implements JSON locale dictionaries (`"json"`) only.
- `tests.runner` — `"auto"` runs `node --test`; `"script"` executes each file with
  plain `node` for repositories that assert with script-style tests.
- `artifacts` — each entry names a committed file and the producer that owns it.
  `verify` runs `node <produce> --check` and fails if the file is stale or the
  producer writes during check. `dsh-plugin-kit artifacts` (without `--check`) rebuilds.
- `icon.declaration` — `auto` uses the manifest `icon` path, then
  `exports["./icon"]`; `field` and `exports` force one channel.
  `budgetBytes` can only tighten the 256 KiB DSH budget.
- `versionSites` — `{ "file": "client.js", "pattern": "const VERSION = '([^']+)'" }`;
  group 1 is compared with `package.json` version (a leading `v` is accepted).
- `review.generated` — paths the review snapshot should flag as generated output.

## Checks in detail

**manifest** — `dsh.bundle.patch` is a string or string array and every file exists;
`dsh.client` has `platform: "web"`, array `inject`/`external` and boolean
`immediately` when present, and requires `exports["./client"]` pointing at an existing file;
`preinstall`, `install`, `postinstall` and `prepare` scripts are forbidden;
missing `exports["./package.json"]` and a missing `dsh.client` are warnings.

**pack** — normalises Windows separators, asserts every non-glob `files` entry is in the
tarball, every relative README figure ships, forbidden development prefixes are absent, and
the icon is a shipped SVG/PNG/JPEG/WebP within budget. npm runs with `--ignore-scripts`.

**locale** — each configured language file exists, all dictionaries flatten to the same
dotted key set, placeholder names (`{count}` / `{{count}}`) match per key, and English
carries `meta.title` and `meta.description`.

**readme** — each configured file exists; translations have the same heading count per
level (fenced code ignored) and the same number of relative figure references; each file
links to the other language variant by filename.

**screenshots** — accepts the legacy `["docs/a.png"]` array or
`{ "version": 2, "shots": [...] }`. Each file must exist and be an image; optional
`referencedBy` files must really mention it; duplicate and unlisted entries are
warnings that `--strict` (or `screenshots.strict`) upgrades to errors.

**version** and **syntax** — configured version sites must agree with the package
version; every root-level `*.js`/`*.mjs` and every module under `src/`,
`tests/`, `scripts/` and `preview/` passes `node --check`. Dot directories and
`node_modules` are skipped.

The DSH rules encoded above were read from an installed build (2026-10-23); bump
`dshRulesVersion` after re-checking them against a new DSH release.

## Library API

The package exposes subpath exports so repositories can build their own commands:

- `@jryang1997/dsh-plugin-kit` — everything below, re-exported.
- `/config` — `loadProject`, `loadOptionalProject`, `validateConfig`,
  `defaultConfig`, `UsageError`, `ConfigError`.
- `/checks` — `checkManifest`, `checkPack`, `checkLocale`,
  `checkReadme`, `checkScreenshots`, `checkVersionSites`.
- `/runner` — `projectFiles`, `checkSyntax`, `runTests`,
  `runStaticChecks`.
- `/artifacts` — `writeArtifact`, `runArtifacts`, `ArtifactStaleError`.
- `/review` — `reviewSnapshot`.
- `/probe` — `readProbe`.
- `/scaffold` — `initProject`, `scaffoldFiles`.

Producers should import the write helper instead of writing files directly:

```js
import { writeArtifact } from '@jryang1997/dsh-plugin-kit/artifacts';

await writeArtifact(new URL('../client.js', import.meta.url), bundle, { check: process.argv.includes('--check') });
```

## Adopting it in a plugin repository

1. Add the exact devDependency and the check/test/verify scripts; keep the shipped
   tarball free of `node_modules` (the `files` whitelist already does).
2. Add the `dshPluginKit` block. Spell out the policies your repository actually
   wants: `locale.required`, `readme.files`, `pack.require`, artifact producers,
   version sites, and whether screenshots are strict.
3. Keep behaviour tests in the repository and delete only duplicated metadata checks
   (manifest keys, pack leaks, README figures, locale parity, icon size).
4. If the repository generates committed files, convert each producer to honor
   `--check` via `writeArtifact` and list it under `artifacts`.
   `verify` will never rebuild stale output.
5. Run `dsh-plugin-kit verify` locally. Expect existing failures to surface: for the
   whale plugin the known one is that development directories are in `files` while
   README images are not, so the tarball policy has to be decided first.
6. Run `verify` on both Linux and Windows in CI with the Node version pinned by
   `.node-version`; keep `git diff --exit-code` after it to catch producers that write.
7. Optional: migrate `screenshots.json` to the version 2 schema when screenshots get a
   capture workflow; the legacy array keeps working.

## Notes and deviations

- The research plan named `ui capture|validate` (local Chrome screenshots) for v1.1; this
  MVP does not implement it. `review` and `probe` are included.
- `sources` configures the locale dictionary source only; project file discovery is
  fixed (root modules plus `src/`, `tests/`, `scripts/`, `preview/`) so every
  repository sees the same gate.
- The probe default path is `AGENTS.md` (the whale script also defaulted to a
  repository-specific `src/engine.js`).
- `review.generated` is configuration; the whale script hard-coded its two outputs.
- `init` defaults to `--matrix built`; `--matrix minimal` produces a build-free
  plugin. Both scaffold variants pass `check` and `verify` immediately.
- The `check` command runs the static checks plus the syntax gate. The research plan
  described it as the syntax gate alone; that would have left manifest/locale/README
  checks with no CLI entry point.

## Development

The kit has no dependencies. Run its own suite with:

```sh
node --test
```

Every check and every CLI path has a fixture test under `tests/`; the packaging tests
shell out to `npm pack --dry-run --json --ignore-scripts`, which is read-only and needs no
network. Tests never modify the packages they verify.

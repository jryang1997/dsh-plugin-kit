import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runArtifacts } from './artifacts.mjs';
import { checkPack } from './checks/pack.mjs';
import { checkScreenshots } from './checks/screenshots.mjs';
import {
  ConfigError,
  UsageError,
  loadOptionalProject,
  loadProject,
} from './config.mjs';
import { DEFAULT_PATHS, readProbe } from './probe.mjs';
import { printReport, printReports } from './report.mjs';
import { reviewSnapshot } from './review.mjs';
import { runStaticChecks, runTests } from './runner.mjs';
import { MATRICES, initProject } from './scaffold.mjs';

const kitManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const VERSION = kitManifest.version;

const USAGE = [
  'Usage: dsh-plugin-kit <command> [options]',
  '',
  'Commands:',
  '  check                     manifest, locale, README, version sites and syntax',
  '  test                      discover and run plugin tests',
  '  verify                    check, artifacts --check, pack, screenshots, test',
  '  pack                      verify what npm publish would ship',
  '  screenshots check [--strict]',
  '                            validate screenshots.json, its files and references',
  '  artifacts [--check]       run configured artifact producers; --check compares only',
  '  review [--base <ref>]     JSON review snapshot of commits, index and worktree',
  '  probe [--root <dir>] [--] <paths...>',
  '                            report path, readability, bytes and SHA256; never content',
  '  init [--dir <dir>] [--matrix minimal|built] [--name <pkg>] --yes',
  '                            scaffold a runnable DSH plugin skeleton',
  '  help                      show this help',
  '  --version                 print the kit version',
  '',
  'Options:',
  '  --root <dir>              project root (default: current directory)',
  '  --strict                  upgrade screenshot warnings to errors',
  '',
  'Exit codes: 0 success, 1 a check or test failed, 2 usage or configuration error.',
].join('\n');

function out(text = '') {
  process.stdout.write(text + '\n');
}

function err(text = '') {
  process.stderr.write(text + '\n');
}

function parseFlags(args, spec = {}) {
  const values = spec.values ?? [];
  const booleans = spec.booleans ?? [];
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      parsed._.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
      if (booleans.includes(name)) {
        parsed[name] = true;
        continue;
      }
      if (values.includes(name)) {
        const value = equals === -1 ? args[++index] : arg.slice(equals + 1);
        if (value === undefined || value === '') throw new UsageError('--' + name + ' requires a non-empty value.');
        parsed[name] = value;
        continue;
      }
      throw new UsageError('unknown option: ' + arg + '\n\n' + USAGE);
    }
    if (arg.startsWith('-') && arg !== '-') throw new UsageError('unknown option: ' + arg + '\n\n' + USAGE);
    parsed._.push(arg);
  }
  return parsed;
}

function projectRoot(flags) {
  return flags.root === undefined ? process.cwd() : resolve(flags.root);
}

function printProjectWarnings(project) {
  for (const warning of project.warnings) out('warn: ' + warning);
}

async function commandCheck(args) {
  const flags = parseFlags(args, { values: ['root'] });
  if (flags._.length > 0) throw new UsageError('check takes no positional arguments. ' + USAGE);
  const project = await loadProject(projectRoot(flags));
  printProjectWarnings(project);
  const reports = await runStaticChecks(project);
  const totals = printReports(reports);
  out('check: ' + totals.reports + ' checks, ' + totals.errors + ' errors, ' + totals.warnings + ' warnings');
  return totals.errors === 0 ? 0 : 1;
}

async function commandTest(args) {
  const flags = parseFlags(args, { values: ['root'] });
  if (flags._.length > 0) throw new UsageError('test takes no positional arguments. ' + USAGE);
  const project = await loadProject(projectRoot(flags));
  printProjectWarnings(project);
  const result = await runTests(project);
  if (result.output.trim() !== '') out(result.output.trimEnd());
  if (!result.ok) {
    err('test: failed (' + result.files.length + ' test files discovered)');
    return 1;
  }
  out('test: ok (' + result.files.length + ' test files)');
  return 0;
}

async function commandVerify(args) {
  const flags = parseFlags(args, { values: ['root'] });
  if (flags._.length > 0) throw new UsageError('verify takes no positional arguments. ' + USAGE);
  const project = await loadProject(projectRoot(flags));
  printProjectWarnings(project);

  const staticReports = await runStaticChecks(project);
  printReports(staticReports);
  if (staticReports.some(report => report.errors.length > 0)) {
    err('verify: failed at check');
    return 1;
  }
  out('verify: check ok');

  const artifactsReport = await runArtifacts({ root: project.root, config: project.config, check: true });
  printReport(artifactsReport);
  if (artifactsReport.errors.length > 0) {
    err('verify: failed at artifacts (nothing was rebuilt)');
    return 1;
  }
  out('verify: artifacts ok');

  const packReport = await checkPack(project);
  printReport(packReport);
  if (packReport.errors.length > 0) {
    err('verify: failed at pack');
    return 1;
  }
  out('verify: pack ok');

  const screenshotsReport = await checkScreenshots({ root: project.root, config: project.config });
  printReport(screenshotsReport);
  if (screenshotsReport.errors.length > 0) {
    err('verify: failed at screenshots');
    return 1;
  }
  out('verify: screenshots ok');

  const tests = await runTests(project);
  if (tests.output.trim() !== '') out(tests.output.trimEnd());
  if (!tests.ok) {
    err('verify: failed at test');
    return 1;
  }
  out('verify: ok (' + tests.files.length + ' test files)');
  return 0;
}

async function commandPack(args) {
  const flags = parseFlags(args, { values: ['root'] });
  if (flags._.length > 0) throw new UsageError('pack takes no positional arguments. ' + USAGE);
  const project = await loadProject(projectRoot(flags));
  printProjectWarnings(project);
  const report = await checkPack(project);
  printReport(report);
  if (report.errors.length > 0) return 1;
  out('pack: ok (' + report.stats.files + ' files in the tarball)');
  return 0;
}

async function commandScreenshots(args) {
  const flags = parseFlags(args, { values: ['root'], booleans: ['strict'] });
  const subcommand = flags._[0];
  if (subcommand !== 'check' || flags._.length !== 1) {
    throw new UsageError('usage: dsh-plugin-kit screenshots check [--strict] [--root <dir>]');
  }
  const project = await loadProject(projectRoot(flags));
  printProjectWarnings(project);
  const report = await checkScreenshots({ root: project.root, config: project.config, strict: flags.strict === true });
  printReport(report);
  if (report.errors.length > 0) return 1;
  out('screenshots: ok (' + (report.stats.shots ?? 0) + ' shots)');
  return 0;
}

async function commandArtifacts(args) {
  const flags = parseFlags(args, { values: ['root'], booleans: ['check'] });
  if (flags._.length > 0) throw new UsageError('artifacts takes no positional arguments. ' + USAGE);
  const project = await loadProject(projectRoot(flags));
  printProjectWarnings(project);
  const checking = flags.check === true;
  const report = await runArtifacts({ root: project.root, config: project.config, check: checking });
  printReport(report);
  if (report.errors.length > 0) return 1;
  out('artifacts: ok (' + report.stats.producers + ' producers ' + (checking ? 'checked' : 'run') + ')');
  return 0;
}

async function commandReview(args) {
  const flags = parseFlags(args, { values: ['root', 'base'] });
  if (flags._.length > 0) throw new UsageError('review takes no positional arguments. ' + USAGE);
  const project = await loadOptionalProject(projectRoot(flags));
  printProjectWarnings(project);
  const snapshot = await reviewSnapshot({
    root: project.root,
    base: flags.base ?? 'HEAD',
    generated: project.config.review.generated,
  });
  out(JSON.stringify(snapshot, null, 2));
  return 0;
}

async function commandProbe(args) {
  const flags = parseFlags(args, { values: ['root'] });
  const rootArgument = projectRoot(flags);
  const paths = flags._.length > 0 ? flags._ : DEFAULT_PATHS;
  const report = await readProbe({ root: rootArgument, paths });
  out(JSON.stringify(report, null, 2));
  if (report.files.some(file => !file.readable)) {
    err('Read probe failed for one or more requested files; inspect the JSON error codes.');
    return 1;
  }
  return 0;
}

async function confirmInit(target, matrix) {
  if (!process.stdin.isTTY) {
    throw new UsageError('init needs --yes when no terminal is attached; scaffold generation never guesses.');
  }
  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question('Create a DSH plugin skeleton in ' + target + ' (matrix ' + matrix + ')? [y/N] ');
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

async function commandInit(args) {
  const flags = parseFlags(args, { values: ['dir', 'matrix', 'name'], booleans: ['yes'] });
  if (flags._.length > 0) throw new UsageError('init takes no positional arguments; use --dir <dir>. ' + USAGE);
  const matrix = flags.matrix ?? 'built';
  if (!MATRICES.includes(matrix)) throw new UsageError('--matrix must be one of: ' + MATRICES.join(', ') + '.');
  const target = resolve(flags.dir ?? '.');
  if (flags.yes !== true) {
    const confirmed = await confirmInit(target, matrix);
    if (!confirmed) {
      out('init: cancelled');
      return 0;
    }
  }
  const result = await initProject({ dir: target, matrix, name: flags.name });
  out('init: scaffolded ' + result.files.length + ' files in ' + result.dir + ' (matrix ' + result.matrix + ', package ' + result.packageName + ')');
  for (const file of result.files) out('  ' + file);
  out('');
  out('Next: cd ' + result.dir + ' && npm install && npm run verify');
  return 0;
}

export async function runCli(argv = []) {
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
      out(USAGE);
      return 0;
    }
    if (command === '--version' || command === '-v') {
      out(VERSION);
      return 0;
    }
    if (rest.includes('--help') || rest.includes('-h')) {
      out(USAGE);
      return 0;
    }
    switch (command) {
      case 'check':
        return await commandCheck(rest);
      case 'test':
        return await commandTest(rest);
      case 'verify':
        return await commandVerify(rest);
      case 'pack':
        return await commandPack(rest);
      case 'screenshots':
        return await commandScreenshots(rest);
      case 'artifacts':
        return await commandArtifacts(rest);
      case 'review':
        return await commandReview(rest);
      case 'probe':
        return await commandProbe(rest);
      case 'init':
        return await commandInit(rest);
      default:
        throw new UsageError('unknown command: ' + command + '\n\n' + USAGE);
    }
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError) {
      err('error: ' + error.message);
      return 2;
    }
    err('error: ' + (error && error.message ? error.message : String(error)));
    return 1;
  }
}

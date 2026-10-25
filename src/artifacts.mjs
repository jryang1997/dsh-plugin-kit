import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createReport, reportError } from './report.mjs';
import { pathExists, resolveInside, tail } from './util.mjs';

/** Thrown by writeArtifact when --check finds committed output that differs. */
export class ArtifactStaleError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ArtifactStaleError';
    this.file = options.file;
  }
}

/**
 * Write a generated artifact, or compare it without touching it.
 *
 * Producers call this instead of fs.writeFile so a stale commit fails verify and a
 * check run can never rebuild. Returns { changed, written, bytes }.
 */
export async function writeArtifact(target, content, options = {}) {
  const check = options.check === true;
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  let previous = null;
  try {
    previous = await readFile(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const changed = previous === null || !previous.equals(data);
  if (check) {
    if (changed) {
      const label = options.label ? ' ' + options.label : '';
      throw new ArtifactStaleError('generated artifact is out of date' + label + '; rebuild it instead of committing stale output.', { file: target });
    }
    return { changed: false, written: false, bytes: data.length };
  }
  if (changed) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  return { changed, written: changed, bytes: data.length };
}

async function statOrNull(target) {
  try {
    return await stat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function runProducer(root, args) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Run every configured artifact producer. With check=true each producer runs with
 * --check and must not modify its output file; without it, producers rebuild.
 */
export async function runArtifacts({ root, config, check = false }) {
  const report = createReport('artifacts');
  for (const entry of config.artifacts) {
    let producer;
    let artifact;
    try {
      producer = resolveInside(root, entry.produce);
      artifact = resolveInside(root, entry.file);
    } catch (error) {
      reportError(report, 'artifact ' + entry.file + ': ' + error.message);
      continue;
    }
    if (!(await pathExists(producer))) {
      reportError(report, 'artifact ' + entry.file + ' producer does not exist: ' + entry.produce);
      continue;
    }
    const before = check ? await statOrNull(artifact) : null;
    const args = [entry.produce];
    if (check) args.push('--check');
    const result = runProducer(root, args);
    if (result.error) {
      reportError(report, 'artifact ' + entry.file + ': could not run ' + entry.produce + ': ' + result.error.message);
      continue;
    }
    if (result.status !== 0) {
      reportError(report, 'artifact ' + entry.file + ' is stale or its producer failed: node ' + args.join(' ') + '. ' + tail(result.stderr || result.stdout, 600));
      continue;
    }
    const after = await statOrNull(artifact);
    if (after === null) {
      reportError(report, 'producer ' + entry.produce + ' did not create ' + entry.file + '.');
      continue;
    }
    if (check && before !== null && after.mtimeMs !== before.mtimeMs) {
      reportError(report, 'producer ' + entry.produce + ' modified ' + entry.file + ' during --check; check mode must not rebuild.');
    }
  }
  report.stats = { producers: config.artifacts.length };
  return report;
}

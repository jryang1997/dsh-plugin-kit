import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createReport, reportError, reportWarning } from '../report.mjs';
import {
  isImagePath,
  normalizeRel,
  readText,
  relativeImageRefs,
  resolveInside,
} from '../util.mjs';

async function fileExists(target) {
  try {
    const info = await stat(target);
    return info.isFile();
  } catch {
    return false;
  }
}

/** Parse the screenshot manifest in its legacy array form or the version 2 form. */
export async function loadScreenshotManifest({ root, config }) {
  const manifestPath = resolveInside(root, config.screenshots.manifest);
  if (!(await fileExists(manifestPath))) return null;
  let data;
  try {
    data = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(config.screenshots.manifest + ' is not valid JSON: ' + error.message);
  }
  let shots;
  if (Array.isArray(data)) {
    shots = data;
  } else if (data !== null && typeof data === 'object' && data.version === 2 && Array.isArray(data.shots)) {
    shots = data.shots;
  } else {
    throw new Error(config.screenshots.manifest + ' must be an array of image paths or { "version": 2, "shots": [...] }.');
  }
  const normalized = [];
  for (const [index, shot] of shots.entries()) {
    if (typeof shot === 'string') {
      normalized.push({ file: normalizeRel(shot), referencedBy: [] });
      continue;
    }
    if (shot === null || typeof shot !== 'object' || Array.isArray(shot)) {
      throw new Error(config.screenshots.manifest + ' shots[' + index + '] must be a path string or an object.');
    }
    if (typeof shot.file !== 'string' || shot.file.trim() === '') {
      throw new Error(config.screenshots.manifest + ' shots[' + index + '] must declare a file path.');
    }
    const referencedBy = shot.referencedBy ?? [];
    if (!Array.isArray(referencedBy) || referencedBy.some(item => typeof item !== 'string' || item.trim() === '')) {
      throw new Error(config.screenshots.manifest + ' shots[' + index + '].referencedBy must be an array of repository paths.');
    }
    normalized.push({ ...shot, file: normalizeRel(shot.file), referencedBy });
  }
  return normalized;
}

/**
 * Screenshot gate: manifest shape, file existence, image extensions, references that
 * really mention the image, duplicate and unlisted entries. Warnings become errors
 * with --strict or dshPluginKit.screenshots.strict.
 */
export async function checkScreenshots({ root, config, strict = false }) {
  const report = createReport('screenshots');
  const strictMode = strict === true || config.screenshots.strict === true;
  const warnOrError = message => (strictMode ? reportError(report, message) : reportWarning(report, message));

  let shots;
  try {
    shots = await loadScreenshotManifest({ root, config });
  } catch (error) {
    reportError(report, error.message);
    return report;
  }
  if (shots === null) {
    warnOrError('screenshot manifest ' + config.screenshots.manifest + ' was not found.');
    return report;
  }

  const fileCounts = new Map();
  const idCounts = new Map();
  for (const shot of shots) {
    fileCounts.set(shot.file, (fileCounts.get(shot.file) ?? 0) + 1);
    if (typeof shot.id === 'string' && shot.id.trim() !== '') {
      idCounts.set(shot.id, (idCounts.get(shot.id) ?? 0) + 1);
    }
    if (!isImagePath(shot.file)) {
      reportError(report, 'screenshot entry is not an image file (svg/png/jpeg/webp/gif): ' + shot.file);
    }
    try {
      if (!(await fileExists(resolveInside(root, shot.file)))) {
        reportError(report, 'screenshot file does not exist: ' + shot.file);
      }
    } catch (error) {
      reportError(report, 'screenshot ' + shot.file + ': ' + error.message);
    }
    for (const reference of shot.referencedBy) {
      let content;
      try {
        content = await readText(resolveInside(root, reference));
      } catch (error) {
        reportError(report, 'screenshot ' + shot.file + ' referencedBy ' + reference + ' cannot be read: ' + error.message);
        continue;
      }
      if (!content.includes(shot.file) && !content.includes(basename(shot.file))) {
        reportError(report, 'screenshot ' + shot.file + ' is not referenced by ' + reference + '.');
      }
    }
  }

  for (const [file, count] of fileCounts) {
    if (count > 1) warnOrError('duplicate screenshot entry: ' + file + ' appears ' + count + ' times.');
  }
  for (const [id, count] of idCounts) {
    if (count > 1) warnOrError('duplicate screenshot id: ' + id + ' appears ' + count + ' times.');
  }

  const listed = new Set(shots.map(shot => shot.file));
  for (const readmeFile of config.readme.files) {
    let markdown;
    try {
      markdown = await readText(join(root, readmeFile));
    } catch {
      continue; // the readme check reports missing files.
    }
    for (const reference of relativeImageRefs(markdown)) {
      if (!listed.has(reference)) {
        warnOrError(readmeFile + ' references ' + reference + ', which is not listed in ' + config.screenshots.manifest + '.');
      }
    }
  }

  report.stats = { shots: shots.length };
  return report;
}

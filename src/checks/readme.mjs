import { join } from 'node:path';
import { createReport, reportError } from '../report.mjs';
import { headingCounts, readText, relativeImageRefs } from '../util.mjs';

/**
 * README gate: each configured file exists, translations have the same heading shape
 * and figure count, and each file links to the other language's filename.
 */
export async function checkReadme({ root, config }) {
  const report = createReport('readme');
  const documents = new Map();

  for (const file of config.readme.files) {
    try {
      documents.set(file, await readText(join(root, file)));
    } catch {
      reportError(report, 'README file does not exist or is unreadable: ' + file);
    }
  }

  const entries = [...documents.entries()];
  if (entries.length >= 2) {
    const [baselineFile, baselineText] = entries[0];
    const baselineHeadings = headingCounts(baselineText);
    const baselineFigures = relativeImageRefs(baselineText).length;
    for (const [file, text] of entries.slice(1)) {
      if (config.readme.parity.includes('headings')) {
        const otherHeadings = headingCounts(text);
        for (let level = 1; level <= 6; level += 1) {
          if (baselineHeadings[level] !== otherHeadings[level]) {
            reportError(report, file + ' has ' + otherHeadings[level] + ' level-' + level + ' heading(s); ' + baselineFile + ' has ' + baselineHeadings[level] + '.');
          }
        }
      }
      if (config.readme.parity.includes('figures')) {
        const figures = relativeImageRefs(text).length;
        if (figures !== baselineFigures) {
          reportError(report, file + ' has ' + figures + ' relative figure reference(s); ' + baselineFile + ' has ' + baselineFigures + '.');
        }
      }
    }
    for (const [file] of entries) {
      const others = entries.map(([other]) => other).filter(other => other !== file);
      for (const other of others) {
        if (!documents.get(file).includes(other)) {
          reportError(report, file + ' must link to ' + other + ' by filename so readers can switch language.');
        }
      }
    }
  }

  report.stats = { files: documents.size };
  return report;
}

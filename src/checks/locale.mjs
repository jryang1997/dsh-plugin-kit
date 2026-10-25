import { createReport, reportError } from '../report.mjs';
import { flattenLeaves, placeholdersOf, readJson, joinLocalePath } from '../util.mjs';

function samples(values, limit = 5) {
  const list = [...values];
  if (list.length <= limit) return list.join(', ');
  return list.slice(0, limit).join(', ') + ' and ' + (list.length - limit) + ' more';
}

/** Recursively compare placeholder names per key between two dictionaries. */
function comparePlaceholders(baseline, other, label, report) {
  const keys = new Set([...baseline.keys(), ...other.keys()]);
  for (const key of keys) {
    if (!baseline.has(key) || !other.has(key)) continue; // key parity reports these
    const left = placeholdersOf(baseline.get(key));
    const right = placeholdersOf(other.get(key));
    const missing = [...left].filter(name => !right.has(name));
    const extra = [...right].filter(name => !left.has(name));
    if (missing.length > 0 || extra.length > 0) {
      const parts = [];
      if (missing.length > 0) parts.push('missing ' + samples(missing));
      if (extra.length > 0) parts.push('unexpected ' + samples(extra));
      reportError(report, label + ' key "' + key + '" placeholders differ: ' + parts.join('; '));
    }
  }
}

/**
 * Locale gate: every configured language file exists, the dictionaries expose the same
 * dotted key set, placeholders agree, and the English metadata names the plugin.
 */
export async function checkLocale({ root, config }) {
  const report = createReport('locale');
  const dictionaries = new Map();

  for (const language of config.locale.required) {
    const path = joinLocalePath(root, language);
    try {
      dictionaries.set(language, await readJson(path));
    } catch (error) {
      reportError(report, 'locale/' + language + '.json is missing or unreadable: ' + error.message);
    }
  }

  const entries = [...dictionaries.entries()];
  if (entries.length >= 2) {
    const [baselineLanguage, baselineDictionary] = entries[0];
    const baseline = flattenLeaves(baselineDictionary);
    for (const [language, dictionary] of entries.slice(1)) {
      const other = flattenLeaves(dictionary);
      const missing = [...baseline.keys()].filter(key => !other.has(key));
      const extra = [...other.keys()].filter(key => !baseline.has(key));
      if (missing.length > 0) reportError(report, 'locale/' + language + '.json is missing keys: ' + samples(missing));
      if (extra.length > 0) reportError(report, 'locale/' + language + '.json has keys not present in locale/' + baselineLanguage + '.json: ' + samples(extra));
      comparePlaceholders(baseline, other, 'locale/' + language + '.json', report);
    }
  }

  const english = dictionaries.get('en') ?? entries[0]?.[1];
  if (english !== undefined && english !== null && typeof english === 'object') {
    const meta = english.meta;
    for (const field of config.locale.metadata) {
      const value = meta && typeof meta === 'object' ? meta[field] : undefined;
      if (typeof value !== 'string' || value.trim() === '') {
        reportError(report, 'locale/en.json must declare meta.' + field + ' so DSH can name the plugin.');
      }
    }
  }

  report.stats = { languages: dictionaries.size };
  return report;
}

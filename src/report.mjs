/**
 * A check result: one named report with errors and warnings. Checks never throw for
 * expected repository problems; they record the problem so the CLI can print every
 * finding of a stage before deciding the exit code.
 */
export function createReport(name) {
  return { name, errors: [], warnings: [], stats: {} };
}

export function reportError(report, message) {
  report.errors.push(message);
}

export function reportWarning(report, message) {
  report.warnings.push(message);
}

export function isReportOk(report) {
  return report.errors.length === 0;
}

export function tallyReports(reports) {
  let errors = 0;
  let warnings = 0;
  for (const report of reports) {
    errors += report.errors.length;
    warnings += report.warnings.length;
  }
  return { reports: reports.length, errors, warnings };
}

export function reportsHaveErrors(reports) {
  return reports.some(report => report.errors.length > 0);
}

/** One report as printable lines: a status line followed by indented findings. */
export function formatReport(report) {
  const lines = [];
  const status = report.errors.length > 0 ? 'FAIL' : 'ok';
  lines.push('[' + status + '] ' + report.name + statusDetail(report));
  for (const message of report.errors) lines.push('  error: ' + message);
  for (const message of report.warnings) lines.push('  warn: ' + message);
  return lines;
}

function statusDetail(report) {
  const keys = Object.keys(report.stats ?? {});
  if (keys.length === 0) return '';
  const parts = keys.map(key => key + '=' + report.stats[key]);
  return ' (' + parts.join(', ') + ')';
}

export function printReports(reports, write) {
  const output = write ?? (text => process.stdout.write(text + '\n'));
  for (const report of reports) {
    for (const line of formatReport(report)) output(line);
  }
  return tallyReports(reports);
}

export function printReport(report, write) {
  return printReports([report], write);
}

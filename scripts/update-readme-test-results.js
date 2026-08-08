#!/usr/bin/env node
// Rewrites the block between the test-results markers in the README with a
// summary parsed from a Playwright JSON report.
//
// Usage: node scripts/update-readme-test-results.js <results.json> <README.md> [run-url]

const fs = require('fs');

const [resultsPath, readmePath, runUrl] = process.argv.slice(2);

if (!resultsPath || !readmePath) {
  console.error('Usage: update-readme-test-results.js <results.json> <README.md> [run-url]');
  process.exit(1);
}

const START = '<!-- test-results:start -->';
const END = '<!-- test-results:end -->';

function buildSummary() {
  if (!fs.existsSync(resultsPath)) {
    return '**❌ Test run failed** — no results were produced.';
  }

  const { stats } = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const passed = stats.expected + stats.flaky;
  const failed = stats.unexpected;
  const total = passed + failed + stats.skipped;
  const date = stats.startTime.slice(0, 10);
  const seconds = Math.round(stats.duration / 1000);

  const status = failed === 0 ? '✅' : '❌';
  const parts = [`**${status} ${passed} / ${total} tests passing**`];
  if (failed > 0) parts.push(`${failed} failing`);
  if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`);
  if (stats.flaky > 0) parts.push(`${stats.flaky} flaky`);

  let summary = `${parts.join(', ')} — dockerized Playwright run on ${date} in ${seconds}s`;
  if (runUrl) summary += ` ([latest run](${runUrl}))`;
  return summary;
}

const readme = fs.readFileSync(readmePath, 'utf8');
const startIdx = readme.indexOf(START);
const endIdx = readme.indexOf(END);

if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error(`Markers ${START} / ${END} not found in ${readmePath}`);
  process.exit(1);
}

const updated =
  readme.slice(0, startIdx + START.length) +
  '\n' +
  buildSummary() +
  '\n' +
  readme.slice(endIdx);

fs.writeFileSync(readmePath, updated);
console.log('README test results updated.');

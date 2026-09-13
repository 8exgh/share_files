const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
function command(cwd, name, args, extraEnv = {}) {
  return spawnSync(name, args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 15_000 });
}
function git(cwd, ...args) {
  const result = command(cwd, 'git', args);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-publish-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const author = path.join(root, 'author');
  const runner = path.join(root, 'runner');
  git(root, 'init', '--bare', '--initial-branch=main', origin);
  git(root, 'init', '--initial-branch=main', author);
  git(author, 'config', 'user.name', 'Test Author');
  git(author, 'config', 'user.email', 'test@example.invalid');
  fs.mkdirSync(path.join(author, 'scripts'));
  for (const name of ['publish-readme-test-results.sh', 'update-readme-test-results.js']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(author, 'scripts', name));
  }
  const readme = '# App\n\n<!-- test-results:start -->\nOld results.\n<!-- test-results:end -->\n\nKeep this documentation.\n';
  fs.writeFileSync(path.join(author, 'README.md'), readme);
  git(author, 'add', '.'); git(author, 'commit', '-m', 'Initial application');
  git(author, 'remote', 'add', 'origin', origin); git(author, 'push', '-u', 'origin', 'main');
  git(root, 'clone', origin, runner);
  const testedSha = git(runner, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(runner, 'results.json'), JSON.stringify({ stats: { expected: 26, flaky: 0, unexpected: 0, skipped: 0, startTime: '2026-09-13T00:00:00Z', duration: 14000 } }));
  const publish = extraEnv => command(runner, 'bash', ['scripts/publish-readme-test-results.sh', testedSha, 'results.json', 'https://example.invalid/actions/runs/123'], extraEnv);
  const advance = () => {
    fs.appendFileSync(path.join(author, 'README.md'), '\nNewer documentation from the author.\n');
    git(author, 'add', 'README.md'); git(author, 'commit', '-m', 'A newer application commit');
    return git(author, 'rev-parse', 'HEAD');
  };
  return { origin, author, runner, testedSha, readme, publish, advance };
}

test('current runs publish only the README summary and preserve other documentation', t => {
  const f = fixture(t);
  const result = f.publish();
  assert.equal(result.status, 0, result.stderr);
  const readme = git(f.origin, 'show', 'main:README.md');
  assert.match(readme, /26 \/ 26 tests passing/);
  assert.match(readme, /Keep this documentation/);
  assert.match(readme, /actions\/runs\/123/);
  assert.equal(git(f.origin, 'diff', '--name-only', f.testedSha, 'main'), 'README.md');
  assert.match(git(f.origin, 'log', '-1', '--format=%s'), /\[skip ci\]/);
});

test('a run for an older commit skips publishing without changing main', t => {
  const f = fixture(t);
  const newer = f.advance(); git(f.author, 'push', 'origin', 'main');
  const result = f.publish();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skipping the outdated README update/);
  assert.equal(git(f.origin, 'rev-parse', 'main'), newer);
  assert.equal(git(f.runner, 'rev-parse', 'HEAD'), f.testedSha);
  assert.equal(fs.readFileSync(path.join(f.runner, 'README.md'), 'utf8'), f.readme);
});

test('a competing push after the initial check skips safely without overwriting it', t => {
  const f = fixture(t);
  const newer = f.advance();
  fs.writeFileSync(path.join(f.runner, '.git/hooks/pre-push'), '#!/usr/bin/env bash\nset -eu\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX\ngit -C "$RACE_CHECKOUT" push origin HEAD:refs/heads/main\n', { mode: 0o755 });
  const result = f.publish({ RACE_CHECKOUT: f.author });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /main advanced while publishing/);
  assert.equal(git(f.origin, 'rev-parse', 'main'), newer);
  assert.match(git(f.origin, 'show', 'main:README.md'), /Newer documentation from the author/);
  assert.match(git(f.origin, 'show', 'main:README.md'), /Old results/);
});

test('a push failure with unchanged main still fails instead of hiding the error', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.origin, 'hooks/pre-receive'), '#!/bin/sh\necho "Push denied for this test" >&2\nexit 1\n', { mode: 0o755 });
  const result = f.publish();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Push denied for this test/);
  assert.match(result.stderr, /main was unchanged/);
  assert.equal(git(f.origin, 'rev-parse', 'main'), f.testedSha);
});

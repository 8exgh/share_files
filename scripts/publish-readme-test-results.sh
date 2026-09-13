#!/usr/bin/env bash
# Publish only when main still points at the revision that produced this report.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo 'Usage: publish-readme-test-results.sh <tested-sha> <results.json> <run-url>' >&2
  exit 1
fi

tested_sha="$1"
results_path="$2"
run_url="$3"

if [[ "$(git rev-parse HEAD)" != "$tested_sha" ]]; then
  echo 'The checkout does not match the tested revision; refusing to publish results.' >&2
  exit 1
fi

git fetch --no-tags origin refs/heads/main
if [[ "$(git rev-parse FETCH_HEAD)" != "$tested_sha" ]]; then
  echo 'main has advanced since this run started; skipping the outdated README update.'
  exit 0
fi

node scripts/update-readme-test-results.js "$results_path" README.md "$run_url"
if git diff --quiet -- README.md; then
  echo 'README test results are already current.'
  exit 0
fi

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -- README.md
git commit -m 'docs: update README test results [skip ci]' --only -- README.md

if git push origin HEAD:refs/heads/main; then
  exit 0
fi

# Another push may land between the fetch above and our push. Leave its history
# intact and let the run for that newer revision publish its own results.
git fetch --no-tags origin refs/heads/main
if [[ "$(git rev-parse FETCH_HEAD)" != "$tested_sha" ]]; then
  echo 'main advanced while publishing; skipping the outdated README update.'
  exit 0
fi

echo 'README push failed while main was unchanged; check the push error above.' >&2
exit 1

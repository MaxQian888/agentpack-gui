#!/usr/bin/env bash
# Run one module's tests under a hard bound, for .github/workflows/rust.yml.
#
# Usage: ci-run-tests.sh <module>   (e.g. `exec`, `skills`, `history_cache`)
#
# Why a script rather than one inline `run:` block: the workflow calls this once
# per top-level module, as a *separate step*. That is not cosmetic. When a test
# takes the Linux runner down with it — "the hosted runner lost communication
# with the server" — GitHub archives no log for the job, so a single
# whole-suite step leaves nothing at all behind to name the culprit. Per-step
# conclusions are recorded server-side as each step ends and survive the death,
# so the last step that never completed *is* the answer.
set -uo pipefail

module="${1:?usage: ci-run-tests.sh <module>}"

# The bound is `timeout(1)`, not the step's own `timeout-minutes`: GitHub
# records anything *it* kills as cancelled, and archives no log for a cancelled
# job. A command that exits on its own is an ordinary failure, and a failed job
# keeps its log. SIGINT first so libtest can flush the progress lines, SIGKILL
# after — `timeout` otherwise waits forever for a child that ignores the signal.
# macOS has no `timeout` (GNU coreutils), so it is applied only where it exists.
if command -v timeout >/dev/null 2>&1; then
  bound=(timeout --signal=INT --kill-after=30 300)
else
  bound=()
fi

# Serial on purpose, for two reasons. Several tests mutate process-global state
# — env vars behind TEST_ENV_LOCK, AGENTPACK_SKILL_BACKUP_ROOT — and a lock is a
# weaker guarantee than simply not racing. It also makes a hang diagnosable:
# libtest prints each test's name *before* running it when single-threaded, so a
# killed run still names the test it died in.
#
# Redirected to a file, never piped: `timeout` kills cargo, but any process the
# run leaves behind inherits the write end of a pipe and `tee` then blocks on an
# EOF that never comes — which made the bound itself unbounded. Waiting on one
# process fixes that.
log="${RUNNER_TEMP:-/tmp}/cargo-test-${module}.txt"
rc=0
# `${bound[@]+…}` guards the empty-array case: macOS ships bash 3.2, where a
# bare `${bound[@]}` under `set -u` is an unbound-variable error, not "".
${bound[@]+"${bound[@]}"} cargo test --all-features -- --test-threads=1 --nocapture "${module}::" \
  >"$log" 2>&1 || rc=$?
tail -n 80 "$log"

if [ "$rc" -ne 0 ]; then
  echo "::error::cargo test ${module}:: exited $rc (124/137 means the bound fired — the last 'test …' line above names the test that hung)"
  exit "$rc"
fi

# A filter that matches nothing exits 0 with everything "filtered out", so a
# renamed module would quietly stop being tested while the job stayed green.
ran="$(grep -c "^test ${module}::" "$log" || true)"
if [ "${ran:-0}" -eq 0 ]; then
  echo "::error::no test matched ${module}:: — the module was renamed or removed; update the step list in rust.yml"
  exit 1
fi
echo "${module}:: — ${ran} tests"

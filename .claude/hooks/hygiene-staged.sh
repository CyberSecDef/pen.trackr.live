#!/usr/bin/env bash
# Blocks a commit that would put internal infrastructure details into this
# public repository. Fires only on `git commit` (filtered by the hook's `if`).
#
# Fail-open by design: if the scanner cannot be built or run, this exits 0 and
# lets the commit through. CI is the real gate — a broken local toolchain should
# not stop all work, and a local check that silently becomes a hard blocker is
# how people end up passing --no-verify out of habit.
set -uo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0

if [ ! -f tools/hygiene/dist/cli.js ]; then
  [ -x node_modules/.bin/tsc ] || exit 0
  node_modules/.bin/tsc --build tools/hygiene >/dev/null 2>&1 || exit 0
fi
[ -f tools/hygiene/dist/cli.js ] || exit 0

if output="$(node tools/hygiene/dist/cli.js --staged 2>&1)"; then
  exit 0
fi

printf '%s\n' "$output" >&2
exit 2

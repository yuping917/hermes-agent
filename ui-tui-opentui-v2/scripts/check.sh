#!/usr/bin/env bash
# Phase gate for the native OpenTUI engine (spec v4 §5). Runs the full headless
# suite: format + type-check + lint + vitest (which includes the headless frame
# gate via captureCharFrame). The agentic smoke (docs/plans/opentui-smoke.md) is
# the live complement — run BOTH every phase.
#
# Runs entirely on Node 26.3 (no Bun). The OpenTUI native core loads via node:ffi
# under --experimental-ffi; vitest passes that flag to its test forks (see
# vitest.config.ts). Requires `node -v` == v26.3.x on PATH.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== [1/4] format (prettier --check) =="
npx prettier --check src

echo "== [2/4] type-check =="
npm run --silent type-check

echo "== [3/4] lint =="
npm run --silent lint

echo "== [4/4] vitest (incl. headless frame gate) =="
npm test

echo "== check OK =="

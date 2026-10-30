#!/usr/bin/env bash
# Puts `codelit-connect` on your PATH via npm link (reversible: `npm unlink -g codelit-connect`).
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required (comes with Node 22+). Then run: npm link"
  exit 1
fi
npm link
echo "---"
command -v codelit-connect
codelit-connect status

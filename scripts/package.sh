#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Builds dist/markdown-compose-preview-<version>.xpi from the files the add-on needs at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."

version="$(node -p "require('./manifest.json').version")"
out="dist/markdown-compose-preview-$version.xpi"
mkdir -p dist
rm -f "$out"
zip -r -X "$out" manifest.json background.js lib experiments options preview icons \
  vendor/markdown.js vendor/LICENSES.txt README.md LICENSE >/dev/null
echo "$out ($(wc -c <"$out") bytes)"

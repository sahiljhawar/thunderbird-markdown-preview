#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Rebuild vendored files from devDependencies. The extension itself has no build step:
# the outputs (vendor/markdown.js, preview/github-markdown.css) are committed.
set -euo pipefail
cd "$(dirname "$0")/.."

npx esbuild vendor/src/entry.js --bundle --format=esm --minify --legal-comments=none \
  --target=firefox115 --outfile=vendor/markdown.js

cp node_modules/github-markdown-css/github-markdown.css preview/github-markdown.css

# Keep upstream licenses next to the bundle.
{
  for pkg in markdown-it markdown-it-task-lists markdown-it-footnote markdown-it-emoji highlight.js github-markdown-css; do
    echo "===== $pkg $(node -p "require('./node_modules/$pkg/package.json').version") ====="
    cat "node_modules/$pkg/LICENSE"* 2>/dev/null || cat "node_modules/$pkg/license"* 2>/dev/null || echo "(license file not found)"
    echo
  done
} > vendor/LICENSES.txt
echo "vendored: $(wc -c < vendor/markdown.js) bytes"

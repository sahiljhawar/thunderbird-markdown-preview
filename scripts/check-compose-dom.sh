#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Checks that a Thunderbird build still has the compose-window elements the Experiment
# relies on. Usage: scripts/check-compose-dom.sh [thunderbird-install-dir]
# The directory must contain omni.ja (for example a downloaded Thunderbird ESR or beta).
set -euo pipefail

dir="${1:-/snap/thunderbird/current/usr/lib/thunderbird}"
omni="$dir/omni.ja"
[ -f "$omni" ] || { echo "no omni.ja in $dir" >&2; exit 2; }

version="$(grep -m1 '^Version=' "$dir/application.ini" 2>/dev/null | cut -d= -f2 || echo unknown)"
xhtml="$(unzip -p "$omni" chrome/messenger/content/messenger/messengercompose/messengercompose.xhtml)"

status=0
for id in messageArea messageEditor FindToolbar composeToolbar2; do
  if grep -q "id=\"$id\"" <<<"$xhtml"; then
    echo "ok       #$id"
  else
    echo "MISSING  #$id"
    status=1
  fi
done

# #messageArea must directly contain #messageEditor (the pane is a sibling of the editor).
if ! grep -Pzo '(?s)id="messageArea".*?id="messageEditor"' <<<"$xhtml" >/dev/null; then
  echo "WARNING  #messageEditor does not follow #messageArea"
  status=1
fi

echo "Thunderbird $version: $([ $status -eq 0 ] && echo compatible || echo 'layout changed, review experiments/mdpane/parent.js')"
exit $status

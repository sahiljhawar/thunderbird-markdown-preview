// SPDX-License-Identifier: GPL-3.0-or-later
export const DEFAULTS = Object.freeze({
  enabledByDefault: true, // remembered: follows the last toggle
  breaks: true, // single newline becomes <br>, like GitHub comments
  debounceMs: 150,
  paneWidth: 480,
});

export async function getSettings() {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export function setSettings(patch) {
  return browser.storage.local.set(patch);
}

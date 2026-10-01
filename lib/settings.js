// SPDX-License-Identifier: GPL-3.0-or-later
export const DEFAULTS = Object.freeze({
  renderByDefault: true, // Markdown is rendered on send; follows the last toggle
  previewByDefault: true, // preview pane expanded; follows the last hide/show
  breaks: true, // single newline becomes <br>, like GitHub comments
  debounceMs: 150,
  paneWidth: 480,
});

export async function getSettings() {
  const stored = await browser.storage.local.get([...Object.keys(DEFAULTS), "enabledByDefault"]);
  // Version 1.0.0 had a single switch for both; it becomes the render default.
  if (stored.renderByDefault === undefined && typeof stored.enabledByDefault === "boolean") {
    stored.renderByDefault = stored.enabledByDefault;
  }
  delete stored.enabledByDefault;
  return { ...DEFAULTS, ...stored };
}

export function setSettings(patch) {
  return browser.storage.local.set(patch);
}

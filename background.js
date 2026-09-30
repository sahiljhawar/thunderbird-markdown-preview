// SPDX-License-Identifier: GPL-3.0-or-later
import { createRenderer, renderMessage } from "./lib/render.js";
import { inlineStyles } from "./lib/inline.js";
import { previewCss } from "./lib/theme.js";
import { liftSignatures, isolateMarks, restoreSignatures } from "./lib/signature.js";
import { DEFAULTS, getSettings, setSettings } from "./lib/settings.js";

const PLAIN_TEXT_NOTICE =
  "Plain-text message: Markdown cannot be sent rendered. Start a new message with Shift+Write " +
  "(or Shift+Reply) to compose in HTML, or turn Markdown off with the MD button.";
const ATTACH_RETRIES = 8;
const ATTACH_RETRY_MS = 250;

/** windowId -> { tabId, enabled, timer } */
const composeWindows = new Map();

let settings = { ...DEFAULTS };
let render = createRenderer(settings);
let previewStyles = null;

async function loadPreviewStyles() {
  if (previewStyles) return previewStyles;
  const url = browser.runtime.getURL("preview/github-markdown.css");
  const base = await (await fetch(url)).text();
  previewStyles = `${base}\n${previewCss()}`;
  return previewStyles;
}

async function refreshSettings() {
  settings = await getSettings();
  render = createRenderer(settings);
}

browser.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== "local") return;
  await refreshSettings();
  for (const windowId of composeWindows.keys()) schedulePreview(windowId, 0);
});

function setToggleAppearance(entry) {
  const { tabId, enabled } = entry;
  browser.composeAction.setBadgeText({ tabId, text: enabled ? "MD" : "" });
  browser.composeAction.setTitle({
    tabId,
    title: enabled ? "Markdown preview: on (click to turn off)" : "Markdown preview: off (click to turn on)",
  });
}

/**
 * Renders the compose body. The signature is kept as the HTML Thunderbird inserted
 * (bold, links and images intact) and never goes through Markdown.
 * `finish` post-processes the rendered Markdown before the signature is put back
 * (the send path inlines styles there).
 */
async function renderCompose(details, finish = (html) => html) {
  if (!details.isPlainText && details.body) {
    const { html, signatures } = liftSignatures(details.body);
    if (signatures.length) {
      try {
        const text = await browser.mdpane.htmlToText(html);
        return restoreSignatures(finish(render(isolateMarks(text))), signatures);
      } catch (e) {
        console.warn("Signature-aware conversion failed, using plain text body", e);
      }
    }
  }
  return finish(renderMessage(render, details.plainTextBody));
}

async function updatePreview(windowId) {
  const entry = composeWindows.get(windowId);
  if (!entry?.enabled) return;
  try {
    const details = await browser.compose.getComposeDetails(entry.tabId);
    await browser.mdpane.setStatus(windowId, details.isPlainText ? PLAIN_TEXT_NOTICE : "", "warning");
    await browser.mdpane.setPreview(windowId, await renderCompose(details));
  } catch (e) {
    console.error("Markdown preview update failed", e);
    browser.mdpane.setStatus(windowId, `Preview failed: ${e.message ?? e}`, "warning").catch(() => {});
  }
}

function schedulePreview(windowId, delay = settings.debounceMs) {
  const entry = composeWindows.get(windowId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => updatePreview(windowId), delay);
}

async function attach(entry, windowId, attempt = 0) {
  const ok = await browser.mdpane.attachPane(windowId, {
    css: await loadPreviewStyles(),
    width: settings.paneWidth,
    visible: entry.enabled,
  });
  if (ok) return; // the Experiment sends the first onEditorInput once the editor has settled
  // The compose window may still be loading its layout.
  if (attempt < ATTACH_RETRIES && composeWindows.has(windowId)) {
    setTimeout(() => attach(entry, windowId, attempt + 1), ATTACH_RETRY_MS);
  } else {
    console.error("Markdown preview: compose window layout not recognised, pane not attached");
  }
}

async function setupWindow(windowId) {
  if (composeWindows.has(windowId)) return;
  const [tab] = await browser.tabs.query({ windowId });
  if (!tab) return;
  const entry = { tabId: tab.id, enabled: settings.enabledByDefault, timer: null };
  composeWindows.set(windowId, entry);
  setToggleAppearance(entry);
  await attach(entry, windowId);
}

browser.windows.onCreated.addListener((window) => {
  if (window.type === "messageCompose") setupWindow(window.id);
});

browser.windows.onRemoved.addListener((windowId) => {
  const entry = composeWindows.get(windowId);
  if (entry) clearTimeout(entry.timer);
  composeWindows.delete(windowId);
});

browser.mdpane.onEditorInput.addListener((windowId) => schedulePreview(windowId));

browser.mdpane.onPaneResized.addListener((_windowId, width) => {
  settings.paneWidth = width;
  setSettings({ paneWidth: width });
});

browser.composeAction.onClicked.addListener(async (tab) => {
  const entry = composeWindows.get(tab.windowId);
  if (!entry) return;
  entry.enabled = !entry.enabled;
  setToggleAppearance(entry);
  await browser.mdpane.setVisible(tab.windowId, entry.enabled);
  if (entry.enabled) schedulePreview(tab.windowId, 0);
  settings.enabledByDefault = entry.enabled;
  setSettings({ enabledByDefault: entry.enabled });
});

browser.compose.onBeforeSend.addListener(async (tab, details) => {
  const entry = composeWindows.get(tab.windowId);
  if (!entry?.enabled || !details.plainTextBody?.trim()) return {};

  if (details.isPlainText) {
    await notify(
      "Markdown was not converted",
      "This message is being composed as plain text, which cannot carry rendered HTML. " +
        "Start a new message with Shift+Write (or Shift+Reply) to compose in HTML, " +
        "or turn Markdown off with the MD button, then send again."
    );
    return { cancel: true };
  }

  try {
    const html = await renderCompose(details, (rendered) => inlineStyles(rendered));
    // "Only Plain Text" delivery would flatten the rendered HTML again.
    const deliveryFormat = details.deliveryFormat === "plaintext" ? "both" : details.deliveryFormat;
    return { details: deliveryFormat ? { body: html, deliveryFormat } : { body: html } };
  } catch (e) {
    console.error("Markdown render failed on send", e);
    await notify(
      "Markdown rendering failed",
      "The message was not sent. Turn Markdown off with the MD button to send it as written."
    );
    return { cancel: true };
  }
});

function notify(title, message) {
  return browser.notifications.create({
    type: "basic",
    title,
    message,
    iconUrl: browser.runtime.getURL("icons/icon.svg"),
  });
}

// Compose windows that were already open when the extension started.
(async () => {
  await refreshSettings();
  const windows = await browser.windows.getAll({ windowTypes: ["messageCompose"] });
  for (const window of windows) setupWindow(window.id);
})();

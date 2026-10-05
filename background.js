// SPDX-License-Identifier: GPL-3.0-or-later
import { createRenderer, renderMessage } from "./lib/render.js";
import { inlineStyles } from "./lib/inline.js";
import { previewCss } from "./lib/theme.js";
import { liftProtected, isolateMarks, restoreBlocks, neutralizeForPreview } from "./lib/protected.js";
import { DEFAULTS, getSettings, setSettings } from "./lib/settings.js";

const PLAIN_TEXT_NOTICE =
  "Plain-text message: Markdown cannot be sent rendered. Start a new message with Shift+Write " +
  "(or Shift+Reply) to compose in HTML, or turn Markdown off with the toolbar button.";
const RENDER_OFF_NOTICE = "Markdown rendering is off: the message is shown, and will be sent, as written.";
const ATTACH_RETRIES = 8;
const ATTACH_RETRY_MS = 250;

/** windowId -> { tabId, render (Markdown rendered on send), preview (pane expanded), timer } */
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

/** The toolbar button toggles Markdown rendering. Its badge and label show the state. */
function setToggleAppearance(entry) {
  const { tabId, render: on } = entry;
  browser.composeAction.setBadgeText({ tabId, text: on ? "ON" : "OFF" });
  browser.composeAction.setBadgeBackgroundColor({ tabId, color: on ? "#1a7f37" : "#6e7781" });
  browser.composeAction.setTitle({
    tabId,
    title: on ? "Markdown: on" : "Markdown: off",
  });
}

/** Pushes the window's state to the pane and the toolbar button, and refreshes the preview. */
async function applyState(windowId) {
  const entry = composeWindows.get(windowId);
  if (!entry) return;
  setToggleAppearance(entry);
  await browser.mdpane.setState(windowId, { render: entry.render, preview: entry.preview });
  if (entry.preview) schedulePreview(windowId, 0);
}

/**
 * Renders the compose body. Only what you typed goes through Markdown. Everything else
 * stays as the HTML it already is: your signature, the "On ... wrote:" line, the quoted
 * message of a reply and the forwarded message of a forward, as well as any images you
 * pasted or inserted (see lib/protected.js).
 *
 * `finish` post-processes the rendered Markdown before those blocks are put back (the
 * send path inlines styles there). With `forPreview`, remote images in the blocks are
 * not loaded.
 */
async function renderCompose(details, { finish = (html) => html, forPreview = false } = {}) {
  if (!details.isPlainText && details.body) {
    const { html, blocks, images, linked } = liftProtected(details.body);
    if (blocks.length || images.length || linked) {
      try {
        const text = await browser.mdpane.htmlToText(html);
        const shown = forPreview ? blocks.map((block) => neutralizeForPreview(block)) : blocks;
        return restoreBlocks(finish(render(isolateMarks(text))), shown, images);
      } catch (e) {
        console.warn("Block-aware conversion failed, using plain text body", e);
      }
    }
  }
  return finish(renderMessage(render, details.plainTextBody));
}

/** The message as the editor has it (Markdown source untouched), made safe for the preview. */
function messageAsWritten(details) {
  const doc = new DOMParser().parseFromString(details.body ?? "", "text/html");
  return neutralizeForPreview(doc.body.innerHTML);
}

async function updatePreview(windowId) {
  const entry = composeWindows.get(windowId);
  if (!entry?.preview) return; // collapsed: nothing to show, nothing to compute
  const renderAtStart = entry.render;
  try {
    const details = await browser.compose.getComposeDetails(entry.tabId);
    // Rendering on: the Markdown, rendered. Off: the message as usual, as written.
    const html = renderAtStart ? await renderCompose(details, { forPreview: true }) : messageAsWritten(details);
    // The switches may have been flipped while this update was in flight: do not paint stale content.
    if (entry.render !== renderAtStart || !entry.preview || !composeWindows.has(windowId)) return;
    if (!renderAtStart) await browser.mdpane.setStatus(windowId, RENDER_OFF_NOTICE, "info");
    else await browser.mdpane.setStatus(windowId, details.isPlainText ? PLAIN_TEXT_NOTICE : "", "warning");
    await browser.mdpane.setPreview(windowId, html);
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
    render: entry.render,
    preview: entry.preview,
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
  const entry = {
    tabId: tab.id,
    render: settings.renderByDefault,
    preview: settings.previewByDefault,
    timer: null,
  };
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

function toggleRender(windowId) {
  const entry = composeWindows.get(windowId);
  if (!entry) return;
  entry.render = !entry.render;
  settings.renderByDefault = entry.render;
  setSettings({ renderByDefault: entry.render });
  applyState(windowId);
}

function setPreview(windowId, shown) {
  const entry = composeWindows.get(windowId);
  if (!entry || entry.preview === shown) return;
  entry.preview = shown;
  settings.previewByDefault = shown;
  setSettings({ previewByDefault: shown });
  applyState(windowId);
}

// Two toolbar buttons: "Markdown" (this action) toggles rendering, and "Preview" (added
// by the Experiment) shows or hides the pane. The pane has its own buttons for the same two.
browser.composeAction.onClicked.addListener((tab) => toggleRender(tab.windowId));

browser.mdpane.onUserAction.addListener((windowId, action) => {
  if (action === "toggle-render") toggleRender(windowId);
  else if (action === "toggle-preview") setPreview(windowId, !composeWindows.get(windowId)?.preview);
  else if (action === "hide-preview") setPreview(windowId, false);
  else if (action === "show-preview") setPreview(windowId, true);
});

browser.compose.onBeforeSend.addListener(async (tab, details) => {
  const entry = composeWindows.get(tab.windowId);
  if (!entry?.render || !details.plainTextBody?.trim()) return {};

  if (details.isPlainText) {
    await notify(
      "Markdown was not converted",
      "This message is being composed as plain text, which cannot carry rendered HTML. " +
        "Start a new message with Shift+Write (or Shift+Reply) to compose in HTML, " +
        "or turn Markdown off with the toolbar button, then send again."
    );
    return { cancel: true };
  }

  try {
    const html = await renderCompose(details, { finish: (rendered) => inlineStyles(rendered) });
    // "Only Plain Text" delivery would flatten the rendered HTML again.
    const deliveryFormat = details.deliveryFormat === "plaintext" ? "both" : details.deliveryFormat;
    return { details: deliveryFormat ? { body: html, deliveryFormat } : { body: html } };
  } catch (e) {
    console.error("Markdown render failed on send", e);
    await notify(
      "Markdown rendering failed",
      "The message was not sent. Turn Markdown off with the toolbar button to send it as written."
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

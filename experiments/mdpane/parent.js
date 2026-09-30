// SPDX-License-Identifier: GPL-3.0-or-later
/* Privileged part of the extension: the only code that touches Thunderbird's
 * own UI. It depends on exactly two element ids in the compose window
 * (#messageArea and #messageEditor) and cleans up after itself on shutdown.
 * Everything else lives in the background page and uses public APIs. */

"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);

const HTML_NS = "http://www.w3.org/1999/xhtml";
const ID = {
  style: "mdp-style",
  handle: "mdp-handle",
  pane: "mdp-pane",
  status: "mdp-status",
  frame: "mdp-frame",
};
const DEFAULT_WIDTH = 480;
const MIN_PANE = 220;
const MIN_EDITOR = 260;
const REBIND_INTERVAL_MS = 500;
// Resizing the editor while Thunderbird is still building a new message (body,
// signature, quoted text) makes it drop or misplace the signature. The layout
// change therefore waits until the editor content has stopped changing.
const SETTLE_QUIET_MS = 400;
const SETTLE_MAX_MS = 5000;

const CHROME_CSS = `
#messageArea.mdp-on {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 6px var(--mdp-width, 480px);
  grid-template-rows: minmax(0, 1fr) auto;
}
/* The editor is a replaced element: without an explicit stretch a grid item keeps its 300x150 intrinsic size. */
#messageArea.mdp-on > #messageEditor {
  grid-column: 1; grid-row: 1; justify-self: stretch; align-self: stretch; min-width: 0;
}
#messageArea.mdp-on > #FindToolbar { grid-column: 1; grid-row: 2; }
#mdp-handle, #mdp-pane { display: none; }
#messageArea.mdp-on > #mdp-handle {
  display: block; grid-column: 2; grid-row: 1 / span 2;
  cursor: col-resize; touch-action: none;
  background: color-mix(in srgb, CanvasText 14%, transparent);
}
#messageArea.mdp-on > #mdp-handle:hover { background: color-mix(in srgb, CanvasText 30%, transparent); }
#messageArea.mdp-on > #mdp-pane {
  display: flex; flex-direction: column; grid-column: 3; grid-row: 1 / span 2;
  min-width: 0; min-height: 0; background: Canvas; color: CanvasText;
}
#mdp-status {
  flex: none; padding: 4px 10px; font-size: 12px;
  background: color-mix(in srgb, CanvasText 8%, Canvas);
  border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
}
#mdp-status[hidden] { display: none; }
#mdp-status[data-kind="warning"] { background: #fff3cd; color: #664d03; }
#mdp-frame { flex: 1 1 0; min-height: 0; width: 100%; border: 0; background: Canvas; }
`;

const FRAME_CSP =
  "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'";

/** windowId -> per-window state. */
const panes = new Map();
const inputListeners = new Set();
const resizeListeners = new Set();

function emit(listeners, ...args) {
  for (const listener of listeners) {
    try {
      listener(...args);
    } catch (e) {
      console.error("[mdpane] listener failed", e);
    }
  }
}

/**
 * Fills the frame's document. srcdoc and data: URLs do not load inside a
 * chrome-privileged document, so the initial about:blank document is populated
 * through the DOM instead. Safe to call repeatedly: it re-installs if the
 * document was replaced.
 */
function ensureFrameDocument(state) {
  const fdoc = state.frame.contentDocument;
  if (!fdoc?.body) return null;
  if (fdoc.getElementById("mdp-css")) return fdoc;

  const meta = fdoc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", FRAME_CSP);
  const style = fdoc.createElement("style");
  style.id = "mdp-css";
  style.textContent =
    `${state.css}\nbody{margin:0}.markdown-body{box-sizing:border-box;min-height:100vh;padding:16px 20px}` +
    `.markdown-body>:last-child{margin-bottom:0}`;
  fdoc.head.append(meta, style);
  fdoc.body.className = "markdown-body";
  // Links are inert: a plain click would navigate the frame away.
  fdoc.addEventListener("click", (e) => {
    if (e.target?.closest?.("a")) e.preventDefault();
  });
  fdoc.body.innerHTML = state.html;
  return fdoc;
}

function showPreview(state, html) {
  state.html = html;
  const fdoc = ensureFrameDocument(state);
  if (fdoc) fdoc.body.innerHTML = html;
}

function getWindow(context, windowId) {
  try {
    return context.extension.windowManager.get(windowId, context)?.window ?? null;
  } catch {
    return null;
  }
}

function removeAll(win) {
  const doc = win.document;
  doc.getElementById("messageArea")?.classList.remove("mdp-on");
  for (const id of Object.values(ID)) doc.getElementById(id)?.remove();
}

function bindEditor(state) {
  const { win, windowId } = state;
  let editorDoc = null;
  try {
    editorDoc = win.document.getElementById("messageEditor")?.contentDocument ?? null;
  } catch {
    return;
  }
  if (!editorDoc || editorDoc === state.boundDoc) return;

  if (state.boundDoc) {
    try {
      state.boundDoc.removeEventListener("input", state.onInput, true);
      state.boundDoc.removeEventListener("scroll", state.onScroll, true);
    } catch {
      // The old document is already gone.
    }
  }
  editorDoc.addEventListener("input", state.onInput, true);
  editorDoc.addEventListener("scroll", state.onScroll, true);
  state.boundDoc = editorDoc;
  // Before the editor has settled nothing reads it: the first preview is
  // requested once it has (see buildPane).
  if (state.settled) emit(inputListeners, windowId);
}

function syncScroll(state) {
  try {
    const src = state.boundDoc?.scrollingElement;
    const dst = state.frame.contentDocument?.scrollingElement;
    if (!src || !dst) return;
    const range = src.scrollHeight - src.clientHeight;
    const ratio = range > 0 ? src.scrollTop / range : 0;
    dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
  } catch {
    // Scroll sync is a nicety.
  }
}

/**
 * Resolves once the message editor of a new compose window has finished filling
 * itself: after "compose-editor-ready", when its body has not changed for
 * SETTLE_QUIET_MS. Always resolves within SETTLE_MAX_MS.
 */
function whenEditorSettled(win) {
  return new Promise((resolve) => {
    let done = false;
    let quietTimer = null;
    let observer = null;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        observer?.disconnect();
        win.clearTimeout(quietTimer);
        win.clearTimeout(capTimer);
      } catch {
        // Window already closed.
      }
      resolve();
    };
    const capTimer = win.setTimeout(finish, SETTLE_MAX_MS);
    const start = () => {
      try {
        const body = win.document.getElementById("messageEditor")?.contentDocument?.body;
        if (!body) return finish();
        observer = new win.MutationObserver(() => {
          win.clearTimeout(quietTimer);
          quietTimer = win.setTimeout(finish, SETTLE_QUIET_MS);
        });
        observer.observe(body, { childList: true, subtree: true, characterData: true });
        quietTimer = win.setTimeout(finish, SETTLE_QUIET_MS);
      } catch {
        finish();
      }
    };
    if (win.composeEditorReady) start();
    else win.addEventListener("compose-editor-ready", start, { once: true });
  });
}

/** Shows or hides the pane, but never before the editor has settled. */
function applyVisibility(state) {
  if (!state.settled) return;
  if (state.visible) ensureFrameDocument(state);
  state.win.document.getElementById("messageArea")?.classList.toggle("mdp-on", state.visible);
}

function buildPane(win, windowId, { css, width, visible }) {
  const doc = win.document;
  const area = doc.getElementById("messageArea");
  const editor = doc.getElementById("messageEditor");
  if (!area || !editor) return null;

  removeAll(win); // idempotent re-attach

  const make = (tag, id) => {
    const el = doc.createElementNS(HTML_NS, tag);
    el.id = id;
    return el;
  };

  const style = make("style", ID.style);
  style.textContent = CHROME_CSS;
  doc.documentElement.appendChild(style);

  const handle = make("div", ID.handle);
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  const pane = make("div", ID.pane);
  const status = make("div", ID.status);
  status.hidden = true;
  const frame = make("iframe", ID.frame);
  frame.setAttribute("sandbox", "");
  frame.setAttribute("title", "Markdown preview");
  pane.append(status, frame);
  area.append(handle, pane);
  area.style.setProperty("--mdp-width", `${width || DEFAULT_WIDTH}px`);

  const state = {
    win,
    windowId,
    frame,
    status,
    css,
    html: "",
    visible: visible !== false,
    settled: false,
    boundDoc: null,
    timer: null,
    onInput: () => emit(inputListeners, windowId),
    onScroll: () => syncScroll(state),
    cleanup: [],
  };

  ensureFrameDocument(state);
  // A frame's initial about:blank document can be replaced by the asynchronous
  // about:blank load shortly after insertion (seen on ESR). Fill the new one too.
  frame.addEventListener("load", () => ensureFrameDocument(state));

  // Drag handle.
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Capture only keeps the drag alive over the iframe; dragging still works without it.
    }
    const onMove = (e) => {
      const rect = area.getBoundingClientRect();
      const max = Math.max(MIN_PANE, rect.width - MIN_EDITOR);
      const next = Math.min(max, Math.max(MIN_PANE, Math.round(rect.right - e.clientX)));
      area.style.setProperty("--mdp-width", `${next}px`);
      state.width = next;
    };
    const onUp = (e) => {
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        // Not captured.
      }
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      if (state.width) emit(resizeListeners, windowId, state.width);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    event.preventDefault();
  });

  // The editor document is replaced when the compose format changes, so
  // re-bind whenever it differs from the one we listen to.
  state.timer = win.setInterval(() => bindEditor(state), REBIND_INTERVAL_MS);
  const onUnload = () => detach(windowId);
  win.addEventListener("unload", onUnload, { once: true });
  state.cleanup.push(() => win.removeEventListener("unload", onUnload));

  panes.set(windowId, state);
  bindEditor(state);
  pane.dataset.state = "built";
  whenEditorSettled(win).then(() => {
    state.settled = true;
    pane.dataset.state = "settled";
    ensureFrameDocument(state);
    applyVisibility(state);
    emit(inputListeners, windowId); // first preview, now that the content is stable
  });
  return state;
}

function detach(windowId) {
  const state = panes.get(windowId);
  if (!state) return;
  panes.delete(windowId);
  try {
    state.win.clearInterval(state.timer);
    if (state.boundDoc) {
      state.boundDoc.removeEventListener("input", state.onInput, true);
      state.boundDoc.removeEventListener("scroll", state.onScroll, true);
    }
    for (const fn of state.cleanup) fn();
    removeAll(state.win);
    state.win.document.getElementById("messageArea")?.style.removeProperty("--mdp-width");
  } catch {
    // Window is closing; nothing left to clean.
  }
}

var mdpane = class extends ExtensionAPI {
  onShutdown() {
    for (const windowId of [...panes.keys()]) detach(windowId);
    inputListeners.clear();
    resizeListeners.clear();
  }

  getAPI(context) {
    const listenerEvent = (listeners) =>
      new ExtensionCommon.EventManager({
        context,
        register: (fire) => {
          const listener = (...args) => fire.async(...args);
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      }).api();

    return {
      mdpane: {
        async attachPane(windowId, options) {
          const win = getWindow(context, windowId);
          if (!win) return false;
          try {
            return buildPane(win, windowId, options) !== null;
          } catch (e) {
            console.error("[mdpane] attachPane failed", e);
            Services.console.logStringMessage(`[mdpane] attachPane failed: ${e} ${e?.stack ?? ""}`);
            return false;
          }
        },
        async setPreview(windowId, html) {
          const state = panes.get(windowId);
          if (!state) return;
          showPreview(state, html);
        },
        async setStatus(windowId, text, kind) {
          const state = panes.get(windowId);
          if (!state) return;
          state.status.textContent = text;
          state.status.dataset.kind = kind || "info";
          state.status.hidden = !text;
        },
        async setVisible(windowId, visible) {
          const state = panes.get(windowId);
          if (!state) return;
          state.visible = !!visible;
          applyVisibility(state);
        },
        async htmlToText(html) {
          const utils = Cc["@mozilla.org/parserutils;1"].getService(Ci.nsIParserUtils);
          const enc = Ci.nsIDocumentEncoder;
          const text = utils.convertToPlainText(
            html,
            enc.OutputPersistNBSP | enc.OutputFormatted | enc.OutputDisallowLineBreaking,
            990
          );
          return text.replaceAll("\r\n", "\n").replace(/\n+$/, "");
        },
        async detachPane(windowId) {
          detach(windowId);
        },
        onEditorInput: listenerEvent(inputListeners),
        onPaneResized: listenerEvent(resizeListeners),
      },
    };
  }
};

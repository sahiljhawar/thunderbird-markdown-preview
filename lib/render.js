// SPDX-License-Identifier: GPL-3.0-or-later
import { MarkdownIt, taskLists, footnote, emoji, hljs } from "../vendor/markdown.js";
import { ALERTS } from "./theme.js";

const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;

/** GitHub-style alerts: `> [!NOTE]` turns the blockquote into a labelled callout. */
function alerts(md) {
  md.core.ruler.after("block", "gh-alerts", (state) => {
    const t = state.tokens;
    for (let i = 0; i < t.length - 2; i++) {
      if (
        t[i].type !== "blockquote_open" ||
        t[i + 1].type !== "paragraph_open" ||
        t[i + 2].type !== "inline"
      ) {
        continue;
      }
      const inline = t[i + 2];
      const match = ALERT_MARKER.exec(inline.content);
      if (!match) continue;

      const kind = match[1].toLowerCase();
      t[i].attrJoin("class", `markdown-alert markdown-alert-${kind}`);
      inline.content = inline.content.slice(match[0].length);

      const level = t[i + 1].level;
      const open = new state.Token("paragraph_open", "p", 1);
      open.attrSet("class", "markdown-alert-title");
      open.level = level;
      open.block = true;
      const title = new state.Token("inline", "", 0);
      title.content = ALERTS[kind].label;
      title.children = [];
      title.level = level + 1;
      const close = new state.Token("paragraph_close", "p", -1);
      close.level = level;
      close.block = true;

      // Drop the original paragraph when the marker was all it held.
      const drop = inline.content.trim() === "" ? 3 : 0;
      t.splice(i + 1, drop, open, title, close);
      i += 3;
    }
  });
}

function highlight(source, lang) {
  let inner;
  try {
    const name = (lang || "").trim().split(/\s+/)[0].toLowerCase();
    inner = name && hljs.getLanguage(name)
      ? hljs.highlight(source, { language: name, ignoreIllegals: true }).value
      : null;
  } catch {
    inner = null;
  }
  if (inner == null) inner = md.utils.escapeHtml(source);
  // Must start with "<pre" or markdown-it wraps the result in another <pre><code>.
  return `<pre><code>${inner}</code></pre>\n`;
}

/**
 * Build a renderer with GitHub-like behaviour: GFM tables, task lists,
 * strikethrough, autolinks, footnotes, emoji shortcodes, alerts, highlighted
 * fences. Raw HTML in the source is escaped.
 */
export function createRenderer({ breaks = true } = {}) {
  const instance = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks,
    highlight,
  });
  instance.enable(["table", "strikethrough"]);
  instance.use(taskLists, { enabled: false, label: false });
  instance.use(footnote);
  instance.use(emoji);
  instance.use(alerts);
  return (source) => instance.render(source);
}

// Only used for its `utils`, which are option-independent.
const md = new MarkdownIt();

const SIGNATURE_DELIMITER = /\n-- ?\n/;

/**
 * Renders a whole message body. A trailing "-- " signature block is kept out
 * of Markdown (otherwise the delimiter turns the line above it into a heading).
 */
export function renderMessage(render, text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const parts = normalized.split(SIGNATURE_DELIMITER);
  const signature = parts.length > 1 ? parts.pop() : null;
  const html = render(parts.join("\n-- \n"));
  if (signature == null) return html;
  const escaped = md.utils.escapeHtml(signature.replace(/\n+$/, "")).replace(/\n/g, "<br>\n");
  return `${html}<p class="mdp-signature">-- <br>\n${escaped}</p>\n`;
}

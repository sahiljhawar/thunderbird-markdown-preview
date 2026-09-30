// SPDX-License-Identifier: GPL-3.0-or-later
// Turns rendered Markdown HTML into email-safe HTML: mail clients strip <style>
// blocks, so every element gets its GitHub (light theme) styling inline.

import { ALERTS, HLJS_LIGHT } from "./theme.js";

// Single quotes only: these land inside double-quoted style attributes.
const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";
const MONO =
  "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
const BORDER = "#d0d7de";
const MUTED = "#59636e";
const CODE_BG = "#f6f8fa";

const heading = (size, rule) =>
  `font-size:${size};font-weight:600;line-height:1.25;margin:24px 0 16px;` +
  (rule ? `padding-bottom:.3em;border-bottom:1px solid ${BORDER};` : "");

const TAG_STYLES = {
  h1: heading("2em", true),
  h2: heading("1.5em", true),
  h3: heading("1.25em"),
  h4: heading("1em"),
  h5: heading(".875em"),
  h6: heading(".85em") + `color:${MUTED};`,
  p: "margin:0 0 16px;",
  a: "color:#0969da;text-decoration:none;",
  blockquote: `margin:0 0 16px;padding:0 1em;color:${MUTED};border-left:.25em solid ${BORDER};`,
  ul: "margin:0 0 16px;padding-left:2em;",
  ol: "margin:0 0 16px;padding-left:2em;",
  li: "margin:.25em 0 0;",
  hr: `height:.25em;padding:0;margin:24px 0;background-color:${BORDER};border:0;`,
  code: `font-family:${MONO};font-size:85%;padding:.2em .4em;margin:0;background-color:#eff1f3;border-radius:6px;`,
  pre: `font-family:${MONO};font-size:85%;line-height:1.45;padding:16px;margin:0 0 16px;overflow:auto;background-color:${CODE_BG};border-radius:6px;white-space:pre;`,
  table: "border-collapse:collapse;border-spacing:0;margin:0 0 16px;",
  th: `padding:6px 13px;border:1px solid ${BORDER};font-weight:600;`,
  td: `padding:6px 13px;border:1px solid ${BORDER};`,
  img: "max-width:100%;box-sizing:content-box;",
  sup: "font-size:.75em;",
  del: "text-decoration:line-through;",
  s: "text-decoration:line-through;",
  strong: "font-weight:600;",
  kbd: `font-family:${MONO};font-size:11px;padding:3px 5px;border:1px solid ${BORDER};border-radius:6px;background-color:${CODE_BG};`,
};

const CONTAINER_STYLE =
  `font-family:${SANS};font-size:16px;line-height:1.5;color:#1f2328;word-wrap:break-word;`;

function tokenColor(el) {
  const classes = [...el.classList].filter((c) => c.startsWith("hljs-") || c.endsWith("_"));
  const hl = classes.filter((c) => c.startsWith("hljs-"));
  const sub = classes.filter((c) => !c.startsWith("hljs-"));
  for (const base of hl) {
    for (const s of sub) {
      const hit = HLJS_LIGHT[`${base}.${s}`];
      if (hit) return hit;
    }
    const hit = HLJS_LIGHT[base];
    if (hit) return hit;
  }
  return null;
}

function append(el, css) {
  const existing = el.getAttribute("style") || "";
  el.setAttribute("style", existing + css);
}

/**
 * @param {string} html rendered markdown fragment
 * @param {{ DOMParser?: typeof DOMParser }} [env] injectable for tests
 * @returns {string} styled fragment wrapped in one container div
 */
export function inlineStyles(html, env = {}) {
  const Parser = env.DOMParser || globalThis.DOMParser;
  const doc = new Parser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;

  // Task list checkboxes are usually stripped by mail clients: use glyphs.
  for (const box of body.querySelectorAll("input.task-list-item-checkbox")) {
    const glyph = doc.createElement("span");
    glyph.textContent = box.hasAttribute("checked") ? "\u2611" : "\u2610";
    box.replaceWith(glyph);
  }
  // In-message anchors do not work reliably in mail clients.
  for (const back of body.querySelectorAll("a.footnote-backref")) back.remove();

  for (const el of body.querySelectorAll("*")) {
    const tag = el.localName;
    if (TAG_STYLES[tag]) append(el, TAG_STYLES[tag]);

    if (tag === "code" && el.parentElement?.localName === "pre") {
      append(el, "font-size:100%;padding:0;margin:0;background-color:transparent;border-radius:0;white-space:pre;");
    }
    if (tag === "tr") {
      const striped =
        el.parentElement?.localName === "tbody" &&
        [...el.parentElement.children].indexOf(el) % 2 === 1;
      append(el, `background-color:${striped ? CODE_BG : "#ffffff"};border-top:1px solid ${BORDER};`);
    }
    if (tag === "th" || tag === "td") {
      const align = el.getAttribute("style")?.match(/text-align:\s*(left|right|center)/);
      if (align) append(el, `text-align:${align[1]};`);
    }
    if (el.classList.contains("contains-task-list")) append(el, "padding-left:1em;");
    if (el.classList.contains("task-list-item")) append(el, "list-style-type:none;");
    if (tag === "section" && el.classList.contains("footnotes")) {
      append(el, `font-size:12px;color:${MUTED};border-top:1px solid ${BORDER};margin-top:24px;padding-top:8px;`);
    }
    if (tag === "hr" && el.classList.contains("footnotes-sep")) append(el, "display:none;");

    if (tag === "blockquote" && el.classList.contains("markdown-alert")) {
      const kind = [...el.classList].find((c) => c.startsWith("markdown-alert-"))?.slice(15);
      const accent = ALERTS[kind]?.light ?? BORDER;
      append(el, `padding:8px 16px;color:#1f2328;border-left:.25em solid ${accent};`);
    }
    if (tag === "p" && el.classList.contains("markdown-alert-title")) {
      const alert = el.closest("blockquote.markdown-alert");
      const kind = [...(alert?.classList ?? [])].find((c) => c.startsWith("markdown-alert-"))?.slice(15);
      append(el, `font-weight:600;margin:0 0 8px;color:${ALERTS[kind]?.light ?? MUTED};`);
    }
    if (tag === "p" && el.classList.contains("mdp-signature")) {
      append(el, `color:${MUTED};margin-top:24px;`);
    }
    if (tag === "span") {
      const color = tokenColor(el);
      if (color) append(el, `color:${color};`);
      if (el.classList.contains("hljs-emphasis")) append(el, "font-style:italic;");
      if (el.classList.contains("hljs-strong")) append(el, "font-weight:bold;");
    }
  }

  // Classes are needed by the pass above (parents are read by their children),
  // so strip them only once every element is styled.
  for (const el of body.querySelectorAll("[class],[dir]")) {
    el.removeAttribute("class");
    el.removeAttribute("dir");
  }

  return `<div style="${CONTAINER_STYLE}">${body.innerHTML}</div>`;
}

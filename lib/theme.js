// SPDX-License-Identifier: GPL-3.0-or-later
// GitHub light/dark syntax palette for highlight.js token classes.
// Used for the preview (as CSS, both schemes) and for the sent mail (inline, light only).

export const HLJS_LIGHT = {
  "hljs-comment": "#6e7781",
  "hljs-quote": "#6e7781",
  "hljs-keyword": "#cf222e",
  "hljs-selector-tag": "#cf222e",
  "hljs-literal": "#0550ae",
  "hljs-number": "#0550ae",
  "hljs-variable": "#953800",
  "hljs-template-variable": "#953800",
  "hljs-string": "#0a3069",
  "hljs-regexp": "#0a3069",
  "hljs-doctag": "#cf222e",
  "hljs-title": "#8250df",
  "hljs-title.function_": "#8250df",
  "hljs-title.class_": "#953800",
  "hljs-section": "#0550ae",
  "hljs-type": "#953800",
  "hljs-built_in": "#0550ae",
  "hljs-attr": "#0550ae",
  "hljs-attribute": "#0550ae",
  "hljs-name": "#116329",
  "hljs-tag": "#116329",
  "hljs-symbol": "#0550ae",
  "hljs-bullet": "#953800",
  "hljs-meta": "#0550ae",
  "hljs-link": "#0a3069",
  "hljs-addition": "#116329",
  "hljs-deletion": "#82071e",
  "hljs-selector-id": "#0550ae",
  "hljs-selector-class": "#0550ae",
  "hljs-params": "#24292f",
  "hljs-property": "#0550ae",
  "hljs-operator": "#0550ae",
  "hljs-subst": "#24292f",
};

export const HLJS_DARK = {
  "hljs-comment": "#8b949e",
  "hljs-quote": "#8b949e",
  "hljs-keyword": "#ff7b72",
  "hljs-selector-tag": "#ff7b72",
  "hljs-literal": "#79c0ff",
  "hljs-number": "#79c0ff",
  "hljs-variable": "#ffa657",
  "hljs-template-variable": "#ffa657",
  "hljs-string": "#a5d6ff",
  "hljs-regexp": "#a5d6ff",
  "hljs-doctag": "#ff7b72",
  "hljs-title": "#d2a8ff",
  "hljs-title.function_": "#d2a8ff",
  "hljs-title.class_": "#ffa657",
  "hljs-section": "#79c0ff",
  "hljs-type": "#ffa657",
  "hljs-built_in": "#79c0ff",
  "hljs-attr": "#79c0ff",
  "hljs-attribute": "#79c0ff",
  "hljs-name": "#7ee787",
  "hljs-tag": "#7ee787",
  "hljs-symbol": "#79c0ff",
  "hljs-bullet": "#ffa657",
  "hljs-meta": "#79c0ff",
  "hljs-link": "#a5d6ff",
  "hljs-addition": "#7ee787",
  "hljs-deletion": "#ffa198",
  "hljs-selector-id": "#79c0ff",
  "hljs-selector-class": "#79c0ff",
  "hljs-params": "#c9d1d9",
  "hljs-property": "#79c0ff",
  "hljs-operator": "#79c0ff",
  "hljs-subst": "#c9d1d9",
};

// GitHub alert accent colors (light, dark).
export const ALERTS = {
  note: { label: "Note", light: "#0969da", dark: "#1f6feb" },
  tip: { label: "Tip", light: "#1a7f37", dark: "#238636" },
  important: { label: "Important", light: "#8250df", dark: "#8957e5" },
  warning: { label: "Warning", light: "#9a6700", dark: "#9e6a03" },
  caution: { label: "Caution", light: "#cf222e", dark: "#da3633" },
};

const selector = (cls) => cls.split(".").map((c) => `.${c}`).join("");

function tokenRules(palette) {
  return Object.entries(palette)
    .map(([cls, color]) => `${selector(cls)}{color:${color}}`)
    .join("");
}

/** Extra CSS for the live preview, layered on top of github-markdown.css. */
export function previewCss() {
  const alertRules = (scheme) =>
    Object.entries(ALERTS)
      .map(
        ([kind, a]) =>
          `.markdown-alert-${kind}{border-left-color:${a[scheme]}}` +
          `.markdown-alert-${kind}>.markdown-alert-title{color:${a[scheme]}}`
      )
      .join("");
  return (
    `.markdown-alert{padding:0 1em;margin-bottom:16px;border-left:.25em solid;color:inherit}` +
    `.markdown-alert>:first-child{margin-top:0}.markdown-alert>:last-child{margin-bottom:0}` +
    `.markdown-alert-title{font-weight:600;display:flex;align-items:center;line-height:1}` +
    tokenRules(HLJS_LIGHT) +
    alertRules("light") +
    `@media (prefers-color-scheme: dark){` +
    tokenRules(HLJS_DARK) +
    alertRules("dark") +
    `}`
  );
}

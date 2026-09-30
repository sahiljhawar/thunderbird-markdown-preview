// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRenderer } from "../lib/render.js";
import { inlineStyles } from "../lib/inline.js";

const render = createRenderer();
const { DOMParser } = new JSDOM("").window;
const inline = (md) => inlineStyles(render(md), { DOMParser });
const parse = (html) => new DOMParser().parseFromString(html, "text/html").body;

test("every element carries an inline style and no classes remain", () => {
  const md = [
    "# Title", "", "para with `code` and [link](https://x.y)", "",
    "| a | b |", "|---|---|", "| 1 | 2 |", "",
    "```js", "const a = 1;", "```", "",
    "> quote", "", "- [x] done", "- [ ] todo", "", "---",
  ].join("\n");
  const body = parse(inline(md));
  const structural = new Set(["thead", "tbody", "span", "section"]);
  for (const el of body.querySelectorAll("*")) {
    if (structural.has(el.localName)) continue;
    assert.ok(el.getAttribute("style"), `<${el.localName}> has no inline style`);
    assert.equal(el.hasAttribute("class"), false, `<${el.localName}> kept its class`);
  }
});

test("style attributes survive a parse round trip (no unescaped quotes)", () => {
  const container = parse(inline("hello")).firstElementChild;
  assert.match(container.getAttribute("style"), /font-family:.*Segoe UI.*;font-size:16px/);
});

test("output is a single styled container without <style> or <script>", () => {
  const html = inline("hello");
  assert.match(html, /^<div style="font-family:/);
  assert.doesNotMatch(html, /<style|<script/);
});

test("task list checkboxes become glyphs", () => {
  const html = inline("- [x] done\n- [ ] todo");
  assert.doesNotMatch(html, /<input/);
  assert.match(html, /\u2611<\/span> done/);
  assert.match(html, /\u2610<\/span> todo/);
});

test("code tokens get GitHub colors", () => {
  const html = inline("```js\nconst a = 1;\n```");
  assert.match(html, /color:#cf222e/); // keyword
});

test("alerts use the accent color for border and title", () => {
  const html = inline("> [!TIP]\n> nice");
  assert.match(html, /border-left:\.25em solid #1a7f37/);
  assert.match(html, /color:#1a7f37/);
});

test("table rows are zebra striped", () => {
  const html = inline("| a |\n|---|\n| 1 |\n| 2 |");
  assert.match(html, /background-color:#f6f8fa/);
});

test("footnote back references are dropped", () => {
  assert.doesNotMatch(inline("x[^1]\n\n[^1]: note"), /footnote-backref|↩/);
});

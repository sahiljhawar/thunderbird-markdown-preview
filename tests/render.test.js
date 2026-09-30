// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRenderer, renderMessage } from "../lib/render.js";

const render = createRenderer();

test("tables, strikethrough and autolinks (GFM)", () => {
  const html = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~ https://example.com");
  assert.match(html, /<table>/);
  assert.match(html, /<s>gone<\/s>/);
  assert.match(html, /<a href="https:\/\/example\.com">/);
});

test("task lists render disabled checkboxes", () => {
  const html = render("- [x] done\n- [ ] todo");
  assert.match(html, /contains-task-list/);
  assert.match(html, /task-list-item-checkbox/);
  assert.equal((html.match(/checked/g) || []).length, 1);
});

test("fenced code is highlighted and unknown languages are escaped", () => {
  const js = render("```js\nconst a = 1;\n```");
  assert.match(js, /^<pre><code>/, "starts with <pre so markdown-it does not wrap it again");
  assert.equal((js.match(/<pre/g) || []).length, 1);
  assert.match(js, /hljs-keyword/);
  const unknown = render("```nope\n<b>x</b>\n```");
  assert.match(unknown, /&lt;b&gt;x&lt;\/b&gt;/);
});

test("raw HTML in the source is escaped", () => {
  const html = render("<script>alert(1)</script>");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("javascript: links are not rendered as links", () => {
  assert.doesNotMatch(render("[x](javascript:alert(1))"), /<a /);
});

test("emoji shortcodes", () => {
  assert.match(render(":smile:"), /\u{1F604}/u);
});

test("footnotes", () => {
  const html = render("text[^1]\n\n[^1]: note");
  assert.match(html, /footnote-ref/);
  assert.match(html, /footnotes/);
});

test("alerts become labelled callouts", () => {
  const html = render("> [!WARNING]\n> careful now");
  assert.match(html, /<blockquote class="markdown-alert markdown-alert-warning">/);
  assert.match(html, /<p class="markdown-alert-title">Warning<\/p>/);
  assert.match(html, /careful now/);
  assert.doesNotMatch(html, /\[!WARNING\]/);
});

test("marker-only alert leaves no empty paragraph", () => {
  const html = render("> [!NOTE]\n\nafter");
  assert.doesNotMatch(html, /<p><\/p>/);
});

test("plain blockquotes are untouched", () => {
  assert.match(render("> quote"), /<blockquote>\n<p>quote<\/p>/);
});

test("single newlines break lines by default and can be disabled", () => {
  assert.match(render("a\nb"), /<br>/);
  assert.doesNotMatch(createRenderer({ breaks: false })("a\nb"), /<br>/);
});

test("signature delimiter does not turn the previous line into a heading", () => {
  const html = renderMessage(render, "hello\n-- \nJane\nAcme");
  assert.doesNotMatch(html, /<h2>/);
  assert.match(html, /<p>hello<\/p>/);
  assert.match(html, /<p class="mdp-signature">-- <br>\nJane<br>\nAcme<\/p>/);
});

test("messages without a signature render unchanged", () => {
  assert.equal(renderMessage(render, "just text"), render("just text"));
});

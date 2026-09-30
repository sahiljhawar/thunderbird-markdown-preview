// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { liftSignatures, isolateMarks, restoreSignatures, MARK } from "../lib/signature.js";
import { createRenderer } from "../lib/render.js";
import { inlineStyles } from "../lib/inline.js";

const { DOMParser } = new JSDOM("").window;
const SIG = '<div class="moz-signature">-- <br><b>Jane Doe</b><br><a href="https://acme.example">acme</a></div>';

test("the signature is lifted out and replaced by a paragraph placeholder", () => {
  const { html, signatures } = liftSignatures(`<p>hello</p>${SIG}`, { DOMParser });
  assert.deepEqual(signatures, [SIG]);
  assert.equal(html, `<p>hello</p><p>${MARK}0</p>`);
});

test("a signature in the middle keeps its position relative to the quote", () => {
  const body = `<p>reply</p>${SIG}<blockquote type="cite"><p>quoted</p></blockquote>`;
  const { html } = liftSignatures(body, { DOMParser });
  assert.ok(html.indexOf("reply") < html.indexOf(MARK) && html.indexOf(MARK) < html.indexOf("quoted"));
});

test("a signature inside quoted text is left to the quote", () => {
  const body = `<p>hi</p><blockquote type="cite">${SIG}</blockquote>`;
  const { signatures } = liftSignatures(body, { DOMParser });
  assert.deepEqual(signatures, []);
});

test("no signature means nothing changes", () => {
  const { html, signatures } = liftSignatures("<p>hi</p>", { DOMParser });
  assert.equal(html, "<p>hi</p>");
  assert.deepEqual(signatures, []);
});

test("marks are isolated onto their own paragraph", () => {
  assert.equal(isolateMarks(`text ${MARK}0`), `text\n\n${MARK}0\n\n`);
});

test("round trip: markdown is rendered, the signature comes back byte for byte", () => {
  const render = createRenderer();
  const { signatures } = liftSignatures(`<p>x</p>${SIG}`, { DOMParser });
  const text = isolateMarks(`Hello **there**\n${MARK}0`);
  const out = restoreSignatures(render(text), signatures);
  assert.match(out, /<strong>there<\/strong>/);
  assert.ok(out.includes(SIG), "signature HTML is intact");
  assert.doesNotMatch(out, /MDPSIGNATUREMARK|<p>-- /);
});

test("in the sent mail the signature is not restyled or flattened", () => {
  const render = createRenderer();
  const text = isolateMarks(`# Title\n${MARK}0`);
  const mail = restoreSignatures(inlineStyles(render(text), { DOMParser }), [SIG]);
  assert.ok(mail.includes(SIG));
  assert.match(mail, /<h1 style=/);
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { liftProtected, isolateMarks, restoreBlocks, neutralizeForPreview, MARK } from "../lib/protected.js";
import { createRenderer } from "../lib/render.js";
import { inlineStyles } from "../lib/inline.js";

const { DOMParser } = new JSDOM("").window;
const env = { DOMParser };
const SIG = '<div class="moz-signature">-- <br><b>Jane Doe</b><br><a href="https://acme.example">acme</a></div>';
const CITE = '<div class="moz-cite-prefix">On 9/29/26, Bob wrote:<br></div>';
const QUOTE =
  '<blockquote type="cite" cite="mid:x@y"><p>Hi <b>plan</b> <a href="https://a.example">the plan</a></p>-- <br>Bob</blockquote>';

test("a signature is lifted out and replaced by a paragraph placeholder", () => {
  const { html, blocks } = liftProtected(`<p>hello</p>${SIG}`, env);
  assert.deepEqual(blocks, [SIG]);
  assert.equal(html, `<p>hello</p><p>${MARK}0</p>`);
});

test("the cite line and the quoted message are lifted as separate blocks, in order", () => {
  const { html, blocks } = liftProtected(`${CITE}${QUOTE}<p>my reply</p>${SIG}`, env);
  assert.equal(blocks.length, 3);
  assert.match(blocks[0], /moz-cite-prefix/);
  assert.match(blocks[1], /^<blockquote type="cite"/);
  assert.match(blocks[2], /moz-signature/);
  assert.ok(html.includes("my reply"));
  assert.ok(html.indexOf(`${MARK}1`) < html.indexOf("my reply") && html.indexOf("my reply") < html.indexOf(`${MARK}2`));
});

test("a signature inside the quote stays part of the quote", () => {
  const { blocks } = liftProtected(`<blockquote type="cite">${SIG}</blockquote>`, env);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /^<blockquote/);
});

test("inline replies: text between two quote halves stays Markdown", () => {
  const body = `${CITE}<blockquote type="cite"><p>q1</p></blockquote><p>**answer**</p><blockquote type="cite"><p>q2</p></blockquote>`;
  const { html, blocks } = liftProtected(body, env);
  assert.equal(blocks.length, 3);
  assert.match(html, /<p>\*\*answer\*\*<\/p>/);
});

test("forwarded messages are protected", () => {
  const { blocks } = liftProtected('<p>fyi</p><div class="moz-forward-container"><p>-------- Original --------</p></div>', env);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /moz-forward-container/);
});

test("no protected block means nothing changes", () => {
  const { html, blocks } = liftProtected("<p>hi</p>", env);
  assert.equal(html, "<p>hi</p>");
  assert.deepEqual(blocks, []);
});

test("marks are isolated onto their own paragraph", () => {
  assert.equal(isolateMarks(`text ${MARK}0`), `text\n\n${MARK}0\n\n`);
});

test("round trip: markdown is rendered, quote and signature come back byte for byte", () => {
  const render = createRenderer();
  const { blocks } = liftProtected(`${CITE}${QUOTE}<p>x</p>${SIG}`, env);
  const text = isolateMarks(`${MARK}0\n${MARK}1\nMy **reply** here\n${MARK}2`);
  const out = restoreBlocks(render(text), blocks);
  assert.match(out, /<strong>reply<\/strong>/);
  for (const block of blocks) assert.ok(out.includes(block), "block HTML is intact");
  assert.doesNotMatch(out, /MDPSIGNATUREMARK/);
  assert.match(out, /<b>plan<\/b>/, "the quote's bold is still bold");
  assert.doesNotMatch(out, /<em>plan<\/em>/);
});

test("in the sent mail the quote and signature are not restyled or flattened", () => {
  const render = createRenderer();
  const text = isolateMarks(`# Title\n${MARK}0\n${MARK}1`);
  const mail = restoreBlocks(inlineStyles(render(text), env), [QUOTE, SIG]);
  assert.ok(mail.includes(QUOTE));
  assert.ok(mail.includes(SIG));
  assert.match(mail, /<h1 style=/);
});

test("the preview does not load remote images or keep active elements", () => {
  const safe = neutralizeForPreview(
    '<blockquote><img src="https://tracker.example/p.gif"><img src="data:image/png;base64,AAAA"><meta http-equiv="x"><script>1</script></blockquote>',
    env
  );
  assert.doesNotMatch(safe, /tracker\.example|<script|<meta/);
  assert.match(safe, /data:image\/png/);
});

const PNG =
  '<img src="data:image/png;base64,iVBORw0KGgo=" width="40" height="30" alt="shot">';

test("a pasted image is lifted to an inline token and restored where it was", () => {
  const { html, images } = liftProtected(`<p>before ${PNG} after</p>`, env);
  assert.equal(images.length, 1);
  assert.match(images[0], /^<img src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /before MDPIMAGEMARK0 after/);
  const out = restoreBlocks(createRenderer()("before MDPIMAGEMARK0 after"), [], images);
  assert.match(out, /<p>before <img src="data:image\/png;base64,iVBORw0KGgo=" [^>]*> after<\/p>/);
});

test("an image alone on a line survives rendering and inlining", () => {
  const { html, images } = liftProtected(`<p>**hi**</p><p>${PNG}</p>`, env);
  assert.equal(images.length, 1);
  const rendered = inlineStyles(createRenderer()(html.replace(/<\/?p>/g, "\n").trim()), env);
  assert.match(restoreBlocks(rendered, [], images), /<img src="data:image\/png/);
});

test("images in a quote or signature stay inside that block", () => {
  const { blocks, images } = liftProtected(`<blockquote type="cite">${PNG}</blockquote><p>${PNG}</p>`, env);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /<img/);
  assert.equal(images.length, 1);
});

test("no images means no image list", () => {
  assert.deepEqual(liftProtected("<p>hi</p>", env).images, []);
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Keeps everything that is not your own text out of the Markdown pass.
//
// A compose body holds more than what you typed: Thunderbird inserts your signature
// (`.moz-signature`), the "On ... wrote:" line (`.moz-cite-prefix`), the quoted
// message (`blockquote[type=cite]`) and, for inline forwards, the forwarded message
// (`.moz-forward-container`). That is HTML written by someone else, and flattening it
// to text and rendering that as Markdown mangles it (bold turns into italics, links
// are duplicated, "-- " makes a heading). Instead each such block is swapped for a
// placeholder paragraph before the text is extracted, and the original HTML is put
// back untouched after rendering.
//
// Images you paste or insert are handled the same way: the text conversion would drop
// them, so each `<img>` becomes an inline token and is put back where it was.

export const MARK = "MDPSIGNATUREMARK";
export const IMAGE_MARK = "MDPIMAGEMARK";
export const PROTECTED_SELECTOR =
  ".moz-signature, .moz-cite-prefix, blockquote[type=cite], .moz-forward-container";

const MARK_TOKEN = new RegExp(`[ \\t]*${MARK}(\\d+)[ \\t]*`, "g");
const MARK_PARAGRAPH = new RegExp(`<p[^>]*>\\s*${MARK}(\\d+)\\s*</p>`, "g");
const MARK_ANY = new RegExp(`${MARK}(\\d+)`, "g");
const IMAGE_ANY = new RegExp(`${IMAGE_MARK}(\\d+)`, "g");

/**
 * @param {string} bodyHtml compose body from getComposeDetails
 * @param {{ DOMParser?: typeof DOMParser }} [env] injectable for tests
 * @returns {{ html: string, blocks: string[], images: string[], linked: boolean }} body with
 *   each top-level protected block replaced by `<p>MARKn</p>` and each remaining image by the
 *   inline text `IMAGE_MARKn`, plus the original HTML of each by index. Links outside the
 *   blocks become Markdown links (`linked` says whether there were any).
 */
export function liftProtected(bodyHtml, env = {}) {
  const Parser = env.DOMParser || globalThis.DOMParser;
  const doc = new Parser().parseFromString(bodyHtml, "text/html");
  // Only outermost blocks: a signature inside a quote is part of that quote.
  const found = [...doc.body.querySelectorAll(PROTECTED_SELECTOR)].filter(
    (el) => !el.parentElement?.closest(PROTECTED_SELECTOR)
  );
  const blocks = found.map((el) => el.outerHTML);
  found.forEach((el, i) => {
    const marker = doc.createElement("p");
    marker.textContent = `${MARK}${i}`;
    el.replaceWith(marker);
  });
  // Images outside the protected blocks (a pasted screenshot, an inserted picture).
  const images = [...doc.body.querySelectorAll("img")].map((img, i) => {
    const html = img.outerHTML;
    img.replaceWith(doc.createTextNode(`${IMAGE_MARK}${i}`));
    return html;
  });
  const linked = linksToMarkdown(doc);
  return { html: doc.body.innerHTML, blocks, images, linked };
}

/**
 * The text conversion writes a link as "label <url>", which Markdown then shows as the
 * label followed by the URL (for `mailto:` links, "label <mailto:x@y>"). A link whose
 * label differs from its address is rewritten as a Markdown link, so it renders as the
 * label alone. Links that just show their own address are left to the text conversion.
 * @returns {boolean} whether any link was rewritten
 */
function linksToMarkdown(doc) {
  let changed = false;
  for (const a of doc.body.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href").trim();
    const label = a.textContent.replace(/ /g, " ").trim();
    const bare = href.replace(/^mailto:/i, "").replace(/\/$/, "");
    if (!label || !href || label === href || label === bare || href.startsWith("#")) continue;
    const text = label.replace(/([\\[\]])/g, "\\$1");
    const url = href.replace(/[\s()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
    a.replaceWith(doc.createTextNode(`[${text}](${url})`));
    changed = true;
  }
  return changed;
}

/** Puts each placeholder on its own line so Markdown turns it into its own paragraph. */
export function isolateMarks(text) {
  return text.replace(MARK_TOKEN, (_, i) => `\n\n${MARK}${i}\n\n`);
}

/** Replaces the placeholders in rendered HTML with the original block and image HTML. */
export function restoreBlocks(html, blocks, images = []) {
  const block = (i) => blocks[Number(i)] ?? "";
  return html
    .replace(MARK_PARAGRAPH, (_, i) => block(i))
    .replace(MARK_ANY, (_, i) => block(i))
    .replace(IMAGE_ANY, (_, i) => images[Number(i)] ?? "");
}

/**
 * Makes a block safe to show in the preview. Quoted mail can contain remote images
 * (tracking pixels), so those are not loaded, just like Thunderbird's own editor.
 * Used for the preview only: the message that is sent keeps the original block.
 */
export function neutralizeForPreview(blockHtml, env = {}) {
  const Parser = env.DOMParser || globalThis.DOMParser;
  const doc = new Parser().parseFromString(`<body>${blockHtml}</body>`, "text/html");
  for (const el of doc.body.querySelectorAll("script, style, link, meta, base, iframe, object, embed")) {
    el.remove();
  }
  for (const img of doc.body.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (/^(https?:)?\/\//i.test(src)) {
      img.removeAttribute("src");
      img.removeAttribute("srcset");
      img.setAttribute("title", "Remote image not loaded in the preview");
    }
  }
  return doc.body.innerHTML;
}

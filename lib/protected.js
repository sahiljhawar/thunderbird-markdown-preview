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
//
// Your own bold, italic and links (made with Thunderbird's toolbar or shortcuts, or pasted)
// are rewritten as Markdown before the text conversion, which would otherwise mangle them.

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
 * @returns {{ html: string, blocks: string[], images: string[], rewritten: boolean }} body with
 *   each top-level protected block replaced by `<p>MARKn</p>` and each remaining image by the
 *   inline text `IMAGE_MARKn`, plus the original HTML of each by index. Formatting and links
 *   outside the blocks become Markdown (`rewritten` says whether there were any).
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
  // Formatting first, so a bold link keeps its bold inside the link text.
  const formatted = formattingToMarkdown(doc);
  const linked = linksToMarkdown(doc);
  return { html: doc.body.innerHTML, blocks, images, rewritten: formatted || linked };
}

// The text conversion writes bold as *x* (which Markdown shows in italics), italic as /x/
// and underline as _x_ (italics again). Bold and italic become their Markdown form instead.
// Markdown has no underline, so underlined text is left plain.
const FORMATTING = [
  ["b, strong", "**"],
  ["i, em", "*"],
  ["u", ""],
];
const LINE_BREAKING = "br, p, div, li, ul, ol, table, pre, blockquote, h1, h2, h3, h4, h5, h6, hr";

/**
 * Rewrites bold and italic elements as Markdown markers around their content. Whitespace at
 * the edges moves outside the markers, which Markdown needs. An element spanning several lines,
 * or nested in one of its own kind, keeps its text but loses the formatting.
 * @returns {boolean} whether anything was rewritten
 */
function formattingToMarkdown(doc) {
  let changed = false;
  for (const [selector, marker] of FORMATTING) {
    const elements = [...doc.body.querySelectorAll(selector)];
    const nested = new Set(elements.filter((el) => el.parentElement?.closest(selector)));
    for (const el of elements) {
      const text = el.textContent;
      const wrap = marker && text.trim() && !nested.has(el) && !el.querySelector(LINE_BREAKING);
      if (!wrap) {
        el.replaceWith(...el.childNodes);
      } else {
        const lead = trimEdge(doc, el, text.match(/^\s*/)[0].length, true);
        const trail = trimEdge(doc, el, text.match(/\s*$/)[0].length, false);
        el.replaceWith(lead, marker, ...el.childNodes, marker, trail);
      }
      changed = true;
    }
  }
  return changed;
}

/** Removes `count` characters from the start (or end) of the text inside `el` and returns them. */
function trimEdge(doc, el, count, fromStart) {
  const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  for (let n; (n = walker.nextNode()); ) nodes.push(n);
  if (!fromStart) nodes.reverse();
  let taken = "";
  for (const node of nodes) {
    if (taken.length === count) break;
    const take = Math.min(count - taken.length, node.data.length);
    if (fromStart) {
      taken += node.data.slice(0, take);
      node.data = node.data.slice(take);
    } else {
      taken = node.data.slice(node.data.length - take) + taken;
      node.data = node.data.slice(0, node.data.length - take);
    }
  }
  return taken;
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

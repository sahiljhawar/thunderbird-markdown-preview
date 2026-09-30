// SPDX-License-Identifier: GPL-3.0-or-later
// Keeps Thunderbird's signature out of the Markdown pass. The signature is HTML
// (`<div class="moz-signature">`); flattening it to text and rendering that would
// lose its bold, links and images. Instead it is swapped for a placeholder
// paragraph before conversion and put back, untouched, after rendering.

export const MARK = "MDPSIGNATUREMARK";
const MARK_TOKEN = new RegExp(`[ \\t]*${MARK}(\\d+)[ \\t]*`, "g");
const MARK_PARAGRAPH = new RegExp(`<p[^>]*>\\s*${MARK}(\\d+)\\s*</p>`, "g");
const MARK_ANY = new RegExp(`${MARK}(\\d+)`, "g");

/**
 * @param {string} bodyHtml compose body from getComposeDetails
 * @param {{ DOMParser?: typeof DOMParser }} [env] injectable for tests
 * @returns {{ html: string, signatures: string[] }} body with each signature replaced
 *   by `<p>MARKn</p>`, and the original signature HTML by index
 */
export function liftSignatures(bodyHtml, env = {}) {
  const Parser = env.DOMParser || globalThis.DOMParser;
  const doc = new Parser().parseFromString(bodyHtml, "text/html");
  const found = [...doc.body.querySelectorAll(".moz-signature")].filter(
    (el) =>
      // A signature inside quoted text belongs to the person being quoted.
      !el.closest("blockquote[type=cite]") &&
      !el.parentElement?.closest(".moz-signature")
  );
  const signatures = found.map((el) => el.outerHTML);
  found.forEach((el, i) => {
    const marker = doc.createElement("p");
    marker.textContent = `${MARK}${i}`;
    el.replaceWith(marker);
  });
  return { html: doc.body.innerHTML, signatures };
}

/** Puts each placeholder on its own line so Markdown turns it into its own paragraph. */
export function isolateMarks(text) {
  return text.replace(MARK_TOKEN, (_, i) => `\n\n${MARK}${i}\n\n`);
}

/** Replaces the placeholders in rendered HTML with the original signature HTML. */
export function restoreSignatures(html, signatures) {
  const sig = (i) => signatures[Number(i)] ?? "";
  return html.replace(MARK_PARAGRAPH, (_, i) => sig(i)).replace(MARK_ANY, (_, i) => sig(i));
}

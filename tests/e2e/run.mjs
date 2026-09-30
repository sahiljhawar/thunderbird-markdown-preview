// SPDX-License-Identifier: GPL-3.0-or-later
// End-to-end check against a real (headless) Thunderbird: installs the add-on as a
// temporary add-on and drives compose windows. Run: npm run e2e
// Optional: E2E_SHOT=path.png saves a screenshot of the main compose window.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { createProfile } from "./profile.mjs";
import { Marionette } from "../../scripts/marionette.mjs";

const root = resolve(import.meta.dirname, "../..");
const profile = createProfile(resolve(root, "tbtest/profile"));
const outbox = join(profile, "Mail", "Local Folders", "Unsent Messages");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tb = spawn(
  process.env.THUNDERBIRD || "thunderbird",
  ["--headless", "--no-remote", "--profile", profile, "--marionette", "-remote-allow-system-access"],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MOZ_HEADLESS: "1" } }
);
let log = "";
tb.stdout.on("data", (d) => (log += d));
tb.stderr.on("data", (d) => (log += d));

const WIN = `const win = Services.wm.getMostRecentWindow("msgcompose"); `;
const BUTTON = `const b = win.document.querySelector('[id*="composeAction"]');`;
const PANE_ON = `win.document.getElementById("messageArea").classList.contains("mdp-on")`;
let m;

async function waitFor(what, script, { timeout = 15000, args = [] } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await m.run(script, args).catch((e) => `error: ${e.message}`);
    if (last) return last;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

async function openCompose({ plain = false } = {}) {
  await m.run(
    `const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
     const params = Cc["@mozilla.org/messengercompose/composeparams;1"].createInstance(Ci.nsIMsgComposeParams);
     const fields = Cc["@mozilla.org/messengercompose/composefields;1"].createInstance(Ci.nsIMsgCompFields);
     fields.to = "someone@example.invalid";
     fields.subject = "e2e";
     params.type = Ci.nsIMsgCompType.New;
     params.format = arguments[0] ? Ci.nsIMsgCompFormat.PlainText : Ci.nsIMsgCompFormat.HTML;
     params.composeFields = fields;
     params.identity = MailServices.accounts.allIdentities[0];
     MailServices.compose.OpenComposeWindowWithParams(null, params);
     return true;`,
    [plain]
  );
  await waitFor("compose editor", WIN + `return !!win?.document.getElementById("messageEditor")?.contentDocument?.body;`);
  await waitFor("pane", WIN + `return !!win.document.getElementById("mdp-frame")?.contentDocument?.getElementById("mdp-css");`);
  // The pane's layout is applied only after the editor has settled (about 0.4s of quiet).
  await waitFor("pane to settle", WIN + `return win.document.getElementById("mdp-pane")?.dataset.state === "settled";`);
}

const typeText = (text) =>
  m.run(WIN + `const ed = win.GetCurrentEditor(); ed.selectAll(); ed.deleteSelection(0, 0); ed.insertText(arguments[0]);`, [text]);

const previewHtml = () =>
  m.run(WIN + `return win.document.getElementById("mdp-frame").contentDocument.body.innerHTML;`);

const paneWidth = () =>
  m.run(WIN + `return win.document.getElementById("mdp-pane").getBoundingClientRect().width;`);

const editorWidth = () =>
  m.run(WIN + `return win.document.getElementById("messageEditor").getBoundingClientRect().width;`);

/** Messages currently in the Unsent Messages folder, quoted-printable decoded. */
function readOutbox() {
  if (!existsSync(outbox)) return [];
  return readFileSync(outbox, "latin1")
    .split(/^From - .*$/m)
    .filter((part) => part.trim())
    .map((part) =>
      part.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    );
}

async function sendLaterAndWait(expectedCount) {
  await m.run(WIN + `win.goDoCommand("cmd_sendLater"); return true;`);
  const end = Date.now() + 20000;
  while (readOutbox().length < expectedCount && Date.now() < end) await sleep(300);
  assert.equal(readOutbox().length, expectedCount, `outbox should hold ${expectedCount} message(s)`);
  return readOutbox().at(-1);
}

const clickToggle = () => m.run(WIN + BUTTON + `b.click(); return true;`);
const step = (name) => console.log(`- ${name}`);

try {
  m = await Marionette.connect({ timeoutMs: 90000 });
  await m.newSession();
  await m.setContext("chrome");

  step("install temporary add-on");
  const { value: addonId } = await m.installTemporaryAddon(root);
  console.log("  installed:", addonId);

  // ---- 1. HTML compose: pane, live preview, send ---------------------------------------
  step("open an HTML compose window");
  await openCompose();

  step("pane sits to the right of a full-size editor");
  await waitFor("pane visible after the editor settled", WIN + `return ${PANE_ON};`);
  const layout = await m.run(
    WIN + `const r = (id) => { const b = win.document.getElementById(id).getBoundingClientRect(); return { x: b.x, w: b.width, h: b.height }; };
           return { editor: r("messageEditor"), pane: r("mdp-pane"), handle: r("mdp-handle") };`
  );
  console.log("  layout:", JSON.stringify(layout));
  assert.ok(layout.pane.w > 200 && layout.pane.h > 100, "pane has a real size");
  assert.ok(layout.editor.w > 200 && layout.editor.h > 100, "editor keeps a real size");
  assert.ok(layout.pane.x >= layout.editor.x + layout.editor.w - 1, "pane is right of the editor");

  step("typing Markdown updates the preview live");
  await typeText(
    [
      "# Big title", "", "Some **bold** and `code`.", "",
      "| a | b |", "|---|---|", "| 1 | 2 |", "",
      "- [x] done", "- [ ] todo", "",
      "```js", "const a = 1;", "```", "",
      "> [!NOTE]", "> heads up", "", "-- ", "Sig Name",
    ].join("\n")
  );
  await waitFor("rendered preview", WIN + `const h = win.document.getElementById("mdp-frame").contentDocument.body.innerHTML;
    return h.includes("Big title") && h.includes("heads up");`);
  const html = await previewHtml();
  assert.match(html, /<h1>Big title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /task-list-item/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /markdown-alert-note/);
  assert.match(html, /mdp-signature/);
  assert.equal((html.match(/<pre/g) || []).length, 1, "one <pre> for the fence");

  await m.run(WIN + `win.GetCurrentEditor().insertText("\\n\\nappended-line");`);
  await waitFor("appended text", WIN + `return win.document.getElementById("mdp-frame").contentDocument.body.innerHTML.includes("appended-line");`);

  if (process.env.E2E_SHOT) {
    const png = await m.run(
      WIN + `const w = win.innerWidth, h = win.innerHeight;
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawWindow(win, 0, 0, w, h, "white");
      return canvas.toDataURL("image/png");`
    );
    writeFileSync(process.env.E2E_SHOT, Buffer.from(png.split(",")[1], "base64"));
    console.log("  screenshot:", process.env.E2E_SHOT);
  }

  step("dragging the handle resizes the pane");
  const before = await paneWidth();
  await m.run(
    WIN + `const h = win.document.getElementById("mdp-handle");
      const rect = win.document.getElementById("messageArea").getBoundingClientRect();
      const ev = (type, x) => new win.PointerEvent(type, { clientX: x, clientY: 100, button: 0, pointerId: 1, bubbles: true, cancelable: true });
      h.dispatchEvent(ev("pointerdown", h.getBoundingClientRect().x));
      h.dispatchEvent(ev("pointermove", rect.right - 300));
      h.dispatchEvent(ev("pointerup", rect.right - 300));
      return true;`
  );
  const after = await paneWidth();
  console.log(`  pane width: ${before} -> ${after}`);
  assert.equal(Math.round(after), 300, "pane follows the pointer");

  step("toggle button hides and shows the pane");
  const buttonId = await m.run(WIN + BUTTON + `return b ? b.id : null;`);
  assert.ok(buttonId, "compose action button exists");
  await clickToggle();
  await waitFor("pane hidden", WIN + `return !${PANE_ON};`);
  assert.ok((await editorWidth()) > layout.editor.w, "editor reclaims the width when the pane is hidden");
  await clickToggle();
  await waitFor("pane visible", WIN + `return ${PANE_ON};`);

  step("Send Later stores rendered, inline-styled HTML with a plain-text part");
  const sent = await sendLaterAndWait(1);
  assert.match(sent, /<h1\s+style="[^"]*border-bottom/, "heading is inline-styled");
  assert.match(sent, /<table\s+style=/, "table is inline-styled");
  assert.match(sent, /color:#cf222e/, "code token is colored");
  assert.match(sent, /Content-Type: text\/plain/, "plain-text alternative present");
  const htmlPart = sent.slice(sent.indexOf("Content-Type: text/html"));
  assert.doesNotMatch(htmlPart, /# Big title|\*\*bold\*\*/, "raw markdown is not in the HTML part");
  assert.equal((htmlPart.match(/<pre/g) || []).length, 1, "code block is wrapped in exactly one <pre>");
  assert.doesNotMatch(htmlPart, /mdp-|<style/, "no pane markup or <style> leaks into the message");
  writeFileSync(join(root, "tbtest", "sent.eml"), sent);

  // ---- 2. Toggle off: message goes out untouched ----------------------------------------
  step("with Markdown off, the message is sent as written");
  await openCompose();
  await typeText("# Untouched heading\n\nplain **words**");
  await waitFor("preview", WIN + `return win.document.getElementById("mdp-frame").contentDocument.body.innerHTML.includes("Untouched");`);
  await clickToggle();
  await waitFor("pane hidden", WIN + `return !${PANE_ON};`);
  const untouched = await sendLaterAndWait(2);
  // Thunderbird downgrades unformatted HTML to plain text on its own, so check the whole message.
  assert.match(untouched, /# Untouched heading/, "raw markdown text is kept");
  assert.doesNotMatch(untouched, /<h1|border-bottom/, "nothing was rendered");

  // ---- 2b. "Only Plain Text" delivery must not undo the rendering ----------------------
  step("plain-text delivery format is overridden so the rendered HTML survives");
  await openCompose();
  if (!(await m.run(WIN + `return ${PANE_ON};`))) await clickToggle();
  await waitFor("pane visible", WIN + `return ${PANE_ON};`);
  await m.run(WIN + `win.gMsgCompose.compFields.deliveryFormat = Ci.nsIMsgCompSendFormat.PlainText; return true;`);
  await typeText("## Delivery check\n\n*emphasis*");
  await waitFor("preview", WIN + `return win.document.getElementById("mdp-frame").contentDocument.body.innerHTML.includes("Delivery check");`);
  const delivered = await sendLaterAndWait(3);
  assert.match(delivered, /<h2\s+style=/, "rendered HTML was sent despite plain-text delivery format");

  // ---- 2c. HTML signature keeps its formatting ------------------------------------------
  step("an HTML signature is kept as HTML, not flattened by Markdown");
  writeFileSync(
    join(root, "tbtest", "sig.html"),
    '<b>Jane Doe</b><br>Acme Corp<br><a href="https://acme.example">acme.example</a>'
  );
  await m.run(
    `const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
     const id = MailServices.accounts.allIdentities[0];
     const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
     f.initWithPath(arguments[0]);
     id.signature = f; id.htmlSigFormat = true; id.attachSignature = true;
     return true;`,
    [join(root, "tbtest", "sig.html")]
  );
  await openCompose();
  if (!(await m.run(WIN + `return ${PANE_ON};`))) await clickToggle();
  await waitFor("signature in editor", WIN + `return !!win.document.getElementById("messageEditor").contentDocument.querySelector(".moz-signature");`);
  await m.run(WIN + `const ed = win.GetCurrentEditor(); ed.beginningOfDocument(); ed.insertText("Hello **there**"); return true;`);
  const sigPreview = await waitFor("preview with signature", WIN + `const h = win.document.getElementById("mdp-frame").contentDocument.body.innerHTML;
    return h.includes("there") && h.includes("moz-signature") ? h : null;`);
  assert.match(sigPreview, /<strong>there<\/strong>/);
  assert.match(sigPreview, /<b>Jane Doe<\/b>/, "signature bold survives in the preview");
  assert.match(sigPreview, /<a href="https:\/\/acme\.example">acme\.example<\/a>/, "signature link survives in the preview");
  assert.doesNotMatch(sigPreview, /\*Jane Doe\*|&lt;https/, "signature was not flattened to text");
  const withSig = await sendLaterAndWait(4);
  const sigHtml = withSig.slice(withSig.indexOf("Content-Type: text/html"));
  assert.match(sigHtml, /<strong[^>]*>there<\/strong>/, "message text is rendered");
  assert.match(sigHtml, /<b>Jane Doe<\/b>/, "signature bold survives in the sent mail");
  assert.match(sigHtml, /<a href="https:\/\/acme\.example">acme\.example<\/a>/, "signature link survives in the sent mail");
  assert.doesNotMatch(sigHtml, /\*Jane Doe\*|MDPSIGNATUREMARK/);
  await m.run(
    `const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
     MailServices.accounts.allIdentities[0].attachSignature = false; return true;`
  );

  // ---- 2d. Regression: the pane must not disturb signature insertion -----------------------
  // Resizing the editor while Thunderbird was still building a new message made it drop or
  // misplace the signature, intermittently. Open several windows and check each one.
  step("signature is inserted correctly, and editable, in every new window");
  await m.run(
    `const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
     const id = MailServices.accounts.allIdentities[0];
     id.attachSignature = true; return true;`
  );
  const RUNS = 8;
  for (let i = 0; i < RUNS; i++) {
    await openCompose();
    await sleep(1800); // beyond the settle window, so the layout change has happened
    const state = await m.run(
      WIN + `const doc = win.document.getElementById("messageEditor").contentDocument;
        const ed = win.GetCurrentEditor();
        const before = [...doc.body.children].map((c) => c.nodeName + (c.className ? "." + c.className : "")).join(",");
        ed.insertText("typed");
        const sig = doc.querySelector(".moz-signature");
        // Really edit inside the signature (isContentEditable is unreliable in some versions).
        const bold = sig?.querySelector("b");
        if (bold) { ed.selection.collapse(bold.firstChild, 2); ed.insertText("ZZ"); }
        return { before, first: doc.body.firstElementChild?.textContent,
                 editable: !!bold && bold.textContent === "JaZZne Doe",
                 pane: ${PANE_ON}, sigHtml: sig?.innerHTML ?? null };`
    );
    assert.equal(state.before, "P,DIV.moz-signature", `window ${i + 1}: paragraph first, then the signature (got ${state.before})`);
    assert.equal(state.first, "typed", `window ${i + 1}: typed text lands above the signature`);
    assert.ok(state.editable, `window ${i + 1}: signature is editable`);
    assert.match(state.sigHtml, /<b>JaZZne Doe<\/b>/, `window ${i + 1}: signature content intact (and edited)`);
    assert.ok(state.pane, `window ${i + 1}: pane is showing`);
    await m.run(WIN + `win.gContentChanged = false; win.close(); return true;`);
    await sleep(600);
  }
  console.log(`  ${RUNS} windows OK`);
  await m.run(
    `const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
     MailServices.accounts.allIdentities[0].attachSignature = false; return true;`
  );

  // ---- 3. Plain-text compose: warn and refuse to send raw markdown ---------------------
  step("plain-text compose shows a warning and cancels the send");
  await openCompose({ plain: true });
  // The last toggle choice (off) is remembered for new windows: switch it on again.
  if (!(await m.run(WIN + `return ${PANE_ON};`))) await clickToggle();
  await waitFor("pane visible", WIN + `return ${PANE_ON};`);
  await typeText("# Plain mode\n\ntext");
  const status = await waitFor("plain-text warning", WIN + `const s = win.document.getElementById("mdp-status"); return s.hidden ? null : s.textContent;`);
  console.log("  status:", status);
  assert.match(status, /Plain-text message/);
  await m.run(WIN + `win.goDoCommand("cmd_sendLater"); return true;`);
  await sleep(2500);
  assert.equal(readOutbox().length, 4, "send was cancelled, nothing new in the outbox");
  assert.ok(await m.run(WIN + `return !!win;`), "compose window is still open");

  // ---- 4. Removing the add-on cleans the window ---------------------------------------
  step("removing the add-on cleans the compose window");
  await m.send("Addon:Uninstall", { id: addonId });
  await waitFor(
    "pane removed",
    WIN + `return !win.document.getElementById("mdp-pane") && !win.document.getElementById("mdp-style") && !${PANE_ON};`
  );
  assert.ok((await editorWidth()) > layout.editor.w + layout.pane.w / 2, "editor is full width again");

  console.log("\nE2E OK");
} catch (e) {
  console.error("\nE2E FAILED:", e.stack || e);
  try {
    const wins = await m.run(
      `return [...Services.wm.getEnumerator("msgcompose")].map((w) => ({
         closed: w.closed, pane: !!w.document.getElementById("mdp-pane"), paneState: w.document.getElementById("mdp-pane")?.dataset.state,
         subject: w.document.getElementById("msgSubject")?.value, readyState: w.document.readyState,
         editorUrl: w.document.getElementById("messageEditor")?.contentDocument?.location?.href,
         frameCss: !!w.document.getElementById("mdp-frame")?.contentDocument?.getElementById("mdp-css"),
         on: w.document.getElementById("messageArea")?.classList.contains("mdp-on"),
         ready: w.composeEditorReady, body: w.document.getElementById("messageEditor")?.contentDocument?.body?.innerHTML?.slice(0, 100) }));`
    );
    console.error("compose windows at failure:", JSON.stringify(wins));
    await sleep(6000);
    console.error("compose windows 6s later:", JSON.stringify(await m.run(`return [...Services.wm.getEnumerator("msgcompose")].map((w) => ({ paneState: w.document.getElementById("mdp-pane")?.dataset.state, on: w.document.getElementById("messageArea")?.classList.contains("mdp-on"), frameCss: !!w.document.getElementById("mdp-frame")?.contentDocument?.getElementById("mdp-css") }));`)));
    const messages = await m.run(
      `return Services.console.getMessageArray().map((x) => String(x.message ?? x)).filter((t) => /mdpane|Markdown/.test(t)).slice(-10);`
    );
    console.error("extension messages:", JSON.stringify(messages));
  } catch {
    // Marionette may be gone already.
  }
  console.error("--- TB log (filtered) ---\n" + log.split("\n").filter((l) => !/Gtk|gtk|loadSheet|^\s*$/.test(l)).slice(-40).join("\n"));
  process.exitCode = 1;
} finally {
  m?.close();
  tb.kill();
}

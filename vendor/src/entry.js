// SPDX-License-Identifier: GPL-3.0-or-later
// Bundled by scripts/vendor.sh into ../markdown.js (ESM). Do not edit the output.
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import { full as emoji } from "markdown-it-emoji";
import hljs from "highlight.js/lib/core";

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const languages = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json,
  kotlin, markdown, php, plaintext, python, ruby, rust, shell, sql, swift,
  typescript, xml, yaml,
};
for (const [name, def] of Object.entries(languages)) hljs.registerLanguage(name, def);

const aliases = {
  sh: "bash", zsh: "bash", console: "shell", js: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", py: "python", rb: "ruby", rs: "rust",
  yml: "yaml", html: "xml", svg: "xml", toml: "ini", md: "markdown",
  "c++": "cpp", "c#": "csharp", cs: "csharp", kt: "kotlin", patch: "diff",
  text: "plaintext", txt: "plaintext",
};
for (const [alias, target] of Object.entries(aliases)) hljs.registerAliases(alias, { languageName: target });

export { MarkdownIt, taskLists, footnote, emoji, hljs };

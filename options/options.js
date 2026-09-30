// SPDX-License-Identifier: GPL-3.0-or-later
import { DEFAULTS, getSettings, setSettings } from "../lib/settings.js";

const form = document.getElementById("form");
const fields = Object.keys(DEFAULTS).map((key) => document.getElementById(key));

const value = (el) => (el.type === "checkbox" ? el.checked : Number(el.value));

const settings = await getSettings();
for (const el of fields) {
  if (el.type === "checkbox") el.checked = settings[el.id];
  else el.value = settings[el.id];
}

form.addEventListener("change", (event) => {
  const el = event.target;
  if (!DEFAULTS.hasOwnProperty(el.id) || (el.type === "number" && !el.reportValidity())) return;
  setSettings({ [el.id]: value(el) });
});

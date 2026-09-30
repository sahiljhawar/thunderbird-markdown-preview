// SPDX-License-Identifier: GPL-3.0-or-later
// Throwaway Thunderbird profile with a Local Folders account and one identity,
// so a compose window can open and "Send Later" works without any network.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createProfile(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "Mail", "Local Folders"), { recursive: true });
  const prefs = {
    "mail.accountmanager.accounts": "account1",
    "mail.accountmanager.defaultaccount": "account1",
    "mail.accountmanager.localfoldersserver": "server1",
    "mail.account.account1.server": "server1",
    "mail.account.account1.identities": "id1",
    "mail.identity.id1.fullName": "E2E Tester",
    "mail.identity.id1.useremail": "e2e@example.invalid",
    "mail.identity.id1.compose_html": true,
    "mail.identity.id1.attach_signature": false,
    "mail.identity.id1.smtpServer": "",
    "mail.server.server1.type": "none",
    "mail.server.server1.hostname": "Local Folders",
    "mail.server.server1.userName": "nobody",
    "mail.server.server1.name": "Local Folders",
    "mail.server.server1.directory": join(dir, "Mail", "Local Folders"),
    "mail.provider.suppress_dialog_on_startup": true,
    "mail.spotlight.firstRunDone": true,
    "mail.shell.checkDefaultClient": false,
    "mail.startup.enabledMailCheckOnce": true,
    "mailnews.start_page.enabled": false,
    "mail.warn_on_send_accel_key": false,
    "mail.compose.attachment_reminder": false,
    "mailnews.sendformat.auto_downgrade": false,
    "app.update.enabled": false,
    "datareporting.policy.dataSubmissionEnabled": false,
    "toolkit.telemetry.reportingpolicy.firstRun": false,
    "extensions.autoDisableScopes": 0,
    "extensions.experiments.enabled": true,
    "marionette.port": 2828,
  };
  const user = Object.entries(prefs)
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join("\n");
  writeFileSync(join(dir, "user.js"), user + "\n");
  return dir;
}

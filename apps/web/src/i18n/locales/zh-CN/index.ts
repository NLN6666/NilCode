// FILE: locales/zh-CN/index.ts
// Purpose: Assemble the Simplified Chinese catalog against the Messages contract.

import type { Messages } from "../en";
import { automations } from "./automations";
import { browser } from "./browser";
import { chat } from "./chat";
import { diff } from "./diff";
import { git } from "./git";
import { pullRequests } from "./pullRequests";
import { settings } from "./settings";
import { sidebar } from "./sidebar";
import { settingsNav } from "./settingsNav";

export const zhCN: Messages = {
  automations,
  browser,
  chat,
  diff,
  git,
  pullRequests,
  settings,
  settingsNav,
  sidebar,
};

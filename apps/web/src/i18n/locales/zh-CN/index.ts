// FILE: locales/zh-CN/index.ts
// Purpose: Assemble the Simplified Chinese catalog against the Messages contract.

import type { Messages } from "../en";
import { automations } from "./automations";
import { browser } from "./browser";
import { chat } from "./chat";
import { git } from "./git";
import { settings } from "./settings";
import { sidebar } from "./sidebar";
import { settingsNav } from "./settingsNav";

export const zhCN: Messages = {
  automations,
  browser,
  chat,
  git,
  settings,
  settingsNav,
  sidebar,
};

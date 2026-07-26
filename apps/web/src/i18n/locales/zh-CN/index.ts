// FILE: locales/zh-CN/index.ts
// Purpose: Assemble the Simplified Chinese catalog against the Messages contract.

import type { Messages } from "../en";
import { automations } from "./automations";
import { chat } from "./chat";
import { settings } from "./settings";
import { sidebar } from "./sidebar";
import { settingsNav } from "./settingsNav";

export const zhCN: Messages = {
  automations,
  chat,
  settings,
  settingsNav,
  sidebar,
};

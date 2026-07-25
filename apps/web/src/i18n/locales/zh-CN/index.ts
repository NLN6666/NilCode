// FILE: locales/zh-CN/index.ts
// Purpose: Assemble the Simplified Chinese catalog against the Messages contract.

import type { Messages } from "../en";
import { settings } from "./settings";
import { sidebar } from "./sidebar";
import { settingsNav } from "./settingsNav";

export const zhCN: Messages = {
  settings,
  settingsNav,
  sidebar,
};

// FILE: locales/en/index.ts
// Purpose: Assemble the English catalog and derive the Messages contract every locale implements.

import { automations } from "./automations";
import { browser } from "./browser";
import { chat } from "./chat";
import { git } from "./git";
import { settings } from "./settings";
import { sidebar } from "./sidebar";
import { settingsNav } from "./settingsNav";

export const en = {
  automations,
  browser,
  chat,
  git,
  settings,
  settingsNav,
  sidebar,
};

/** Structural contract for every locale catalog. Adding a key here obligates all translations. */
export type Messages = typeof en;

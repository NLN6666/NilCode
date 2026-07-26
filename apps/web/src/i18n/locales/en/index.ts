// FILE: locales/en/index.ts
// Purpose: Assemble the English catalog and derive the Messages contract every locale implements.

import { automations } from "./automations";
import { chat } from "./chat";
import { settings } from "./settings";
import { sidebar } from "./sidebar";
import { settingsNav } from "./settingsNav";

export const en = {
  automations,
  chat,
  settings,
  settingsNav,
  sidebar,
};

/** Structural contract for every locale catalog. Adding a key here obligates all translations. */
export type Messages = typeof en;

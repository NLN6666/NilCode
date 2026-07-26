// FILE: locales/en/index.ts
// Purpose: Assemble the English catalog and derive the Messages contract every locale implements.

import { automations } from "./automations";
import { browser } from "./browser";
import { chat } from "./chat";
import { composer } from "./composer";
import { diff } from "./diff";
import { git } from "./git";
import { pullRequests } from "./pullRequests";
import { projectTools } from "./projectTools";
import { settings } from "./settings";
import { sidebar } from "./sidebar";
import { settingsNav } from "./settingsNav";

export const en = {
  automations,
  browser,
  chat,
  composer,
  diff,
  git,
  pullRequests,
  projectTools,
  settings,
  settingsNav,
  sidebar,
};

/** Structural contract for every locale catalog. Adding a key here obligates all translations. */
export type Messages = typeof en;

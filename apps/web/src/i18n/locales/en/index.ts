// FILE: locales/en/index.ts
// Purpose: Assemble the English catalog and derive the Messages contract every locale implements.

import { app } from "./app";
import { automations } from "./automations";
import { browser } from "./browser";
import { chat } from "./chat";
import { composer } from "./composer";
import { dialogs } from "./dialogs";
import { diff } from "./diff";
import { editor } from "./editor";
import { git } from "./git";
import { pullRequests } from "./pullRequests";
import { projectTools } from "./projectTools";
import { settings } from "./settings";
import { sidebar } from "./sidebar";
import { workspace } from "./workspace";
import { settingsNav } from "./settingsNav";

export const en = {
  app,
  automations,
  browser,
  chat,
  composer,
  dialogs,
  diff,
  editor,
  git,
  pullRequests,
  projectTools,
  settings,
  settingsNav,
  sidebar,
  workspace,
};

/** Structural contract for every locale catalog. Adding a key here obligates all translations. */
export type Messages = typeof en;

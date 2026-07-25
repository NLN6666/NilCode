// FILE: locales/en/index.ts
// Purpose: Assemble the English catalog and derive the Messages contract every locale implements.

import { settings } from "./settings";

export const en = {
  settings,
};

/** Structural contract for every locale catalog. Adding a key here obligates all translations. */
export type Messages = typeof en;

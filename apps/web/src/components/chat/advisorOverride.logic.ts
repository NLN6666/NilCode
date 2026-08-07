// FILE: advisorOverride.logic.ts
// Purpose: Map a thread's advisor override to and from the menu's radio value.
// Layer: Chat presentation helpers
//
// Three states, and the third one is the reason this needs care: "follow the
// global default" is `null`, not an absent field. `thread.meta.update` treats
// an absent field as "leave it alone", so clearing an override has to send an
// explicit null - otherwise a thread that once opted out could never go back to
// tracking the default.

import type { AdvisorThreadOverride } from "@synara/contracts";

export type AdvisorOverrideValue = "default" | "on" | "off";

export function advisorOverrideValue(
  override: AdvisorThreadOverride | undefined,
): AdvisorOverrideValue {
  if (override === true) {
    return "on";
  }
  if (override === false) {
    return "off";
  }
  return "default";
}

/** Returns null for a value that is not one of the three options. */
export function parseAdvisorOverrideValue(
  value: string,
): { readonly advisorEnabled: AdvisorThreadOverride } | null {
  switch (value) {
    case "default":
      return { advisorEnabled: null };
    case "on":
      return { advisorEnabled: true };
    case "off":
      return { advisorEnabled: false };
    default:
      return null;
  }
}

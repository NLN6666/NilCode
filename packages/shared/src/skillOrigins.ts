// FILE: skillOrigins.ts
// Purpose: Single source of truth for which skills folders each provider actually loads.
//          Server discovery walks these origins to build a provider's roots; Settings uses
//          the reverse map to say which providers a given skill reaches. Keeping both on one
//          table is what stops the UI from claiming a skill is available to an agent that
//          never reads that folder.
// Layer: Shared runtime utility
// Exports: SkillOrigin, SkillHomeOrigin, SKILL_HOME_ORIGIN_ORDER, PROVIDER_SKILL_ORIGINS,
//          UNIVERSAL_SKILL_ORIGINS, skillOriginsForProvider, providersForSkillOrigin,
//          skillNameKey

import type { ProviderKind } from "@synara/contracts";
import { PROVIDER_DESCRIPTORS } from "./providerMetadata";

const ALL_PROVIDERS: readonly ProviderKind[] = PROVIDER_DESCRIPTORS.map(
  (descriptor) => descriptor.kind,
);

/**
 * Home-directory skill folders, in the order Settings lists them. `factory` is Factory
 * Droid's folder (`~/.factory/skills`) — the origin is named after the directory, not the
 * `ProviderKind`, because that is what users see on disk.
 */
export const SKILL_HOME_ORIGIN_ORDER = [
  "synara",
  "codex",
  "claude",
  "cursor",
  "grok",
  "factory",
  "kilo",
  "opencode",
  "pi",
  "agents",
] as const;
export type SkillHomeOrigin = (typeof SKILL_HOME_ORIGIN_ORDER)[number];

/** Home origins plus the per-workspace folders discovery labels `project`. */
export type SkillOrigin = SkillHomeOrigin | "project";

/**
 * The folders each agent actually reads, native folder first. Cross-provider entries are
 * deliberate and reflect real CLI behavior (Grok and Kilo read Claude's folder, Droid and
 * Cursor read several) — they are not a Synara convenience. Anything absent from a
 * provider's list is invisible to it, so adding an entry here claims that the agent will
 * genuinely load skills from that folder.
 */
export const PROVIDER_SKILL_ORIGINS = {
  codex: ["codex", "agents"],
  claudeAgent: ["claude"],
  cursor: ["cursor", "agents", "claude", "codex"],
  antigravity: ["agents"],
  grok: ["grok", "claude", "agents"],
  droid: ["factory", "agents", "claude", "codex"],
  kilo: ["kilo", "agents", "claude"],
  opencode: ["opencode", "claude", "agents"],
  omp: [],
  pi: ["pi", "agents"],
} as const satisfies Record<ProviderKind, readonly SkillHomeOrigin[]>;

/**
 * Origins every provider sees. `synara` is Synara's own portable folder, which it injects
 * into whichever agent is running; `project` covers the per-workspace folders, which are
 * scanned for every provider in that workspace.
 */
export const UNIVERSAL_SKILL_ORIGINS: readonly SkillOrigin[] = ["synara", "project"];

/**
 * Every home origin a provider loads from, native folders first and the portable Synara
 * folder last. `project` is excluded because project roots are derived from the workspace
 * cwd rather than the home dir; callers add them separately.
 */
export function skillOriginsForProvider(provider: ProviderKind): SkillHomeOrigin[] {
  const native = PROVIDER_SKILL_ORIGINS[provider];
  return native.includes("synara" as never) ? [...native] : [...native, "synara"];
}

/**
 * Which providers can load a skill found in `origin`. Unknown origins resolve to no
 * provider rather than to all of them: an origin Synara does not recognize is one no
 * agent was proven to read.
 */
export function providersForSkillOrigin(origin: string): ProviderKind[] {
  if ((UNIVERSAL_SKILL_ORIGINS as readonly string[]).includes(origin)) {
    return [...ALL_PROVIDERS];
  }
  return ALL_PROVIDERS.filter((provider) =>
    (PROVIDER_SKILL_ORIGINS[provider] as readonly string[]).includes(origin),
  );
}

/** Skills are matched case-insensitively; the same name is the same skill to every agent. */
export function skillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

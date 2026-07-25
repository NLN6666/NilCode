// FILE: agentMentionCatalog.ts
// Purpose: Ambient catalog of the subagents an `@alias(` token may resolve to,
//          plus the stable per-agent chip color. Answers the one question every
//          prompt tokenizer needs before it can decide whether `@foo(` is an
//          agent chip or ordinary text.
// Layer: UI shared state/utilities
// Exports: AGENT_MENTION_COLORS, AgentMentionColor, resolveComposerAgentMention,
//          setComposerAgentMentionCatalog, clearComposerAgentMentionCatalogForTests

import { resolveAgentAlias } from "@synara/contracts";

/**
 * Chip palette. Order is load-bearing: `hashedAgentMentionColor` indexes into
 * it, so reordering repaints every discovered agent. Kept in sync with the
 * name → rgb map in `components/composerInlineChip.ts`, which is typed against
 * this union so a new color here is a compile error until it gets a value.
 */
export const AGENT_MENTION_COLORS = [
  "violet",
  "fuchsia",
  "teal",
  "cyan",
  "amber",
  "orange",
] as const;

export type AgentMentionColor = (typeof AGENT_MENTION_COLORS)[number];

export interface ResolvedComposerAgentMention {
  readonly alias: string;
  readonly color: AgentMentionColor;
}

/**
 * Names of the subagents discovery found for the active provider, lowercased.
 *
 * This is deliberately module state rather than a parameter. Prompt tokenizing
 * runs from React render (`ComposerPromptEditor`, `MessagesTimeline`) *and* from
 * plain cursor math (`composer-logic.ts`) that has no access to React context.
 * A call site that forgot to pass the list would tokenize `@coder(...)` as a
 * file mention while the renderer drew a chip — a silent caret desync. One
 * ambient answer to "which agents exist here" keeps every path in lockstep.
 */
let discoveredAgentNames: ReadonlySet<string> = new Set<string>();

function normalizeAgentName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Publishes the discovered subagents for the provider the composer is pointed
 * at. Last write wins: the app only ever shows one provider's composer at a
 * time, so there is a single meaningful catalog at any moment.
 */
export function setComposerAgentMentionCatalog(
  agents: ReadonlyArray<{ readonly name: string }>,
): void {
  const names = new Set<string>();
  for (const { name } of agents) {
    const normalized = normalizeAgentName(name);
    if (normalized.length > 0) {
      names.add(normalized);
    }
  }
  discoveredAgentNames = names;
}

export function clearComposerAgentMentionCatalogForTests(): void {
  discoveredAgentNames = new Set<string>();
}

/**
 * FNV-1a over the agent name. A hash rather than a rotating counter so an agent
 * keeps its color across reloads, across machines, and regardless of how many
 * other agents happen to be installed — and so near-identical names
 * (`coder` / `coder-2`) still land on different buckets.
 */
function hashedAgentMentionColor(name: string): AgentMentionColor {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const color = AGENT_MENTION_COLORS[(hash >>> 0) % AGENT_MENTION_COLORS.length];
  return color ?? "violet";
}

/**
 * The color an agent's chip is painted with. Static aliases keep the color
 * declared in their definition (`explore` is always cyan); everything else is
 * derived from the name.
 */
export function agentMentionColor(alias: string): AgentMentionColor {
  const normalized = normalizeAgentName(alias);
  return resolveAgentAlias(normalized)?.color ?? hashedAgentMentionColor(normalized);
}

/**
 * Resolves an `@alias` to a chip, or null when no such agent exists. Mirrors
 * the precedence `parseAgentMentionInvocations` uses on the dispatch side —
 * discovered agents first, static aliases as the built-in fallback — so a token
 * is only drawn as a chip when it will actually be delegated.
 */
export function resolveComposerAgentMention(alias: string): ResolvedComposerAgentMention | null {
  const normalized = normalizeAgentName(alias);
  if (normalized.length === 0) {
    return null;
  }
  const definition = resolveAgentAlias(normalized);
  if (!definition && !discoveredAgentNames.has(normalized)) {
    return null;
  }
  return { alias, color: definition?.color ?? hashedAgentMentionColor(normalized) };
}

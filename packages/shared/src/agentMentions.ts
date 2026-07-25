import { resolveAgentAlias, type ProviderKind, type ResolvedAgentAlias } from "@synara/contracts";

/**
 * A subagent the composer discovered for this provider (project/user definition
 * on disk, an SDK/plugin agent, or a Synara built-in). Structurally a subset of
 * `ProviderAgentDescriptor` so callers can pass discovery results straight in.
 */
export interface AgentMentionCatalogEntry {
  readonly name: string;
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly model?: string | undefined;
  readonly source?: string | undefined;
}

export interface ParsedAgentMentionInvocation {
  readonly alias: string;
  readonly task: string;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  /** Dispatch target: the Agent tool's subagent name / Codex `agent_type`. */
  readonly agentName: string;
  /** Set when the mention resolved to a discovered subagent. */
  readonly agent: AgentMentionCatalogEntry | null;
  /** Set when the mention resolved to a static provider alias. */
  readonly definition: ResolvedAgentAlias | null;
}

export interface AgentMentionParseOptions {
  /** Discovered subagents, already ordered by precedence (project > user > sdk > builtin). */
  readonly agents?: ReadonlyArray<AgentMentionCatalogEntry>;
}

// Plugin-provided subagents are namespaced with a colon (`ecc:security-reviewer`),
// so the colon has to be part of an alias or the name is silently truncated at it.
function isAliasChar(char: string | undefined): boolean {
  return typeof char === "string" && /[a-zA-Z0-9._:-]/.test(char);
}

function isMentionBoundary(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

function readBalancedTask(
  text: string,
  openParenIndex: number,
): { task: string; end: number } | null {
  let depth = 1;
  let cursor = openParenIndex + 1;

  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          task: text.slice(openParenIndex + 1, cursor),
          end: cursor + 1,
        };
      }
    }
    cursor += 1;
  }

  return null;
}

function indexAgentsByName(
  agents: ReadonlyArray<AgentMentionCatalogEntry>,
): Map<string, AgentMentionCatalogEntry> {
  const byName = new Map<string, AgentMentionCatalogEntry>();
  for (const agent of agents) {
    const key = agent.name.trim().toLowerCase();
    if (key.length > 0 && !byName.has(key)) {
      byName.set(key, agent);
    }
  }
  return byName;
}

/**
 * Parses `@alias(task)` mentions. Discovered subagents take precedence over the
 * static alias table, matching the project > user > sdk > builtin ordering the
 * caller supplies; unmatched mentions are left alone as ordinary prompt text.
 */
export function parseAgentMentionInvocations(
  text: string,
  provider: ProviderKind,
  options?: AgentMentionParseOptions,
): ReadonlyArray<ParsedAgentMentionInvocation> {
  const invocations: ParsedAgentMentionInvocation[] = [];
  const agentsByName = indexAgentsByName(options?.agents ?? []);

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") {
      continue;
    }
    if (!isMentionBoundary(text[index - 1])) {
      continue;
    }

    let aliasEnd = index + 1;
    while (isAliasChar(text[aliasEnd])) {
      aliasEnd += 1;
    }

    const alias = text.slice(index + 1, aliasEnd);
    if (alias.length === 0 || text[aliasEnd] !== "(") {
      continue;
    }

    const agent = agentsByName.get(alias.toLowerCase()) ?? null;
    const resolved = agent ? null : resolveAgentAlias(alias, provider);
    if (!agent && !resolved) {
      continue;
    }

    const taskMatch = readBalancedTask(text, aliasEnd);
    if (!taskMatch) {
      continue;
    }

    invocations.push({
      alias,
      task: taskMatch.task.trim(),
      raw: text.slice(index, taskMatch.end),
      start: index,
      end: taskMatch.end,
      agentName: agent?.name ?? (resolved && "agentName" in resolved ? resolved.agentName : alias),
      agent,
      definition: resolved ? { alias, ...resolved } : null,
    });

    index = taskMatch.end - 1;
  }

  return invocations;
}

// A Codex static alias is a model switch (`@spark`), not a subagent, so only
// discovered agents are dispatchable there.
function isSubagentInvocation(
  invocation: ParsedAgentMentionInvocation,
  provider: ProviderKind,
): boolean {
  if (invocation.agent) {
    return true;
  }
  return provider === "claudeAgent" && invocation.definition?.kind === "claude-subagent";
}

function subagentInvocations(
  text: string,
  provider: ProviderKind,
  options?: AgentMentionParseOptions,
): ReadonlyArray<ParsedAgentMentionInvocation> {
  return parseAgentMentionInvocations(text, provider, options).filter((invocation) =>
    isSubagentInvocation(invocation, provider),
  );
}

export function buildClaudeSubagentPrompt(
  text: string,
  options?: AgentMentionParseOptions,
): {
  readonly prompt: string;
  readonly invocations: ReadonlyArray<ParsedAgentMentionInvocation>;
} {
  const invocations = subagentInvocations(text, "claudeAgent", options);

  if (invocations.length === 0) {
    return {
      prompt: text,
      invocations,
    };
  }

  const directiveLines = invocations
    .map(
      (invocation, index) =>
        `${index + 1}. Use the "${invocation.agentName}" agent for this task:\n${invocation.task}`,
    )
    .join("\n\n");

  return {
    prompt: [
      "The user included inline subagent directives in the form @alias(task).",
      "Execute each directive explicitly via the Agent tool using the named subagent below.",
      "After the delegated work completes, continue with the overall request and synthesize the results.",
      "Do not echo the literal @alias(task) syntax back to the user unless it is directly relevant.",
      "",
      "Inline directives:",
      directiveLines,
      "",
      "Original user prompt:",
      text,
    ].join("\n"),
    invocations,
  };
}

export function buildCodexSubagentPrompt(
  text: string,
  options?: AgentMentionParseOptions,
): {
  readonly prompt: string;
  readonly invocations: ReadonlyArray<ParsedAgentMentionInvocation>;
} {
  const invocations = subagentInvocations(text, "codex", options);

  if (invocations.length === 0) {
    return {
      prompt: text,
      invocations,
    };
  }

  const directiveLines = invocations
    .map(
      (invocation, index) =>
        `${index + 1}. agent_type "${invocation.agentName}" — task:\n${invocation.task}`,
    )
    .join("\n\n");

  return {
    prompt: [
      "The user included inline subagent directives in the form @alias(task).",
      "Execute each directive by calling agents.spawn_agent with agent_type set to the quoted name and message set to the task, then collect the result with agents.wait_agent.",
      // Read-only fan-out (explore + review) is the common multi-mention shape and
      // is safe to parallelize. Concurrent writers against one worktree are not, so
      // the split is by whether a directive edits files — a property the model can
      // decide per directive, rather than by guessing dependencies between them.
      "When several directives are read-only, spawn them all before waiting, then collect every result with agents.wait_agent; do not wait for one to finish before spawning the next.",
      "When more than one directive modifies files, run those directives one at a time — spawn, wait for it to finish, then spawn the next — so concurrent edits cannot collide.",
      // `hide_spawn_agent_metadata` can hide the agent_type parameter from the
      // tool schema; without it the role has to be stated in the message instead.
      "If agents.spawn_agent does not expose an agent_type parameter, spawn the agent without it and open the message by stating which agent role to act as.",
      "If the agent tools are unavailable entirely, perform the task yourself and say that delegation was not possible.",
      "After the delegated work completes, continue with the overall request and synthesize the results.",
      "Do not echo the literal @alias(task) syntax back to the user unless it is directly relevant.",
      "",
      "Inline directives:",
      directiveLines,
      "",
      "Original user prompt:",
      text,
    ].join("\n"),
    invocations,
  };
}

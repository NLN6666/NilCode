import { describe, expect, it } from "vitest";

import {
  buildClaudeSubagentPrompt,
  buildCodexSubagentPrompt,
  parseAgentMentionInvocations,
} from "./agentMentions";

const CODER = { name: "coder", description: "Implements scoped changes", source: "user" };
const PLUGIN_REVIEWER = { name: "ecc:security-reviewer", source: "sdk" };

describe("parseAgentMentionInvocations", () => {
  it("parses Codex inline subagent syntax", () => {
    expect(parseAgentMentionInvocations("Check @spark(find the regression)", "codex")).toEqual([
      {
        alias: "spark",
        task: "find the regression",
        raw: "@spark(find the regression)",
        start: 6,
        end: 33,
        agentName: "spark",
        agent: null,
        definition: {
          alias: "spark",
          provider: "codex",
          kind: "model",
          model: "gpt-5.3-codex-spark",
          displayName: "GPT-5.3 Codex Spark",
          color: "cyan",
        },
      },
    ]);
  });

  it("parses balanced nested parentheses for Claude subagents", () => {
    const parsed = parseAgentMentionInvocations(
      "Please @review(check fn(a, b) and the SQL migration)",
      "claudeAgent",
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.task).toBe("check fn(a, b) and the SQL migration");
    expect(parsed[0]?.definition?.kind).toBe("claude-subagent");
    expect(parsed[0]?.agentName).toBe("review");
  });

  it("resolves discovered agents that have no static alias", () => {
    const parsed = parseAgentMentionInvocations("@coder(add pagination)", "claudeAgent", {
      agents: [CODER],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.agentName).toBe("coder");
    expect(parsed[0]?.agent).toEqual(CODER);
    expect(parsed[0]?.definition).toBeNull();
  });

  it("keeps colon-namespaced plugin agent names intact", () => {
    const parsed = parseAgentMentionInvocations(
      "@ecc:security-reviewer(audit the auth module)",
      "claudeAgent",
      { agents: [PLUGIN_REVIEWER] },
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.alias).toBe("ecc:security-reviewer");
    expect(parsed[0]?.agentName).toBe("ecc:security-reviewer");
    expect(parsed[0]?.task).toBe("audit the auth module");
  });

  it("lets a discovered agent win over a same-named built-in alias", () => {
    const projectReview = { name: "review", description: "Project reviewer", source: "project" };
    const parsed = parseAgentMentionInvocations("@review(look at the diff)", "claudeAgent", {
      agents: [projectReview],
    });

    expect(parsed[0]?.agent).toEqual(projectReview);
    expect(parsed[0]?.definition).toBeNull();
  });

  it("ignores mentions that match no alias and no discovered agent", () => {
    expect(parseAgentMentionInvocations("@nobody(do a thing)", "claudeAgent")).toEqual([]);
  });
});

describe("buildClaudeSubagentPrompt", () => {
  it("leaves plain prompts untouched when no Claude mentions exist", () => {
    expect(buildClaudeSubagentPrompt("Just answer directly")).toEqual({
      prompt: "Just answer directly",
      invocations: [],
    });
  });

  it("rewrites Claude mentions into explicit Agent-tool instructions", () => {
    const rewritten = buildClaudeSubagentPrompt(
      "Compare these changes and @review(check for regressions) then @explore(find related files)",
    );

    expect(rewritten.invocations.map((invocation) => invocation.agentName)).toEqual([
      "review",
      "explore",
    ]);
    expect(rewritten.prompt).toContain('Use the "review" agent for this task:');
    expect(rewritten.prompt).toContain("check for regressions");
    expect(rewritten.prompt).toContain('Use the "explore" agent for this task:');
    expect(rewritten.prompt).toContain("Original user prompt:");
  });

  it("dispatches discovered agents by their on-disk name", () => {
    const rewritten = buildClaudeSubagentPrompt("@ecc:security-reviewer(audit auth)", {
      agents: [PLUGIN_REVIEWER],
    });

    expect(rewritten.prompt).toContain('Use the "ecc:security-reviewer" agent for this task:');
    expect(rewritten.prompt).toContain("audit auth");
  });
});

describe("buildCodexSubagentPrompt", () => {
  it("leaves model-alias mentions untouched", () => {
    // `@spark` switches models on Codex; it must not become a spawn_agent call.
    expect(buildCodexSubagentPrompt("Check @spark(find the regression)")).toEqual({
      prompt: "Check @spark(find the regression)",
      invocations: [],
    });
  });

  it("rewrites discovered agent mentions into spawn_agent instructions", () => {
    const rewritten = buildCodexSubagentPrompt("Please @coder(add pagination to /users)", {
      agents: [CODER],
    });

    expect(rewritten.invocations.map((invocation) => invocation.agentName)).toEqual(["coder"]);
    expect(rewritten.prompt).toContain("agents.spawn_agent");
    expect(rewritten.prompt).toContain("agents.wait_agent");
    expect(rewritten.prompt).toContain('agent_type "coder" — task:');
    expect(rewritten.prompt).toContain("add pagination to /users");
    expect(rewritten.prompt).toContain("Original user prompt:");
  });

  it("pins the spawn ordering instead of leaving it to the model", () => {
    // Read-only directives fan out in parallel; file-modifying ones are serialized
    // so two subagents can never edit the same worktree concurrently.
    const rewritten = buildCodexSubagentPrompt("@coder(refactor)", { agents: [CODER] });

    expect(rewritten.prompt).toContain("spawn them all before waiting");
    expect(rewritten.prompt).toContain("run those directives one at a time");
  });

  it("keeps a degradation path when agent_type is not exposed", () => {
    const rewritten = buildCodexSubagentPrompt("@coder(refactor)", { agents: [CODER] });

    expect(rewritten.prompt).toContain("does not expose an agent_type parameter");
  });
});

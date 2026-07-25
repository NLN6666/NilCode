// FILE: useAgentMcpTools.test.ts
// Purpose: Locks the rule that decides when the composer may probe the user's MCP servers.
// Layer: Web hook tests

import type { ProviderKind } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import type { ComposerTriggerKind } from "~/composer-logic";
import { agentMcpProviderForProviderKind, shouldProbeAgentMcpTools } from "./useAgentMcpTools";

const PASSIVE_TRIGGERS: ReadonlyArray<ComposerTriggerKind | null> = [
  null,
  "mention",
  "slash-command",
  "slash-model",
  "skill",
];

describe("shouldProbeAgentMcpTools", () => {
  it("probes while the user has the `&` picker open", () => {
    expect(shouldProbeAgentMcpTools({ provider: "codex", composerTriggerKind: "mcp-tool" })).toBe(
      true,
    );
    expect(
      shouldProbeAgentMcpTools({ provider: "claudeAgent", composerTriggerKind: "mcp-tool" }),
    ).toBe(true);
  });

  it("never probes for text that merely looks like a reference", () => {
    // A restored draft, a paste, or a coincidental `run task-a &task-b` leaves no trigger open;
    // spawning every configured MCP server for that would be a probe the user never asked for.
    for (const composerTriggerKind of PASSIVE_TRIGGERS) {
      expect(shouldProbeAgentMcpTools({ provider: "codex", composerTriggerKind })).toBe(false);
    }
  });

  it("never probes on a provider whose MCP servers Synara does not manage", () => {
    const unmanaged: ReadonlyArray<ProviderKind> = ["cursor", "grok", "droid", "opencode"];

    for (const provider of unmanaged) {
      expect(agentMcpProviderForProviderKind(provider)).toBeNull();
      expect(shouldProbeAgentMcpTools({ provider, composerTriggerKind: "mcp-tool" })).toBe(false);
    }
  });
});

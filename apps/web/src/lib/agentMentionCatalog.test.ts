import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_MENTION_COLORS,
  agentMentionColor,
  clearComposerAgentMentionCatalogForTests,
  resolveComposerAgentMention,
  setComposerAgentMentionCatalog,
} from "./agentMentionCatalog";

afterEach(() => {
  clearComposerAgentMentionCatalogForTests();
});

describe("resolveComposerAgentMention", () => {
  it("resolves a discovered subagent that the static alias table has never heard of", () => {
    expect(resolveComposerAgentMention("fable-advisor:grok-implementer")).toBeNull();

    setComposerAgentMentionCatalog([{ name: "fable-advisor:grok-implementer" }]);

    expect(resolveComposerAgentMention("fable-advisor:grok-implementer")).toEqual({
      alias: "fable-advisor:grok-implementer",
      color: expect.stringMatching(/^(violet|fuchsia|teal|cyan|amber|orange)$/),
    });
  });

  it("matches case-insensitively and preserves the alias as the user typed it", () => {
    setComposerAgentMentionCatalog([{ name: "Coder" }]);

    expect(resolveComposerAgentMention("cOdEr")?.alias).toBe("cOdEr");
  });

  it("keeps a static alias resolvable without any discovery having run", () => {
    expect(resolveComposerAgentMention("explore")).toEqual({ alias: "explore", color: "cyan" });
  });

  it("keeps the declared color when discovery also reports a built-in alias", () => {
    // Built-ins arrive through discovery too (`source: "builtin"`). Hashing them
    // would silently repaint `@explore` the first time discovery succeeds.
    setComposerAgentMentionCatalog([{ name: "explore" }, { name: "review" }]);

    expect(resolveComposerAgentMention("explore")?.color).toBe("cyan");
    expect(resolveComposerAgentMention("review")?.color).toBe("amber");
  });

  it("returns null for an unknown alias so it stays ordinary prompt text", () => {
    setComposerAgentMentionCatalog([{ name: "coder" }]);

    expect(resolveComposerAgentMention("not-an-agent")).toBeNull();
    expect(resolveComposerAgentMention("")).toBeNull();
  });

  it("drops blank names instead of matching a bare @(", () => {
    setComposerAgentMentionCatalog([{ name: "   " }]);

    expect(resolveComposerAgentMention("   ")).toBeNull();
  });
});

describe("agentMentionColor", () => {
  it("gives the same agent the same color every time", () => {
    expect(agentMentionColor("coder")).toBe(agentMentionColor("coder"));
    expect(agentMentionColor("coder")).toBe(agentMentionColor("CODER"));
  });

  it("stays inside the chip palette for arbitrary names", () => {
    for (const name of ["a", "coder", "ecc:security-reviewer", "grok-build:grok-delegate", "zzz"]) {
      expect(AGENT_MENTION_COLORS).toContain(agentMentionColor(name));
    }
  });

  it("separates near-identical names rather than clustering them", () => {
    const colors = new Set(
      ["coder", "coder-2", "coder-3", "coder-4"].map((name) => agentMentionColor(name)),
    );

    expect(colors.size).toBeGreaterThan(1);
  });
});

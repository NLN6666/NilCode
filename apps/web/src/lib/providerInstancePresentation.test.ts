import { describe, expect, it } from "vitest";

import {
  deriveProviderAccountId,
  normalizeProviderAccentColor,
  providerAccountQualifiedLabel,
  resolveProviderInstanceLabel,
  validateProviderAccountId,
} from "./providerInstancePresentation";

describe("provider instance presentation", () => {
  it("does not relabel a missing account as the first configured account", () => {
    const label = resolveProviderInstanceLabel(
      [{ instanceId: "codex", label: "Personal" }],
      "codex_deleted",
    );
    expect(label).not.toBe("Personal");
    expect(label.length).toBeGreaterThan(0);
  });
});

describe("normalizeProviderAccentColor", () => {
  it("accepts only #rrggbb and lowercases it", () => {
    expect(normalizeProviderAccentColor("#2563EB")).toBe("#2563eb");
    expect(normalizeProviderAccentColor("  #16a34a ")).toBe("#16a34a");
  });

  it.each([undefined, null, "", "#fff", "2563eb", "blue", "#2563ebff", "rgb(0,0,0)"])(
    "treats %j as unset",
    (value) => {
      expect(normalizeProviderAccentColor(value)).toBeUndefined();
    },
  );
});

describe("providerAccountQualifiedLabel", () => {
  it("prefixes the provider unless the account name already carries it", () => {
    expect(providerAccountQualifiedLabel("Codex", "Work")).toBe("Codex · Work");
    expect(providerAccountQualifiedLabel("Codex", "Codex")).toBe("Codex");
    expect(providerAccountQualifiedLabel("Claude", "claude personal")).toBe("claude personal");
  });
});

describe("deriveProviderAccountId", () => {
  it.each([
    ["codex", "Work", "codex_work"],
    ["claudeAgent", "Work laptop", "claude_work_laptop"],
    ["opencode", "  Team / EU-1  ", "opencode_team_eu_1"],
    ["codex", "!!!", ""],
    ["codex", "", ""],
  ] as const)("derives the id of a %s account labelled %j", (provider, label, accountId) => {
    expect(deriveProviderAccountId(provider, label)).toBe(accountId);
  });

  it("keeps a long label within the routing id limit", () => {
    const accountId = deriveProviderAccountId("codex", "a".repeat(120));
    expect(accountId).toBe(`codex_${"a".repeat(48)}`);
    expect(validateProviderAccountId(accountId, new Set())).toBeNull();
  });
});

describe("validateProviderAccountId", () => {
  const existing = new Set(["codex", "codex_work"]);

  it("accepts a free, well-formed id", () => {
    expect(validateProviderAccountId("codex_personal", existing)).toBeNull();
    expect(validateProviderAccountId("Claude-2", existing)).toBeNull();
  });

  it.each(["", "   ", "a".repeat(65), "2fast", "has space", "codex_work", "codex"])(
    "rejects %j",
    (accountId) => {
      const reason = validateProviderAccountId(accountId, existing);
      expect(reason).not.toBeNull();
      expect(reason?.length).toBeGreaterThan(0);
      if (existing.has(accountId)) {
        expect(reason).toContain(accountId);
      }
    },
  );
});

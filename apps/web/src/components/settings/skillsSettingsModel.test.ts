// FILE: skillsSettingsModel.test.ts
// Purpose: Locks down Settings -> Skills grouping for duplicate provider skill copies and the
//          per-provider toggle arithmetic behind the row, section, and panel switches.
// Layer: Web settings logic tests

import type { DisabledSkillsByProvider, ProviderSkillDescriptor } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { en } from "../../i18n/locales/en";
import {
  buildSettingsSkillGroups,
  buildSettingsSkillSections,
  nextDisabledSkills,
  skillToggleState,
} from "./skillsSettingsModel";

// Rank/title assertions read against the real English catalog, exactly what the panel passes in.
const SKILL_LABELS = en.settings.skills;

const NONE_DISABLED: DisabledSkillsByProvider = {
  codex: [],
  claudeAgent: [],
  cursor: [],
  antigravity: [],
  grok: [],
  droid: [],
  devin: [],
  omp: [],
  opencode: [],
  pi: [],
};

function disabledWith(patch: Partial<DisabledSkillsByProvider>): DisabledSkillsByProvider {
  return { ...NONE_DISABLED, ...patch };
}

function skill(partial: Partial<ProviderSkillDescriptor>): ProviderSkillDescriptor {
  return {
    name: "example",
    enabled: true,
    path: "/tmp/example/SKILL.md",
    ...partial,
  };
}

describe("buildSettingsSkillGroups", () => {
  it("renders duplicate provider copies as one shared skill group", () => {
    const groups = buildSettingsSkillGroups(
      [
        skill({
          name: "check-code",
          description: "Codex copy",
          path: "/Users/test/.codex/skills/check-code/SKILL.md",
          scope: "codex",
        }),
        skill({
          name: "check-code",
          description: "Claude copy",
          path: "/Users/test/.claude/skills/check-code/SKILL.md",
          scope: "claude",
        }),
        skill({
          name: "cursor-only",
          path: "/Users/test/.cursor/skills/cursor-only/SKILL.md",
          scope: "cursor",
        }),
      ],
      SKILL_LABELS,
    );

    const shared = groups.find((group) => group.key === "check-code");
    expect(shared?.section).toBe("shared");
    expect(shared?.sources.map((source) => source.origin)).toEqual(["codex", "claude"]);
    expect(shared?.sources.map((source) => source.skill.path)).toEqual([
      "/Users/test/.codex/skills/check-code/SKILL.md",
      "/Users/test/.claude/skills/check-code/SKILL.md",
    ]);

    const cursorOnly = groups.find((group) => group.key === "cursor-only");
    expect(cursorOnly?.section).toBe("cursor");
    expect(cursorOnly?.providers).toEqual(["cursor"]);
  });

  // Reach, not ownership: Cursor and Droid read Codex's and Claude's folders, so a skill in
  // either one is loaded by more agents than the folder's owner.
  it("reports every provider that reads the origin folder, not just its owner", () => {
    const groups = buildSettingsSkillGroups(
      [
        skill({
          name: "check-code",
          path: "/Users/test/.codex/skills/check-code/SKILL.md",
          scope: "codex",
        }),
        skill({
          name: "check-code",
          path: "/Users/test/.claude/skills/check-code/SKILL.md",
          scope: "claude",
        }),
      ],
      SKILL_LABELS,
    );

    expect(groups[0]?.providers).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "droid",
      "opencode",
      "devin",
    ]);
  });

  it("treats `~/.factory/skills` as Droid's folder", () => {
    const groups = buildSettingsSkillGroups(
      [
        skill({
          name: "droid-only",
          path: "/Users/test/.factory/skills/droid-only/SKILL.md",
          scope: "factory",
        }),
      ],
      SKILL_LABELS,
    );

    expect(groups[0]?.providers).toEqual(["droid"]);
    expect(groups[0]?.sources[0]?.originInfo.provider).toBe("droid");
  });

  it("reaches every provider that reads the shared .agents folder", () => {
    const groups = buildSettingsSkillGroups(
      [
        skill({
          name: "portable-review",
          description: "Shared standard copy",
          path: "/Users/test/.agents/skills/portable-review/SKILL.md",
          scope: "agents",
        }),
      ],
      SKILL_LABELS,
    );

    // Claude is the one agent that does not read `.agents`.
    expect(groups[0]?.providers).not.toContain("claudeAgent");
    expect(groups[0]?.providers).toContain("codex");
    expect(groups[0]?.section).toBe("agents");
  });

  it("reaches every provider from the portable Synara folder", () => {
    const groups = buildSettingsSkillGroups(
      [
        skill({
          name: "portable",
          path: "/Users/test/.synara/skills/portable/SKILL.md",
          scope: "synara",
        }),
      ],
      SKILL_LABELS,
    );

    expect(groups[0]?.providers).toHaveLength(10);
  });
});

describe("buildSettingsSkillSections", () => {
  it("places shared skill groups before provider-only sections", () => {
    const sections = buildSettingsSkillSections(
      [
        skill({
          name: "logic-consolidator",
          path: "/Users/test/.codex/skills/logic-consolidator/SKILL.md",
          scope: "codex",
        }),
        skill({
          name: "logic-consolidator",
          path: "/Users/test/.claude/skills/logic-consolidator/SKILL.md",
          scope: "claude",
        }),
        skill({
          name: "cursor-only",
          path: "/Users/test/.cursor/skills/cursor-only/SKILL.md",
          scope: "cursor",
        }),
      ],
      SKILL_LABELS,
    );

    expect(sections.map((section) => section.title)).toEqual(["Shared skills", "From Cursor"]);
    expect(sections[0]?.groups.map((group) => group.key)).toEqual(["logic-consolidator"]);
  });
});

describe("skillToggleState", () => {
  const targets = [
    { key: "alpha", providers: ["codex", "claudeAgent"] as const },
    { key: "beta", providers: ["codex"] as const },
  ];

  it("reports all, none, and partial across a range of skill/provider pairs", () => {
    expect(skillToggleState(targets, NONE_DISABLED)).toBe("all");
    expect(
      skillToggleState(targets, disabledWith({ codex: ["alpha", "beta"], claudeAgent: ["alpha"] })),
    ).toBe("none");
    expect(skillToggleState(targets, disabledWith({ codex: ["alpha"] }))).toBe("partial");
  });

  // The whole point of per-provider opt-outs: the same name under another provider is a
  // different file and must not be counted.
  it("ignores the same skill disabled for a provider outside the range", () => {
    expect(
      skillToggleState([{ key: "alpha", providers: ["codex"] }], disabledWith({ grok: ["alpha"] })),
    ).toBe("all");
  });

  it("ignores disabled entries outside the range", () => {
    expect(
      skillToggleState(
        [{ key: "alpha", providers: ["codex"] }],
        disabledWith({ codex: ["gamma"] }),
      ),
    ).toBe("all");
  });

  it("normalizes keys before comparing", () => {
    expect(
      skillToggleState(
        [{ key: " Alpha ", providers: ["codex"] }],
        disabledWith({ codex: ["alpha"] }),
      ),
    ).toBe("none");
  });

  it("treats an empty range as fully enabled", () => {
    expect(skillToggleState([], disabledWith({ codex: ["alpha"] }))).toBe("all");
  });
});

describe("nextDisabledSkills", () => {
  it("disables a batch across exactly the providers named in the targets", () => {
    const next = nextDisabledSkills(
      NONE_DISABLED,
      [
        { key: "beta", providers: ["codex", "grok"] },
        { key: "alpha", providers: ["codex"] },
      ],
      false,
    );

    expect(next.codex).toEqual(["alpha", "beta"]);
    expect(next.grok).toEqual(["beta"]);
    expect(next.claudeAgent).toEqual([]);
  });

  it("leaves other providers' lists untouched when one provider is toggled", () => {
    const next = nextDisabledSkills(
      disabledWith({ codex: ["alpha"], claudeAgent: ["alpha"] }),
      [{ key: "alpha", providers: ["codex"] }],
      true,
    );

    expect(next.codex).toEqual([]);
    expect(next.claudeAgent).toEqual(["alpha"]);
  });

  it("enables a whole batch without touching unrelated entries", () => {
    const next = nextDisabledSkills(
      disabledWith({ codex: ["alpha", "beta", "gamma"] }),
      [
        { key: "alpha", providers: ["codex"] },
        { key: "beta", providers: ["codex"] },
      ],
      true,
    );

    expect(next.codex).toEqual(["gamma"]);
  });

  it("keeps entries for skills missing from the catalog so opt-outs survive a reinstall", () => {
    const next = nextDisabledSkills(
      disabledWith({ codex: ["uninstalled"] }),
      [{ key: "alpha", providers: ["codex"] }],
      true,
    );

    expect(next.codex).toEqual(["uninstalled"]);
  });

  it("normalizes both the existing list and the incoming keys", () => {
    expect(
      nextDisabledSkills(
        disabledWith({ codex: [" Alpha "] }),
        [{ key: "ALPHA", providers: ["codex"] }],
        false,
      ).codex,
    ).toEqual(["alpha"]);
    expect(
      nextDisabledSkills(
        disabledWith({ codex: [" Alpha "] }),
        [{ key: "ALPHA", providers: ["codex"] }],
        true,
      ).codex,
    ).toEqual([]);
  });
});

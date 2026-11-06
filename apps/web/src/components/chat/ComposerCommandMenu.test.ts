import { describe, expect, it } from "vitest";

import { groupCommandItems, type ComposerCommandItem } from "./ComposerCommandMenu";

const GROUP_LABELS: Record<string, string> = {
  "common:plugin_pluginsTab": "Plugins",
  "workspace:general_chats": "Chats",
  "chat:subagents": "Subagents",
  "chat:builtIn": "Built-in",
  "workspace:nav_models": "Models",
  "chat:mode_label": "Mode",
  "computer:worktreeMode_local": "Local",
  "workspace:models_customModelProvider": "Provider",
  "common:plugin_skillsSection": "Skills",
  "chat:commandMenu_githubReferences": "Pull requests and issues",
  "settings:connectors": "Connectors",
};
const translate = ((key: string) => GROUP_LABELS[key] ?? key) as Parameters<
  typeof groupCommandItems
>[3];

describe("groupCommandItems", () => {
  it("groups mention suggestions as plugins, chats, agents, then local", () => {
    const items: ComposerCommandItem[] = [
      {
        id: "agent:codex:mini",
        type: "agent",
        provider: "codex",
        alias: "mini",
        color: "violet",
        group: "model",
        label: "@mini",
        description: "GPT-5.4 Mini",
      },
      {
        id: "path:file:/workspace/AGENTS.md",
        type: "path",
        path: "/workspace/AGENTS.md",
        pathKind: "file",
        label: "AGENTS.md",
        description: "/workspace",
      },
      {
        id: "plugin:github",
        type: "plugin",
        plugin: {
          id: "plugin/github",
          name: "GitHub",
          source: {
            type: "local",
            path: "/test/plugins/github",
          },
          interface: {
            displayName: "GitHub",
            shortDescription: "Triage PRs and CI",
          },
          installed: true,
          enabled: true,
          installPolicy: "AVAILABLE",
          authPolicy: "ON_USE",
        },
        mention: {
          name: "GitHub",
          path: "plugin://GitHub@codex",
        },
        label: "GitHub",
        description: "Triage PRs and CI",
      },
      {
        id: "local-root",
        type: "local-root",
        label: "@local",
        description: "Browse folders on this computer",
      },
      {
        id: "thread:thread-1",
        type: "thread",
        threadId: "thread-1",
        provider: "codex",
        mention: { name: "Release prep", path: "thread://thread-1" },
        label: "Release prep",
        description: "Synara",
      },
      {
        id: "agent:codex:coder",
        type: "agent",
        provider: "codex",
        alias: "coder",
        color: "violet",
        group: "agent",
        label: "@coder",
        description: "Implements scoped changes",
      },
      {
        id: "agent:claudeAgent:explore",
        type: "agent",
        provider: "claudeAgent",
        alias: "explore",
        color: "cyan",
        group: "builtin",
        label: "@explore",
        description: "Explore",
      },
    ];

    expect(groupCommandItems(items, "mention", true, translate)).toEqual([
      {
        id: "plugins",
        label: "Plugins",
        items: [items[2]],
      },
      {
        id: "chats",
        label: "Chats",
        items: [items[4]],
      },
      {
        id: "subagents",
        label: "Subagents",
        items: [items[5]],
      },
      {
        id: "built-in-agents",
        label: "Built-in",
        items: [items[6]],
      },
      {
        id: "model-aliases",
        label: "Models",
        items: [items[0]],
      },
      {
        id: "local",
        label: "Local",
        items: [items[1], items[3]],
      },
    ]);
  });

  it("puts turn modes below the mention targets and above local files", () => {
    const items: ComposerCommandItem[] = [
      {
        id: "agent:codex:coder",
        type: "agent",
        provider: "codex",
        alias: "coder",
        color: "violet",
        group: "agent",
        label: "@coder",
        description: "Implements scoped changes",
      },
      {
        id: "color-preview",
        type: "color-preview",
        label: "@Preview",
        description: "Preview mode",
      },
      {
        id: "path:file:/workspace/AGENTS.md",
        type: "path",
        path: "/workspace/AGENTS.md",
        pathKind: "file",
        label: "AGENTS.md",
        description: "/workspace",
      },
    ];

    expect(groupCommandItems(items, "mention", true, translate)).toEqual([
      { id: "subagents", label: "Subagents", items: [items[0]] },
      { id: "modes", label: "Mode", items: [items[1]] },
      { id: "local", label: "Local", items: [items[2]] },
    ]);
  });

  it("groups slash-menu skills separately from app and provider commands", () => {
    const items: ComposerCommandItem[] = [
      {
        id: "slash:review",
        type: "slash-command",
        command: "review",
        label: "/review",
        description: "Review changes",
        source: "app",
      },
      {
        id: "provider-command:codex:help",
        type: "provider-native-command",
        provider: "codex",
        command: "help",
        label: "/help",
        description: "Show help",
      },
      {
        id: "skill:/workspace/.codex/skills/check-code/SKILL.md",
        type: "skill",
        skill: {
          name: "check-code",
          description: "Review recent code changes",
          path: "/workspace/.codex/skills/check-code/SKILL.md",
          enabled: true,
          scope: "project",
        },
        label: "check-code",
        description: "Review recent code changes",
      },
    ];

    expect(groupCommandItems(items, "slash-command", true, translate)).toEqual([
      {
        id: "built-in",
        label: "Built-in",
        items: [items[0]],
      },
      {
        id: "provider",
        label: "Provider",
        items: [items[1]],
      },
      {
        id: "skills",
        label: "Skills",
        items: [items[2]],
      },
    ]);
  });

  it("groups GitHub PR and issue reference suggestions together", () => {
    const items: ComposerCommandItem[] = [
      {
        id: "github:acme/app:pull:12",
        type: "github-reference",
        reference: {
          kind: "pull",
          repository: "acme/app",
          number: 12,
          title: "Ship composer references",
          url: "https://github.com/acme/app/pull/12",
        },
        state: "open",
        label: "#12 Ship composer references",
        description: "acme/app",
      },
    ];

    expect(groupCommandItems(items, "github-reference", true, translate)).toEqual([
      { id: "github", label: "Pull requests and issues", items },
    ]);
  });
});

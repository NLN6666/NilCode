import { describe, expect, it } from "vitest";

import type { ProviderAgentDescriptor } from "@synara/contracts";

import { en } from "~/i18n/locales/en";
import { zhCN } from "~/i18n/locales/zh-CN";
import {
  COLOR_PREVIEW_MENTION_INSERT_TEXT,
  promptIncludesColorPreviewMention,
} from "~/lib/composerMentions";

import type { ComposerThreadMentionSource, Project } from "../types";
import {
  buildColorPreviewMentionComposerItems,
  buildThreadMentionComposerItems,
  useComposerCommandMenuItems,
} from "./useComposerCommandMenuItems";

function project(id: string, kind: Project["kind"], name: string): Project {
  return {
    id,
    kind,
    name,
    remoteName: name,
    folderName: name,
    localName: null,
    cwd: `/workspace/${id}`,
    defaultModelSelection: null,
    expanded: true,
    scripts: [],
  } as unknown as Project;
}

function thread(input: {
  id: string;
  projectId: string;
  title: string;
  provider?: "codex" | "claudeAgent";
  updatedAt?: string;
  archivedAt?: string | null;
}): ComposerThreadMentionSource {
  return {
    id: input.id,
    projectId: input.projectId,
    title: input.title,
    provider: input.provider ?? "codex",
    createdAt: input.updatedAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt,
    archivedAt: input.archivedAt ?? null,
    latestUserMessageAt: null,
  } as unknown as ComposerThreadMentionSource;
}

describe("buildThreadMentionComposerItems", () => {
  const projects = [
    project("project", "project", "Synara"),
    project("chats", "chat", "Home"),
    project("studio", "studio", "Studio workspace"),
  ];

  it("searches titles across project, chat, and studio sections and excludes the current thread", () => {
    const items = buildThreadMentionComposerItems({
      projects,
      currentThreadId: "current",
      query: "release",
      threads: [
        thread({ id: "current", projectId: "project", title: "Release current" }),
        thread({ id: "project-thread", projectId: "project", title: "Release Synara" }),
        thread({ id: "chat-thread", projectId: "chats", title: "Release notes" }),
        thread({
          id: "studio-thread",
          projectId: "studio",
          title: "Release artwork",
          provider: "claudeAgent",
        }),
        thread({ id: "unrelated", projectId: "project", title: "Bug triage" }),
      ],
    });

    expect(items.map((item) => item.id).toSorted()).toEqual([
      "thread:chat-thread",
      "thread:project-thread",
      "thread:studio-thread",
    ]);
    expect(Object.fromEntries(items.map((item) => [item.id, item.description]))).toEqual({
      "thread:chat-thread": "Chats",
      "thread:project-thread": "Synara",
      "thread:studio-thread": "Studio",
    });
    expect(items.find((item) => item.id === "thread:studio-thread")).toMatchObject({
      provider: "claudeAgent",
      mention: { name: "Release artwork", path: "thread://studio-thread" },
    });
  });

  it("caps the unfiltered list to the 20 most recent active threads", () => {
    const threads = Array.from({ length: 24 }, (_, index) =>
      thread({
        id: `thread-${index}`,
        projectId: "project",
        title: index === 23 ? "" : `Thread ${index}`,
        updatedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        archivedAt: index === 22 ? "2026-02-01T00:00:00.000Z" : null,
      }),
    );
    const items = buildThreadMentionComposerItems({
      projects,
      currentThreadId: null,
      query: "",
      threads,
    });

    expect(items).toHaveLength(20);
    expect(items[0]).toMatchObject({ label: "Untitled thread", id: "thread:thread-23" });
    expect(items.some((item) => item.id === "thread:thread-22")).toBe(false);
    expect(items.at(-1)?.id).toBe("thread:thread-3");
  });

  it("caps query-filtered results to the suggestion limit", () => {
    const threads = Array.from({ length: 30 }, (_, index) =>
      thread({ id: `thread-${index}`, projectId: "project", title: `Release ${index}` }),
    );
    const items = buildThreadMentionComposerItems({
      projects,
      currentThreadId: null,
      query: "release",
      threads,
    });

    expect(items).toHaveLength(20);
  });

  it("disambiguates duplicate titles with the project name so mention tokens stay unique", () => {
    const items = buildThreadMentionComposerItems({
      projects,
      currentThreadId: null,
      query: "planning",
      threads: [
        thread({ id: "in-project", projectId: "project", title: "Planning" }),
        thread({ id: "in-chats", projectId: "chats", title: "Planning" }),
        thread({ id: "unique", projectId: "project", title: "Planning extras" }),
      ],
    });

    const mentionNamesById = Object.fromEntries(
      items.map((item) => [item.id, item.type === "thread" ? item.mention.name : null]),
    );
    expect(mentionNamesById["thread:in-project"]).toBe("Planning (Synara)");
    expect(mentionNamesById["thread:in-chats"]).toBe("Planning (Chats)");
    expect(mentionNamesById["thread:unique"]).toBe("Planning extras");
    expect(items.every((item) => item.label.startsWith("Planning"))).toBe(true);
  });

  it("falls back to a thread-id suffix for duplicate titles inside the same project", () => {
    const items = buildThreadMentionComposerItems({
      projects,
      currentThreadId: null,
      query: "planning",
      threads: [
        thread({ id: "thread-aaa111", projectId: "project", title: "Planning" }),
        thread({ id: "thread-bbb222", projectId: "project", title: "Planning" }),
      ],
    });

    const names = items.map((item) => (item.type === "thread" ? item.mention.name : "")).toSorted();
    expect(names).toEqual(["Planning (Synara, aaa111)", "Planning (Synara, bbb222)"]);
  });

  it("keeps generated names unique when a qualified name matches another real title", () => {
    const items = buildThreadMentionComposerItems({
      projects,
      currentThreadId: null,
      query: "planning",
      threads: [
        thread({ id: "thread-111111", projectId: "project", title: "Planning" }),
        thread({ id: "thread-222222", projectId: "chats", title: "Planning" }),
        thread({
          id: "thread-333333",
          projectId: "project",
          title: "Planning (Synara)",
        }),
      ],
    });

    const names = items.map((item) => (item.type === "thread" ? item.mention.name : ""));
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    expect(names).toContain("Planning (Synara) (111111)");
    expect(names).toContain("Planning (Synara) (333333)");
  });

  it("treats casing-only title differences as the same mention token", () => {
    const items = buildThreadMentionComposerItems({
      projects,
      currentThreadId: null,
      query: "release",
      threads: [
        thread({ id: "thread-aaaaaa", projectId: "project", title: "Release" }),
        thread({ id: "thread-bbbbbb", projectId: "project", title: "release" }),
      ],
    });

    const names = items.map((item) => (item.type === "thread" ? item.mention.name : ""));
    expect(names).toEqual(["Release (aaaaaa)", "release (bbbbbb)"]);
  });
});

describe("buildColorPreviewMentionComposerItems", () => {
  function previewItems(query: string, copy = en.composer.commandMenu.colorPreview) {
    return buildColorPreviewMentionComposerItems({
      query,
      description: copy.description,
      keywords: copy.keywords,
    });
  }

  it("offers the row for a bare @ and for prefixes of the token", () => {
    for (const query of ["", "p", "pre", "preview", "Preview"]) {
      expect(previewItems(query)).toHaveLength(1);
    }
  });

  it("stays reachable through the active catalog's wording", () => {
    expect(previewItems("theme")).toHaveLength(1);
    expect(previewItems("预览", zhCN.composer.commandMenu.colorPreview)).toHaveLength(1);
    expect(previewItems("配色", zhCN.composer.commandMenu.colorPreview)).toHaveLength(1);
  });

  it("drops the row for unrelated mention queries", () => {
    expect(previewItems("src/theme.css")).toEqual([]);
    expect(previewItems("coder")).toEqual([]);
  });

  it("inserts a token the send path reads back as color-preview mode", () => {
    const [item] = previewItems("pre");

    expect(item).toMatchObject({ type: "color-preview", label: COLOR_PREVIEW_MENTION_INSERT_TEXT });
    expect(
      promptIncludesColorPreviewMention(`${COLOR_PREVIEW_MENTION_INSERT_TEXT} pick a palette`),
    ).toBe(true);
    expect(
      promptIncludesColorPreviewMention(`pick a palette ${COLOR_PREVIEW_MENTION_INSERT_TEXT} `),
    ).toBe(true);
  });
});

describe("useComposerCommandMenuItems mention agents", () => {
  function mentionItems(input: {
    provider: "codex" | "claudeAgent";
    query: string;
    dynamicAgents: readonly ProviderAgentDescriptor[];
  }) {
    return useComposerCommandMenuItems({
      composerTrigger: { kind: "mention", query: input.query } as never,
      provider: input.provider,
      providerPlugins: [],
      providerNativeCommands: [],
      providerSkills: [],
      workspaceEntries: [],
      searchableModelOptions: [],
      supportsFastSlashCommand: false,
      canOfferCompactCommand: false,
      canOfferReviewCommand: false,
      canOfferForkCommand: false,
      canOfferSideCommand: false,
      canOfferExportCommand: false,
      dynamicAgents: input.dynamicAgents,
    });
  }

  it("splits discovered agents, Synara built-ins, and Codex model aliases", () => {
    const items = mentionItems({
      provider: "codex",
      query: "",
      dynamicAgents: [
        { name: "coder", displayName: "coder", description: "Implements", source: "user" },
      ],
    });
    const agents = items.filter((item) => item.type === "agent");

    expect(agents.find((agent) => agent.alias === "coder")?.group).toBe("agent");
    expect(agents.find((agent) => agent.alias === "spark")?.group).toBe("model");
  });

  it("marks runtime-reported Synara built-ins as built-in, not user agents", () => {
    const items = mentionItems({
      provider: "claudeAgent",
      query: "",
      dynamicAgents: [
        { name: "explore", displayName: "Explore", source: "builtin" },
        { name: "ecc:security-reviewer", displayName: "ecc:security-reviewer", source: "sdk" },
      ],
    });
    const agents = items.filter((item) => item.type === "agent");

    expect(agents.find((agent) => agent.alias === "explore")?.group).toBe("builtin");
    expect(agents.find((agent) => agent.alias === "ecc:security-reviewer")?.group).toBe("agent");
    // The static alias must not re-add an agent discovery already reported.
    expect(agents.filter((agent) => agent.alias === "explore")).toHaveLength(1);
  });

  it("lists agents ahead of file paths", () => {
    const items = mentionItems({
      provider: "claudeAgent",
      query: "",
      dynamicAgents: [{ name: "coder", displayName: "coder", source: "user" }],
    });

    expect(items[0]?.type).toBe("agent");
  });
});

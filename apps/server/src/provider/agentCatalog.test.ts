import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  agentCatalogRoots,
  claudePluginAgentRoots,
  clearAgentCatalogCacheForTests,
  collectAgentsFromRoots,
  discoverAgentCatalog,
  mergeAgentDescriptors,
  parseCodexAgentToml,
} from "./agentCatalog.ts";

let tempDir: string;

beforeEach(async () => {
  clearAgentCatalogCacheForTests();
  tempDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "synara-agent-catalog-"));
});

afterEach(async () => {
  clearAgentCatalogCacheForTests();
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function writeFile(relativePath: string, contents: string): Promise<string> {
  const absolutePath = nodePath.join(tempDir, relativePath);
  await fs.mkdir(nodePath.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents, "utf8");
  return absolutePath;
}

describe("parseCodexAgentToml", () => {
  it("reads top-level scalars", () => {
    expect(
      parseCodexAgentToml(
        [
          'name = "coder"',
          'description = "Implements scoped changes"',
          'model = "gpt-5.6-sol"',
          'model_reasoning_effort = "high"',
        ].join("\n"),
      ),
    ).toEqual({
      name: "coder",
      description: "Implements scoped changes",
      model: "gpt-5.6-sol",
      model_reasoning_effort: "high",
    });
  });

  it("skips multi-line string bodies so embedded key = value lines are not read", () => {
    const parsed = parseCodexAgentToml(
      [
        'name = "reviewer"',
        'developer_instructions = """',
        "Example config:",
        '  name = "not-the-agent-name"',
        "  allWarningsAsErrors = true",
        '"""',
        'model = "gpt-5.4"',
      ].join("\n"),
    );

    expect(parsed.name).toBe("reviewer");
    expect(parsed.model).toBe("gpt-5.4");
    expect(parsed.allWarningsAsErrors).toBeUndefined();
  });

  it("reads single-line literal strings and stops at the first table header", () => {
    const parsed = parseCodexAgentToml(
      [
        "name = 'explorer'",
        "description = '''Explores the repo'''",
        "[features.multi_agent_v2]",
        "enabled = false",
      ].join("\n"),
    );

    expect(parsed.name).toBe("explorer");
    expect(parsed.description).toBe("Explores the repo");
    expect(parsed.enabled).toBeUndefined();
  });

  it("ignores comments and array values", () => {
    const parsed = parseCodexAgentToml(
      ["# a comment", 'name = "planner" # trailing', 'nickname_candidates = ["Planner"]'].join(
        "\n",
      ),
    );

    expect(parsed.name).toBe("planner");
    expect(parsed.nickname_candidates).toBeUndefined();
  });
});

describe("collectAgentsFromRoots", () => {
  it("skips Codex role files without a non-empty name, like Codex itself does", async () => {
    await writeFile(".codex/agents/coder.toml", 'name = "coder"\ndescription = "Implements"');
    await writeFile(".codex/agents/docs-researcher.toml", 'model = "gpt-5.4"');
    await writeFile(".codex/agents/blank-name.toml", 'name = "   "');
    await writeFile(".codex/agents/notes.md", "not a role file");

    const agents = await collectAgentsFromRoots({
      provider: "codex",
      roots: [{ path: nodePath.join(tempDir, ".codex", "agents"), source: "user" }],
    });

    expect(agents.map((agent) => agent.name)).toEqual(["coder"]);
    expect(agents[0]).toMatchObject({
      displayName: "coder",
      description: "Implements",
      source: "user",
    });
  });

  it("takes the Codex agent_type from `name`, not the filename", async () => {
    await writeFile(".codex/agents/file-name.toml", 'name = "declared-name"');

    const agents = await collectAgentsFromRoots({
      provider: "codex",
      roots: [{ path: nodePath.join(tempDir, ".codex", "agents"), source: "user" }],
    });

    expect(agents.map((agent) => agent.name)).toEqual(["declared-name"]);
  });

  it("reads nested Claude agent definitions and skips ones without a name", async () => {
    await writeFile(
      ".claude/agents/coder.md",
      "---\nname: coder\ndescription: Implements\nmodel: inherit\n---\n\nbody",
    );
    await writeFile(".claude/agents/ccg/planner.md", "---\nname: planner\n---\n\nbody");
    await writeFile(".claude/agents/nameless.md", "---\ndescription: no name here\n---\n");
    await writeFile(".claude/agents/coder.md.backup", "---\nname: coder-backup\n---\n");

    const agents = await collectAgentsFromRoots({
      provider: "claudeAgent",
      roots: [{ path: nodePath.join(tempDir, ".claude", "agents"), source: "user" }],
    });

    expect(agents.map((agent) => agent.name).toSorted()).toEqual(["coder", "planner"]);
    expect(agents.find((agent) => agent.name === "coder")?.model).toBe("inherit");
  });

  it("keeps the project definition when a name exists in several roots", async () => {
    await writeFile(".claude/agents/review.md", "---\nname: review\ndescription: user copy\n---\n");
    await writeFile(
      "workspace/.claude/agents/review.md",
      "---\nname: review\ndescription: project copy\n---\n",
    );

    const agents = await collectAgentsFromRoots({
      provider: "claudeAgent",
      roots: [
        { path: nodePath.join(tempDir, "workspace", ".claude", "agents"), source: "project" },
        { path: nodePath.join(tempDir, ".claude", "agents"), source: "user" },
      ],
    });

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ description: "project copy", source: "project" });
  });

  it("skips unreadable definitions instead of failing the whole scan", async () => {
    await writeFile(".codex/agents/good.toml", 'name = "good"');
    // An unterminated string makes `name` unreadable; the file is dropped, the scan is not.
    await writeFile(".codex/agents/broken.toml", 'name = "broken');

    const agents = await collectAgentsFromRoots({
      provider: "codex",
      roots: [{ path: nodePath.join(tempDir, ".codex", "agents"), source: "user" }],
    });

    expect(agents.map((agent) => agent.name)).toEqual(["good"]);
  });
});

describe("agentCatalogRoots", () => {
  it("orders project ancestors deepest-first ahead of the user root", () => {
    const roots = agentCatalogRoots({
      provider: "claudeAgent",
      homeDir: nodePath.join(tempDir, "home"),
      cwd: nodePath.join(tempDir, "repo", "packages", "web"),
    });

    expect(roots.at(-1)).toEqual({
      path: nodePath.join(tempDir, "home", ".claude", "agents"),
      source: "user",
    });
    expect(roots[0]?.path).toBe(
      nodePath.join(tempDir, "repo", "packages", "web", ".claude", "agents"),
    );
    expect(roots[1]?.path).toBe(nodePath.join(tempDir, "repo", "packages", ".claude", "agents"));
    expect(roots.every((root) => root.source === "project" || root === roots.at(-1))).toBe(true);
  });

  it("scans a home root only once when the cwd sits under the home dir", () => {
    const homeDir = nodePath.join(tempDir, "home");
    const roots = agentCatalogRoots({
      provider: "claudeAgent",
      homeDir,
      cwd: nodePath.join(homeDir, "projects", "app"),
    });

    const homeRootPath = nodePath.join(homeDir, ".claude", "agents");
    expect(roots.filter((root) => root.path === homeRootPath)).toEqual([
      { path: homeRootPath, source: "user" },
    ]);
  });

  it("scans only the home root for Codex, which ignores project-level role files", () => {
    const homeDir = nodePath.join(tempDir, "home");
    const roots = agentCatalogRoots({
      provider: "codex",
      homeDir,
      cwd: nodePath.join(tempDir, "repo"),
    });

    expect(roots).toEqual([{ path: nodePath.join(homeDir, ".codex", "agents"), source: "user" }]);
  });
});

describe("mergeAgentDescriptors", () => {
  it("keeps the first group's entry on a name conflict", () => {
    const merged = mergeAgentDescriptors([
      [{ name: "review", displayName: "review", source: "project" }],
      [{ name: "review", displayName: "review", source: "user" }],
      [{ name: "explore", displayName: "explore", source: "builtin" }],
    ]);

    expect(merged).toEqual([
      { name: "review", displayName: "review", source: "project" },
      { name: "explore", displayName: "explore", source: "builtin" },
    ]);
  });

  it("matches names case-insensitively", () => {
    const merged = mergeAgentDescriptors([
      [{ name: "Review", displayName: "Review", source: "user" }],
      [{ name: "review", displayName: "review", source: "sdk" }],
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("user");
  });
});

describe("discoverAgentCatalog", () => {
  it("discovers project and user agents together, project first", async () => {
    await writeFile(".claude/agents/user-only.md", "---\nname: user-only\n---\n");
    await writeFile("repo/.claude/agents/project-only.md", "---\nname: project-only\n---\n");

    const agents = await discoverAgentCatalog({
      provider: "claudeAgent",
      homeDir: tempDir,
      cwd: nodePath.join(tempDir, "repo"),
    });

    // The cwd's real ancestors are walked too, so filter to this fixture's
    // agents; their relative order still proves project roots are scanned first.
    expect(agents.map((agent) => agent.name).filter((name) => name.endsWith("-only"))).toEqual([
      "project-only",
      "user-only",
    ]);
  });

  it("picks up a newly added definition without a forced reload", async () => {
    await writeFile(".codex/agents/first.toml", 'name = "first"');
    const input = { provider: "codex", homeDir: tempDir } as const;

    expect((await discoverAgentCatalog(input)).map((agent) => agent.name)).toEqual(["first"]);

    await writeFile(".codex/agents/second.toml", 'name = "second"');

    expect((await discoverAgentCatalog(input)).map((agent) => agent.name).toSorted()).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("claudePluginAgentRoots", () => {
  it("namespaces installed plugin subagents and skips uninstalled marketplace copies", async () => {
    const installPath = nodePath.join(
      tempDir,
      ".claude/plugins/cache/fable-advisor/fable-advisor/3.1.0",
    );
    await writeFile(
      ".claude/plugins/installed_plugins.json",
      JSON.stringify({
        version: 2,
        plugins: { "fable-advisor@fable-advisor": [{ scope: "user", installPath }] },
      }),
    );
    await writeFile(
      ".claude/plugins/cache/fable-advisor/fable-advisor/3.1.0/agents/grok-implementer.md",
      "---\nname: grok-implementer\ndescription: Grok lane\n---\n",
    );
    // Browsable but never installed. Listing it would offer a mention that
    // silently does nothing, since Claude Code cannot spawn it.
    await writeFile(
      ".claude/plugins/marketplaces/other-market/agents/not-installed.md",
      "---\nname: not-installed\ndescription: Should stay hidden\n---\n",
    );

    const names = (await discoverAgentCatalog({ provider: "claudeAgent", homeDir: tempDir })).map(
      (agent) => agent.name,
    );

    expect(names).toContain("fable-advisor:grok-implementer");
    expect(names).not.toContain("not-installed");
  });

  it("returns no roots when the manifest is missing or malformed", async () => {
    expect(await claudePluginAgentRoots({ homeDir: tempDir })).toEqual([]);

    await writeFile(".claude/plugins/installed_plugins.json", "{ not valid json");
    expect(await claudePluginAgentRoots({ homeDir: tempDir })).toEqual([]);
  });
});

describe("claudePluginAgentRoots enablement", () => {
  // Two installed plugins, one of which the settings layer never mentions.
  async function writeTwoInstalledPlugins(): Promise<void> {
    await writeFile(
      ".claude/plugins/installed_plugins.json",
      JSON.stringify({
        version: 2,
        plugins: {
          "hookify@claude-plugins-official": [
            {
              installPath: nodePath.join(
                tempDir,
                ".claude/plugins/cache/claude-plugins-official/hookify/1.0.0",
              ),
            },
          ],
          "ecc@everything-claude-code": [
            {
              installPath: nodePath.join(
                tempDir,
                ".claude/plugins/cache/everything-claude-code/ecc/2.0.0",
              ),
            },
          ],
        },
      }),
    );
    await writeFile(
      ".claude/plugins/cache/claude-plugins-official/hookify/1.0.0/agents/conversation-analyzer.md",
      "---\nname: conversation-analyzer\n---\n",
    );
    await writeFile(
      ".claude/plugins/cache/everything-claude-code/ecc/2.0.0/agents/code-explorer.md",
      "---\nname: code-explorer\n---\n",
    );
  }

  async function catalogNames(cwd?: string): Promise<string[]> {
    clearAgentCatalogCacheForTests();
    const agents = await discoverAgentCatalog({
      provider: "claudeAgent",
      homeDir: tempDir,
      ...(cwd ? { cwd } : {}),
    });
    return agents.map((agent) => agent.name);
  }

  // The ECC case: installed and fully present on disk (67 agents), but absent
  // from `enabledPlugins`, so Claude Code never loads it and every mention it
  // would contribute is unspawnable.
  it("skips an installed plugin that enabledPlugins never lists", async () => {
    await writeTwoInstalledPlugins();
    await writeFile(
      ".claude/settings.json",
      JSON.stringify({ enabledPlugins: { "hookify@claude-plugins-official": true } }),
    );

    const names = await catalogNames();

    expect(names).toContain("hookify:conversation-analyzer");
    expect(names).not.toContain("ecc:code-explorer");
  });

  it("skips a plugin disabled explicitly", async () => {
    await writeTwoInstalledPlugins();
    await writeFile(
      ".claude/settings.json",
      JSON.stringify({
        enabledPlugins: {
          "hookify@claude-plugins-official": true,
          "ecc@everything-claude-code": false,
        },
      }),
    );

    expect(await catalogNames()).not.toContain("ecc:code-explorer");
  });

  // Without this fallback, a user who never toggled a plugin would silently lose
  // every plugin subagent instead of just the disabled ones.
  it("keeps every installed plugin when no settings layer declares enabledPlugins", async () => {
    await writeTwoInstalledPlugins();
    await writeFile(".claude/settings.json", JSON.stringify({ model: "opus" }));

    const names = await catalogNames();

    expect(names).toContain("hookify:conversation-analyzer");
    expect(names).toContain("ecc:code-explorer");
  });

  it("lets a local override re-enable what the user layer disabled", async () => {
    await writeTwoInstalledPlugins();
    await writeFile(
      ".claude/settings.json",
      JSON.stringify({ enabledPlugins: { "ecc@everything-claude-code": false } }),
    );
    await writeFile(
      ".claude/settings.local.json",
      JSON.stringify({ enabledPlugins: { "ecc@everything-claude-code": true } }),
    );

    expect(await catalogNames()).toContain("ecc:code-explorer");
  });

  // Passing a cwd walks its real ancestors too, so a machine-level settings file
  // can join the merge; the project layer outranks all of them, which is exactly
  // what this asserts.
  it("lets project settings override the home layer", async () => {
    await writeTwoInstalledPlugins();
    await writeFile(
      ".claude/settings.json",
      JSON.stringify({ enabledPlugins: { "ecc@everything-claude-code": false } }),
    );
    const projectDir = nodePath.join(tempDir, "repo");
    await writeFile(
      "repo/.claude/settings.json",
      JSON.stringify({ enabledPlugins: { "ecc@everything-claude-code": true } }),
    );

    expect(await catalogNames(projectDir)).toContain("ecc:code-explorer");
  });
});

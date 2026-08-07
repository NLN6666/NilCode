// FILE: agentCatalog.ts
// Purpose: Cross-provider subagent discovery. Scans the on-disk agent definitions
//          Claude Code (`.claude/agents/**/*.md`) and Codex (`.codex/agents/*.toml`)
//          actually load, so the composer can `@`-mention the user's real subagents.
//          Runtime-reported agents (Claude SDK/plugin) are merged on top by the
//          adapters via `mergeAgentDescriptors`.
// Layer: Server provider discovery helper
// Exports: AgentCatalogProvider, AgentRoot, parseCodexAgentToml, agentCatalogRoots,
//          collectAgentsFromRoots, discoverAgentCatalog, mergeAgentDescriptors,
//          agentNameKey, resolveEnabledClaudePlugins, clearAgentCatalogCacheForTests

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { ProviderAgentDescriptor, ProviderAgentSource } from "@synara/contracts";

import { parseScalarFrontmatter, readFrontmatterString, readdirOrEmpty } from "./frontmatter.ts";
import { ancestorsFromDeepest } from "./skillsCatalog.ts";

/** Providers whose subagents are defined as files on disk. */
export type AgentCatalogProvider = "claudeAgent" | "codex";

export interface AgentRoot {
  readonly path: string;
  readonly source: Extract<ProviderAgentSource, "project" | "user" | "sdk">;
  /**
   * Plugin namespace. Plugin subagents are mentioned as `<prefix>:<name>` because
   * their frontmatter only carries the bare name; Claude Code adds the namespace.
   */
  readonly namePrefix?: string;
}

// Nested namespaces are common under `~/.claude/agents` (e.g. `ccg/planner.md`);
// keep the walk shallow so a stray deep tree can't stall composer discovery.
const CLAUDE_AGENT_WALK_MAX_DEPTH = 3;

// ── Codex TOML ───────────────────────────────────────────────────────

// Codex agent roles only need a handful of top-level scalars, so this reads the
// same TOML subset `parseScalarFrontmatter` reads for YAML rather than pulling in
// a parser. It is structure-aware where it has to be: multi-line strings are
// skipped wholesale (their bodies routinely contain `key = value` lines from
// embedded examples) and scanning stops at the first table header so nested
// `[features.x] enabled = false` never masquerades as a top-level key.
export function parseCodexAgentToml(raw: string): Record<string, string> {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const record: Record<string, string> = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    // Everything after the first table header belongs to that table.
    if (trimmed.startsWith("[")) {
      break;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (key.length === 0) {
      continue;
    }

    const multilineDelimiter = rawValue.startsWith('"""')
      ? '"""'
      : rawValue.startsWith("'''")
        ? "'''"
        : null;
    if (multilineDelimiter) {
      const closingOnSameLine =
        rawValue.length > multilineDelimiter.length * 2 - 1 &&
        rawValue.slice(multilineDelimiter.length).includes(multilineDelimiter);
      if (closingOnSameLine) {
        const body = rawValue.slice(multilineDelimiter.length);
        record[key] = body.slice(0, body.indexOf(multilineDelimiter));
        continue;
      }
      // Consume until the closing delimiter; the body itself is not needed.
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").includes(multilineDelimiter)) {
        index += 1;
      }
      continue;
    }

    const value = readTomlSingleLineScalar(rawValue);
    if (value !== null) {
      record[key] = value;
    }
  }

  return record;
}

function readTomlSingleLineScalar(rawValue: string): string | null {
  const quote = rawValue.startsWith('"') ? '"' : rawValue.startsWith("'") ? "'" : null;
  if (!quote) {
    // Bare scalars (numbers, booleans, arrays, inline tables) are not used by any
    // field we read; keep only the comment-stripped literal for completeness.
    const withoutComment = rawValue.split("#")[0]?.trim() ?? "";
    return withoutComment.length > 0 && !withoutComment.startsWith("[") ? withoutComment : null;
  }

  let result = "";
  for (let cursor = 1; cursor < rawValue.length; cursor += 1) {
    const char = rawValue[cursor];
    // Literal strings ('...') take no escapes; basic strings ("...") do.
    if (quote === '"' && char === "\\") {
      const next = rawValue[cursor + 1];
      if (next !== undefined) {
        result += next === "n" ? "\n" : next === "t" ? "\t" : next;
        cursor += 1;
        continue;
      }
    }
    if (char === quote) {
      return result;
    }
    result += char;
  }
  // Unterminated string: treat the file as malformed for this key.
  return null;
}

// ── Discovery roots ──────────────────────────────────────────────────

interface AgentRootSpec {
  readonly dirName: string;
  readonly subDir: string;
  /** Codex only loads role files from the home dir; a project copy is never picked up. */
  readonly supportsProjectRoots: boolean;
}

const AGENT_ROOT_SPECS = {
  claudeAgent: { dirName: ".claude", subDir: "agents", supportsProjectRoots: true },
  codex: { dirName: ".codex", subDir: "agents", supportsProjectRoots: false },
} as const satisfies Record<AgentCatalogProvider, AgentRootSpec>;

export interface AgentCatalogInput {
  readonly provider: AgentCatalogProvider;
  readonly homeDir: string;
  /** Workspace cwd; every ancestor contributes a project-level root, deepest first. */
  readonly cwd?: string | null;
  readonly forceReload?: boolean;
}

// Project roots come first (deepest ancestor first) so the closest definition
// wins, then the user's home root. A cwd under the home dir would otherwise
// reach the home root twice; it is scanned once and keeps the "user" source.
export function agentCatalogRoots(input: AgentCatalogInput): AgentRoot[] {
  const spec = AGENT_ROOT_SPECS[input.provider];
  const homeRoot = nodePath.join(input.homeDir, spec.dirName, spec.subDir);
  const resolvedHomeRoot = nodePath.resolve(homeRoot);

  const projectRoots: AgentRoot[] = [];
  const cwd = spec.supportsProjectRoots ? input.cwd?.trim() : undefined;
  if (cwd) {
    for (const ancestor of ancestorsFromDeepest(cwd)) {
      const rootPath = nodePath.join(ancestor, spec.dirName, spec.subDir);
      if (nodePath.resolve(rootPath) === resolvedHomeRoot) {
        continue;
      }
      projectRoots.push({ path: rootPath, source: "project" });
    }
  }

  return [...projectRoots, { path: homeRoot, source: "user" }];
}

// ── Descriptor reads ─────────────────────────────────────────────────

async function readClaudeAgentDescriptor(input: {
  readonly agentPath: string;
  readonly source: AgentRoot["source"];
  readonly namePrefix?: string | undefined;
}): Promise<ProviderAgentDescriptor | null> {
  let raw: string;
  try {
    raw = await fs.readFile(input.agentPath, "utf8");
  } catch {
    return null;
  }

  const frontmatter = parseScalarFrontmatter(raw);
  // Claude Code keys subagents by the frontmatter `name`, not by the filename.
  const name = readFrontmatterString(frontmatter, ["name"]);
  if (!name) {
    return null;
  }
  const description = readFrontmatterString(frontmatter, ["description"]);
  const model = readFrontmatterString(frontmatter, ["model"]);
  const qualifiedName = input.namePrefix ? `${input.namePrefix}:${name}` : name;

  return {
    name: qualifiedName,
    displayName: qualifiedName,
    ...(description ? { description } : {}),
    ...(model ? { model } : {}),
    source: input.source,
    path: input.agentPath,
  };
}

async function readCodexAgentDescriptor(input: {
  readonly agentPath: string;
  readonly source: AgentRoot["source"];
}): Promise<ProviderAgentDescriptor | null> {
  let raw: string;
  try {
    raw = await fs.readFile(input.agentPath, "utf8");
  } catch {
    return null;
  }

  const table = parseCodexAgentToml(raw);
  // Codex ignores role files without a non-empty `name` ("Ignoring malformed
  // agent role definition") and uses that name as the spawn `agent_type`, so a
  // file listed here without one would be un-spawnable.
  const name = table.name?.trim();
  if (!name) {
    return null;
  }
  const description = table.description?.trim();
  const model = table.model?.trim();

  return {
    name,
    displayName: name,
    ...(description ? { description } : {}),
    ...(model ? { model } : {}),
    source: input.source,
    path: input.agentPath,
  };
}

async function isReadableFile(parentPath: string, dirent: import("node:fs").Dirent) {
  if (dirent.isFile()) {
    return true;
  }
  if (!dirent.isSymbolicLink()) {
    return false;
  }
  try {
    return (await fs.stat(nodePath.join(parentPath, dirent.name))).isFile();
  } catch {
    return false;
  }
}

async function isWalkableDirectory(parentPath: string, dirent: import("node:fs").Dirent) {
  if (dirent.isDirectory()) {
    return true;
  }
  if (!dirent.isSymbolicLink()) {
    return false;
  }
  try {
    return (await fs.stat(nodePath.join(parentPath, dirent.name))).isDirectory();
  } catch {
    return false;
  }
}

async function collectAgentFilePaths(input: {
  readonly rootPath: string;
  readonly extension: string;
  readonly maxDepth: number;
}): Promise<string[]> {
  async function visit(dir: string, depth: number): Promise<string[]> {
    const dirents = await readdirOrEmpty(dir);
    const classified = await Promise.all(
      dirents.map(async (dirent) => ({
        name: dirent.name,
        isFile:
          dirent.name.toLowerCase().endsWith(input.extension) &&
          (await isReadableFile(dir, dirent)),
        isDirectory: depth < input.maxDepth && (await isWalkableDirectory(dir, dirent)),
      })),
    );
    // Sort so name-dedup picks the same winner on every run.
    const files = classified
      .filter((entry) => entry.isFile)
      .map((entry) => nodePath.join(dir, entry.name))
      .toSorted();
    const subdirNames = classified
      .filter((entry) => entry.isDirectory && !entry.isFile)
      .map((entry) => entry.name)
      .toSorted();
    const nested = await Promise.all(
      subdirNames.map((name) => visit(nodePath.join(dir, name), depth + 1)),
    );
    return [...files, ...nested.flat()];
  }

  return visit(input.rootPath, 0);
}

export function agentNameKey(name: string): string {
  return name.trim().toLowerCase();
}

// Dedupes by name across the supplied groups in order, so earlier groups win.
// Callers pass groups already ordered by precedence (project > user > sdk > builtin).
export function mergeAgentDescriptors(
  groups: ReadonlyArray<ReadonlyArray<ProviderAgentDescriptor>>,
): ProviderAgentDescriptor[] {
  const byName = new Map<string, ProviderAgentDescriptor>();
  for (const group of groups) {
    for (const agent of group) {
      const key = agentNameKey(agent.name);
      if (key.length > 0 && !byName.has(key)) {
        byName.set(key, agent);
      }
    }
  }
  return [...byName.values()];
}

// Scans every root concurrently. A file that fails to read or parse is skipped
// rather than failing the scan, so one malformed definition can't empty the menu.
export async function collectAgentsFromRoots(input: {
  readonly provider: AgentCatalogProvider;
  readonly roots: ReadonlyArray<AgentRoot>;
}): Promise<ProviderAgentDescriptor[]> {
  const isClaude = input.provider === "claudeAgent";
  const perRoot = await Promise.all(
    input.roots.map(async (root) => {
      const agentPaths = await collectAgentFilePaths({
        rootPath: root.path,
        extension: isClaude ? ".md" : ".toml",
        maxDepth: isClaude ? CLAUDE_AGENT_WALK_MAX_DEPTH : 0,
      });
      const descriptors = await Promise.all(
        agentPaths.map((agentPath) =>
          isClaude
            ? readClaudeAgentDescriptor({
                agentPath,
                source: root.source,
                namePrefix: root.namePrefix,
              })
            : readCodexAgentDescriptor({ agentPath, source: root.source }),
        ),
      );
      return descriptors.filter((descriptor) => descriptor !== null);
    }),
  );
  return mergeAgentDescriptors(perRoot);
}

// ── Claude plugin roots ──────────────────────────────────────────────

interface InstalledPluginEntry {
  readonly installPath?: string;
}

interface InstalledPluginsFile {
  readonly plugins?: Record<string, ReadonlyArray<InstalledPluginEntry>>;
}

interface ClaudeSettingsFile {
  readonly enabledPlugins?: Record<string, boolean>;
}

// Dirs contributing `enabledPlugins`, lowest precedence first: the home dir,
// then every cwd ancestor shallowest-first so the closest project settings win.
// A cwd under the home dir would repeat it; the first (lowest) position is kept,
// matching how `agentCatalogRoots` dedupes the same overlap.
function claudeSettingsDirs(input: {
  readonly homeDir: string;
  readonly cwd?: string | null;
}): string[] {
  const dirs = [input.homeDir];
  const cwd = input.cwd?.trim();
  if (cwd) {
    dirs.push(...ancestorsFromDeepest(cwd).toReversed());
  }

  const seen = new Set<string>();
  return dirs.filter((dir) => {
    const resolved = nodePath.resolve(dir);
    if (seen.has(resolved)) {
      return false;
    }
    seen.add(resolved);
    return true;
  });
}

async function readEnabledPlugins(settingsPath: string): Promise<Record<string, boolean> | null> {
  let parsed: ClaudeSettingsFile;
  try {
    parsed = JSON.parse(await fs.readFile(settingsPath, "utf8")) as ClaudeSettingsFile;
  } catch {
    return null;
  }
  const enabled = parsed?.enabledPlugins;
  return enabled && typeof enabled === "object" && !Array.isArray(enabled) ? enabled : null;
}

/**
 * Merged `enabledPlugins` toggles across the settings layers, or `null` when no
 * layer declares the key at all.
 *
 * Installing a plugin only downloads it; Claude Code loads a plugin's subagents
 * only while that plugin is also enabled, so an installed-but-disabled plugin
 * leaves its definitions on disk unusable. `null` means "nobody recorded an
 * opinion" and callers must not filter on it — a user who never toggled a
 * plugin would otherwise lose every plugin subagent at once.
 */
export async function resolveEnabledClaudePlugins(input: {
  readonly homeDir: string;
  readonly cwd?: string | null;
}): Promise<ReadonlyMap<string, boolean> | null> {
  // `.local.json` overrides its sibling, so it follows it in every dir.
  const settingsPaths = claudeSettingsDirs(input).flatMap((dir) => [
    nodePath.join(dir, ".claude", "settings.json"),
    nodePath.join(dir, ".claude", "settings.local.json"),
  ]);
  const files = await Promise.all(settingsPaths.map(readEnabledPlugins));

  let merged: Map<string, boolean> | null = null;
  for (const file of files) {
    if (!file) {
      continue;
    }
    merged ??= new Map<string, boolean>();
    for (const [key, value] of Object.entries(file)) {
      if (typeof value === "boolean") {
        merged.set(key, value);
      }
    }
  }
  return merged;
}

/**
 * Plugin subagents (`fable-advisor:grok-implementer`) live under each plugin's
 * install directory, not `~/.claude/agents`, so a plain home-root scan misses
 * them entirely and they would only ever arrive via the SDK's async reply.
 *
 * Two on-disk sets are deliberately withheld, both of which would offer mentions
 * that silently do nothing because Claude Code cannot spawn them:
 * - `plugins/marketplaces` holds hundreds of browsable-but-uninstalled copies;
 *   only entries listed in `installed_plugins.json` are installed at all.
 * - Installed-but-disabled plugins keep their full `agents/` directory on disk.
 *   A plugin missing from `enabledPlugins` counts as disabled rather than
 *   undecided: Claude Code records every plugin it loads, so an absent key means
 *   the plugin is not loaded.
 */
export async function claudePluginAgentRoots(input: {
  readonly homeDir: string;
  readonly cwd?: string | null;
}): Promise<AgentRoot[]> {
  const manifestPath = nodePath.join(input.homeDir, ".claude", "plugins", "installed_plugins.json");

  let parsed: InstalledPluginsFile;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, "utf8")) as InstalledPluginsFile;
  } catch {
    return [];
  }

  const enabledPlugins = await resolveEnabledClaudePlugins(input);
  const roots: AgentRoot[] = [];
  for (const [key, installs] of Object.entries(parsed.plugins ?? {})) {
    // Keys are `<plugin>@<marketplace>`; the mention namespace is the plugin part.
    const pluginName = key.split("@")[0]?.trim();
    if (!pluginName) {
      continue;
    }
    if (enabledPlugins && enabledPlugins.get(key) !== true) {
      continue;
    }
    for (const install of installs ?? []) {
      const installPath = install?.installPath?.trim();
      if (!installPath) {
        continue;
      }
      roots.push({
        path: nodePath.join(installPath, "agents"),
        source: "sdk",
        namePrefix: pluginName,
      });
    }
  }
  return roots;
}

// ── Cache ────────────────────────────────────────────────────────────

// Root mtimes catch added/removed/renamed definitions immediately; the TTL bounds
// how long an edit inside an existing file can stay stale. Composer menus refetch
// per keystroke, so both guards matter.
const AGENT_CATALOG_CACHE_TTL_MS = 30_000;
const AGENT_CATALOG_CACHE_MAX_ENTRIES = 32;

interface AgentCatalogCacheEntry {
  readonly at: number;
  readonly fingerprint: string;
  readonly agents: ReadonlyArray<ProviderAgentDescriptor>;
}

const agentCatalogCache = new Map<string, AgentCatalogCacheEntry>();
const agentCatalogInflight = new Map<string, Promise<ReadonlyArray<ProviderAgentDescriptor>>>();

export function clearAgentCatalogCacheForTests(): void {
  agentCatalogCache.clear();
  agentCatalogInflight.clear();
}

async function fingerprintRoots(roots: ReadonlyArray<AgentRoot>): Promise<string> {
  const stamps = await Promise.all(
    roots.map(async (root) => {
      try {
        const stat = await fs.stat(root.path);
        return `${root.path}:${stat.mtimeMs}`;
      } catch {
        return `${root.path}:-`;
      }
    }),
  );
  return stamps.join(" ");
}

export async function discoverAgentCatalog(
  input: AgentCatalogInput,
): Promise<ProviderAgentDescriptor[]> {
  // Plugin roots come last so a project- or user-level definition of the same
  // name still wins, matching the locked precedence (project > user > sdk/plugin).
  // They also feed the fingerprint, so installing a plugin invalidates the cache.
  const roots =
    input.provider === "claudeAgent"
      ? [...agentCatalogRoots(input), ...(await claudePluginAgentRoots(input))]
      : agentCatalogRoots(input);
  const cacheKey = [input.provider, input.homeDir, input.cwd?.trim() ?? ""].join(" ");

  if (!input.forceReload) {
    const entry = agentCatalogCache.get(cacheKey);
    if (entry && Date.now() - entry.at <= AGENT_CATALOG_CACHE_TTL_MS) {
      const fingerprint = await fingerprintRoots(roots);
      if (fingerprint === entry.fingerprint) {
        return [...entry.agents];
      }
    }
  }

  const inflight = agentCatalogInflight.get(cacheKey);
  if (inflight) {
    return [...(await inflight)];
  }

  const scan = (async () => {
    const [agents, fingerprint] = await Promise.all([
      collectAgentsFromRoots({ provider: input.provider, roots }),
      fingerprintRoots(roots),
    ]);

    agentCatalogCache.delete(cacheKey);
    agentCatalogCache.set(cacheKey, { at: Date.now(), fingerprint, agents });
    while (agentCatalogCache.size > AGENT_CATALOG_CACHE_MAX_ENTRIES) {
      const oldestKey = agentCatalogCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      agentCatalogCache.delete(oldestKey);
    }
    return agents;
  })();

  agentCatalogInflight.set(cacheKey, scan);
  try {
    return [...(await scan)];
  } finally {
    agentCatalogInflight.delete(cacheKey);
  }
}

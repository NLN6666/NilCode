// FILE: skillsCatalog.ts
// Purpose: Generic Agent Skill discovery primitives (SKILL.md walking, frontmatter
//          parsing re-exported from ./frontmatter) plus the skills catalog backing Synara
//          portable skills. A provider-scoped scan is isolated to the folders that provider
//          actually loads (see `@synara/shared/skillOrigins`) plus `~/.synara/skills` and the
//          workspace; only the provider-less scan Settings uses spans every origin.
// Layer: Server provider discovery helper
// Exports: parseSkillFrontmatter, collectSkillsFromRoots, discoverSkillsCatalog,
//          mergeSkillsIntoCatalog, filterDisabledSkills, ensureSynaraSkillsDir

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { ProviderKind, ProviderSkillDescriptor } from "@synara/contracts";
import {
  SKILL_HOME_ORIGIN_ORDER,
  type SkillHomeOrigin,
  skillNameKey,
  skillOriginsForProvider,
} from "@synara/shared/skillOrigins";
import { discoverClaudePluginSkillRoots } from "./claudePluginSkills.ts";

import {
  parseScalarFrontmatter,
  readFrontmatterBoolean as readBooleanField,
  readFrontmatterString as readStringField,
  readdirOrEmpty,
} from "./frontmatter.ts";

export interface SkillRoot {
  readonly path: string;
  readonly scope: string;
  readonly includeMarkdownFiles?: boolean;
  /** Prefix used by plugin-provided skills whose native invocation is namespaced. */
  readonly namespace?: string;
  /** Provider-owned plugin caches should not traverse linked content outside the install. */
  readonly followSymlinks?: boolean;
}

// Frontmatter parsing lives in `./frontmatter.ts` so the subagent catalog reads
// the same scalar subset; the historic name stays for existing call sites.
export { parseScalarFrontmatter as parseSkillFrontmatter };

// ── Filesystem walking ───────────────────────────────────────────────

export function ancestorsFromDeepest(cwd: string): string[] {
  const resolved = nodePath.resolve(cwd);
  const ancestors: string[] = [];
  let current = resolved;
  while (true) {
    ancestors.push(current);
    const parent = nodePath.dirname(current);
    if (parent === current) {
      return ancestors;
    }
    current = parent;
  }
}

async function isWalkableSkillDirectory(
  parentPath: string,
  dirent: import("node:fs").Dirent,
  followSymlinks: boolean,
): Promise<boolean> {
  if (dirent.isDirectory()) {
    return true;
  }
  if (!followSymlinks || !dirent.isSymbolicLink()) {
    return false;
  }
  try {
    return (await fs.stat(nodePath.join(parentPath, dirent.name))).isDirectory();
  } catch {
    return false;
  }
}

// Skills may be nested one namespace deep, e.g. `.cursor/skills/skills-sh/find-skills`.
// Subdirectories are visited concurrently but results are flattened in sorted name
// order so name-dedup always picks the same winner across runs. Provider skill
// folders may be symlinked, so directory checks intentionally follow symlinks.
async function isReadableMarkdownFile(
  parentPath: string,
  dirent: import("node:fs").Dirent,
): Promise<boolean> {
  if (!dirent.name.toLowerCase().endsWith(".md") || dirent.name.toLowerCase() === "skill.md") {
    return false;
  }
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

export async function collectSkillMarkdownPaths(
  rootPath: string,
  options?: {
    readonly includeMarkdownFiles?: boolean;
    readonly followSymlinks?: boolean;
  },
): Promise<string[]> {
  async function visit(dir: string, depth: number): Promise<string[]> {
    const skillPath = nodePath.join(dir, "SKILL.md");
    try {
      const stat =
        options?.followSymlinks === false ? await fs.lstat(skillPath) : await fs.stat(skillPath);
      if (stat.isFile()) {
        return [skillPath];
      }
    } catch {
      // Keep walking; this directory may be a namespace rather than a skill.
    }

    if (depth >= 2) {
      return [];
    }

    const dirents = await readdirOrEmpty(dir);
    const directMarkdownFiles =
      depth === 0 && options?.includeMarkdownFiles
        ? (
            await Promise.all(
              dirents.map(async (dirent) => ({
                name: dirent.name,
                isMarkdownFile: await isReadableMarkdownFile(dir, dirent),
              })),
            )
          )
            .filter((entry) => entry.isMarkdownFile)
            .map((entry) => nodePath.join(dir, entry.name))
            .sort()
        : [];
    const subdirNames = (
      await Promise.all(
        dirents.map(async (dirent) => ({
          name: dirent.name,
          isDirectory: await isWalkableSkillDirectory(
            dir,
            dirent,
            options?.followSymlinks !== false,
          ),
        })),
      )
    )
      .filter((entry) => entry.isDirectory)
      .map((entry) => entry.name)
      .sort();
    const nested = await Promise.all(
      subdirNames.map((name) => visit(nodePath.join(dir, name), depth + 1)),
    );
    return [...directMarkdownFiles, ...nested.flat()];
  }

  return visit(rootPath, 0);
}

export async function readSkillDescriptor(input: {
  readonly skillPath: string;
  readonly scope: string;
  readonly namespace?: string;
}): Promise<ProviderSkillDescriptor | null> {
  let raw: string;
  try {
    raw = await fs.readFile(input.skillPath, "utf8");
  } catch {
    return null;
  }

  const frontmatter = parseScalarFrontmatter(raw);
  const skillFilename = nodePath.basename(input.skillPath);
  const fallbackName =
    skillFilename.toLowerCase() === "skill.md"
      ? nodePath.basename(nodePath.dirname(input.skillPath))
      : nodePath.basename(input.skillPath, nodePath.extname(input.skillPath));
  const unqualifiedName = readStringField(frontmatter, ["name"]) ?? fallbackName;
  const name =
    input.namespace && !unqualifiedName.includes(":")
      ? `${input.namespace}:${unqualifiedName}`
      : unqualifiedName;
  const description = readStringField(frontmatter, ["description"]);
  const displayName = readStringField(frontmatter, ["display-name", "displayName", "title"]);
  const shortDescription = readStringField(frontmatter, [
    "short-description",
    "shortDescription",
    "summary",
  ]);
  const disabled =
    readBooleanField(frontmatter, ["disable-model-invocation", "disableModelInvocation"]) === true;

  return {
    name,
    ...(description ? { description } : {}),
    path: input.skillPath,
    enabled: !disabled,
    scope: input.scope,
    ...(displayName || shortDescription
      ? {
          interface: {
            ...(displayName ? { displayName } : {}),
            ...(shortDescription ? { shortDescription } : {}),
          },
        }
      : {}),
  };
}

async function collectSkillDescriptorsFromRoots(
  roots: ReadonlyArray<SkillRoot>,
): Promise<ProviderSkillDescriptor[]> {
  const skillsPerRoot = await Promise.all(
    roots.map(async (root) => {
      const skillPaths = await collectSkillMarkdownPaths(
        root.path,
        root.includeMarkdownFiles || root.followSymlinks === false
          ? {
              ...(root.includeMarkdownFiles ? { includeMarkdownFiles: true } : {}),
              ...(root.followSymlinks === false ? { followSymlinks: false } : {}),
            }
          : undefined,
      );
      const descriptors = await Promise.all(
        skillPaths.map((skillPath) =>
          readSkillDescriptor({
            skillPath,
            scope: root.scope,
            ...(root.namespace ? { namespace: root.namespace } : {}),
          }),
        ),
      );
      return descriptors.filter((skill) => skill !== null);
    }),
  );
  return skillsPerRoot.flat();
}

// Scans all roots concurrently, then dedupes by name in root order so earlier
// roots keep precedence. Within a root, SKILL.md path order is preserved.
export async function collectSkillsFromRoots(
  roots: ReadonlyArray<SkillRoot>,
): Promise<ProviderSkillDescriptor[]> {
  const allSkills = await collectSkillDescriptorsFromRoots(roots);
  const byName = new Map<string, ProviderSkillDescriptor>();
  for (const skill of allSkills) {
    const key = skillNameKey(skill.name);
    if (!byName.has(key)) {
      byName.set(key, skill);
    }
  }
  return [...byName.values()];
}

// ── Unified cross-provider catalog ───────────────────────────────────

export interface SkillsCatalogDiscoveryInput {
  /** Optional workspace cwd; when present, project-level skill folders are included. */
  readonly cwd?: string | null;
  readonly homeDir: string;
  /** Synara base dir (usually `~/.synara`); skills live in `{base}/skills`. */
  readonly synaraBaseDir: string;
  /**
   * Scopes the scan. With a provider, only the folders that provider actually loads are
   * walked — a Codex session never sees `~/.claude/skills`. Without one, every origin is
   * walked; that is the machine-wide view Settings renders.
   */
  readonly provider?: ProviderKind | null;
  /** Settings needs every origin; composer/provider pickers keep one winner by name. */
  readonly includeDuplicateOrigins?: boolean;
  /** Bypass the short-lived discovery cache. */
  readonly forceReload?: boolean;
  /** Provider-configured agent dir (pi/omp) — overrides the default profile root. */
  readonly agentDir?: string | null;
}

export interface SkillsCatalogRootInput extends SkillsCatalogDiscoveryInput {
  /** Native provider scans can opt out; the catalog itself always includes Synara. */
  readonly includeSynaraRoot?: boolean;
}

// Composer skill pickers refetch aggressively (per keystroke, per provider); a
// short TTL absorbs that burst while still picking up new skill files quickly.
const SKILLS_CATALOG_CACHE_TTL_MS = 15_000;
const SKILLS_CATALOG_CACHE_MAX_ENTRIES = 64;

interface SkillsCatalogCacheEntry {
  readonly at: number;
  readonly skills: ReadonlyArray<ProviderSkillDescriptor>;
}

const skillsCatalogCache = new Map<string, SkillsCatalogCacheEntry>();
const skillsCatalogInflight = new Map<string, Promise<ReadonlyArray<ProviderSkillDescriptor>>>();
const ensuredSynaraSkillsDirs = new Set<string>();

export function clearSkillsCatalogCacheForTests(): void {
  skillsCatalogCache.clear();
  skillsCatalogInflight.clear();
  ensuredSynaraSkillsDirs.clear();
}

export function synaraSkillsDir(synaraBaseDir: string): string {
  return nodePath.join(synaraBaseDir, "skills");
}

// Creates the portable skills folder on first use so users have a drop-in target.
export async function ensureSynaraSkillsDir(synaraBaseDir: string): Promise<string> {
  const dir = synaraSkillsDir(synaraBaseDir);
  if (ensuredSynaraSkillsDirs.has(dir)) {
    return dir;
  }
  try {
    await fs.mkdir(dir, { recursive: true });
    ensuredSynaraSkillsDirs.add(dir);
  } catch {
    // Discovery still works without the folder; reads simply return nothing.
  }
  return dir;
}

interface SkillOriginRootSpec {
  readonly homeRoots: (input: SkillsCatalogDiscoveryInput) => string[];
  readonly projectRootNames: readonly string[];
}

const SKILL_ORIGIN_ROOTS = {
  synara: {
    homeRoots: (input) => [synaraSkillsDir(input.synaraBaseDir)],
    projectRootNames: [".synara"],
  },
  codex: {
    // Keep Synara's existing Codex-local root. Official Codex discovery uses
    // `.agents/skills`, which is represented separately by the shared origin.
    homeRoots: (input) => [nodePath.join(input.homeDir, ".codex", "skills")],
    projectRootNames: [".codex"],
  },
  claude: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".claude", "skills")],
    projectRootNames: [".claude"],
  },
  cursor: {
    homeRoots: (input) => [
      nodePath.join(input.homeDir, ".cursor", "skills-cursor"),
      nodePath.join(input.homeDir, ".cursor", "skills"),
    ],
    projectRootNames: [".cursor"],
  },
  grok: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".grok", "skills")],
    projectRootNames: [".grok"],
  },
  factory: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".factory", "skills")],
    projectRootNames: [".factory"],
  },
  opencode: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".config", "opencode", "skills")],
    projectRootNames: [".opencode"],
  },
  pi: {
    homeRoots: (input) => [
      nodePath.join(input.agentDir ?? nodePath.join(input.homeDir, ".pi", "agent"), "skills"),
    ],
    projectRootNames: [".pi"],
  },
  devin: {
    homeRoots: (input) => [
      ...(process.platform === "win32"
        ? [
            nodePath.join(input.homeDir, "AppData", "Roaming", "devin", "skills"),
            nodePath.join(input.homeDir, "AppData", "Roaming", "cognition", "skills"),
          ]
        : []),
      nodePath.join(input.homeDir, ".config", "devin", "skills"),
      nodePath.join(input.homeDir, ".config", "cognition", "skills"),
      nodePath.join(input.homeDir, ".codeium", "windsurf", "skills"),
      nodePath.join(input.homeDir, ".codeium", "windsurf-next", "skills"),
      nodePath.join(input.homeDir, ".codeium", "windsurf-insiders", "skills"),
      // Keep the original path as a compatibility fallback for early Devin CLI builds.
      nodePath.join(input.homeDir, ".devin", "skills"),
    ],
    projectRootNames: [".devin", ".cognition", ".windsurf"],
  },
  omp: {
    homeRoots: (input) => [
      nodePath.join(input.agentDir ?? nodePath.join(input.homeDir, ".omp", "agent"), "skills"),
    ],
    projectRootNames: [".omp"],
  },
  agents: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".agents", "skills")],
    projectRootNames: [".agents"],
  },
} as const satisfies Record<SkillHomeOrigin, SkillOriginRootSpec>;

function homeRootsForOrigin(origin: SkillHomeOrigin, input: SkillsCatalogDiscoveryInput): string[] {
  return SKILL_ORIGIN_ROOTS[origin].homeRoots(input);
}

function projectRootNamesForOrigin(origin: SkillHomeOrigin): readonly string[] {
  return SKILL_ORIGIN_ROOTS[origin].projectRootNames;
}

/**
 * Origins to walk, native folders first so an agent keeps using its own copy of a skill.
 *
 * A provider-scoped scan stops at the folders that provider genuinely reads. It must not
 * fall back to "and every other provider's folder too": offering a Codex session a skill
 * out of `~/.claude/skills` mentions something Codex will never load, and the mention then
 * fails at turn time rather than in the picker.
 *
 * Without a provider this returns every origin — the machine-wide view Settings needs to
 * list what exists on disk regardless of who can load it.
 */
function orderedOriginsForProvider(
  provider: ProviderKind | null | undefined,
  includeSynaraRoot = true,
): SkillHomeOrigin[] {
  const ordered = provider ? skillOriginsForProvider(provider) : [...SKILL_HOME_ORIGIN_ORDER];
  return includeSynaraRoot ? ordered : ordered.filter((origin) => origin !== "synara");
}

function rootsForOrderedOrigins(
  input: SkillsCatalogRootInput,
  orderedOrigins: ReadonlyArray<SkillHomeOrigin>,
): SkillRoot[] {
  const homeRoots = orderedOrigins.flatMap((origin) =>
    homeRootsForOrigin(origin, input).map((path) =>
      origin === "pi" || origin === "omp"
        ? { path, scope: origin, includeMarkdownFiles: true }
        : { path, scope: origin },
    ),
  );
  const homeRootPaths = new Set(homeRoots.map((root) => nodePath.resolve(root.path)));

  const projectRoots: SkillRoot[] = [];
  const cwd = input.cwd?.trim();
  if (cwd) {
    for (const ancestor of ancestorsFromDeepest(cwd)) {
      const seenRootNames = new Set<string>();
      for (const origin of orderedOrigins) {
        for (const rootName of projectRootNamesForOrigin(origin)) {
          if (seenRootNames.has(rootName)) {
            continue;
          }
          seenRootNames.add(rootName);
          const rootPath = nodePath.join(ancestor, rootName, "skills");
          // A cwd under the home dir reaches the home skill folders as
          // "project ancestors"; skip them here so each folder is scanned once
          // and keeps its true origin scope. Precedence is unchanged because
          // project and home roots share the same origin ordering.
          if (homeRootPaths.has(nodePath.resolve(rootPath))) {
            continue;
          }
          projectRoots.push(
            origin === "pi" || origin === "omp"
              ? { path: rootPath, scope: "project", includeMarkdownFiles: true }
              : { path: rootPath, scope: "project" },
          );
        }
      }
    }
  }

  return [...projectRoots, ...homeRoots];
}

export function skillsCatalogRoots(input: SkillsCatalogRootInput): SkillRoot[] {
  return rootsForOrderedOrigins(
    input,
    orderedOriginsForProvider(input.provider, input.includeSynaraRoot !== false),
  );
}

/**
 * Only the provider's own folders — no `~/.synara/skills`. Used by adapters that report
 * their native skills separately from the catalog. Without a provider there is no native
 * folder to name, so the result is empty rather than "everyone's".
 */
export function providerNativeSkillRoots(input: SkillsCatalogRootInput): SkillRoot[] {
  if (!input.provider) {
    return [];
  }
  return rootsForOrderedOrigins(input, orderedOriginsForProvider(input.provider, false));
}

export async function discoverSkillsCatalog(
  input: SkillsCatalogDiscoveryInput,
): Promise<ProviderSkillDescriptor[]> {
  const cacheKey = [
    input.cwd?.trim() ?? "",
    input.provider ?? "",
    input.homeDir,
    input.synaraBaseDir,
    input.agentDir?.trim() ?? "",
    input.includeDuplicateOrigins ? "all-origins" : "deduped",
  ].join("\u0000");

  if (!input.forceReload) {
    const entry = skillsCatalogCache.get(cacheKey);
    if (entry && Date.now() - entry.at <= SKILLS_CATALOG_CACHE_TTL_MS) {
      return [...entry.skills];
    }
  }

  const inflight = skillsCatalogInflight.get(cacheKey);
  if (inflight) {
    return [...(await inflight)];
  }

  const scan = (async () => {
    await ensureSynaraSkillsDir(input.synaraBaseDir);
    const roots = [
      ...skillsCatalogRoots(input),
      ...(await discoverClaudePluginSkillRoots({
        homeDir: input.homeDir,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      })),
    ];
    const skills = input.includeDuplicateOrigins
      ? await collectSkillDescriptorsFromRoots(roots)
      : await collectSkillsFromRoots(roots);

    skillsCatalogCache.delete(cacheKey);
    skillsCatalogCache.set(cacheKey, { at: Date.now(), skills });
    while (skillsCatalogCache.size > SKILLS_CATALOG_CACHE_MAX_ENTRIES) {
      const oldestKey = skillsCatalogCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      skillsCatalogCache.delete(oldestKey);
    }
    return skills;
  })();

  skillsCatalogInflight.set(cacheKey, scan);
  try {
    return [...(await scan)];
  } finally {
    skillsCatalogInflight.delete(cacheKey);
  }
}

// Provider-native discovery results win on name conflicts; catalog entries fill the gaps.
export function mergeSkillsIntoCatalog(input: {
  readonly native: ReadonlyArray<ProviderSkillDescriptor>;
  readonly catalog: ReadonlyArray<ProviderSkillDescriptor>;
}): ProviderSkillDescriptor[] {
  const byName = new Map<string, ProviderSkillDescriptor>();
  for (const skill of [...input.native, ...input.catalog]) {
    const key = skillNameKey(skill.name);
    if (!byName.has(key)) {
      byName.set(key, skill);
    }
  }
  return [...byName.values()];
}

export function filterDisabledSkills(
  skills: ReadonlyArray<ProviderSkillDescriptor>,
  disabledNames: ReadonlyArray<string>,
): ProviderSkillDescriptor[] {
  if (disabledNames.length === 0) {
    return [...skills];
  }
  const disabled = new Set(disabledNames.map((name) => skillNameKey(name)));
  return skills.filter((skill) => !disabled.has(skillNameKey(skill.name)));
}

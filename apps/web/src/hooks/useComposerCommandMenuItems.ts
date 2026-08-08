import type {
  AgentMcpToolDescriptor,
  AgentMcpToolSourceError,
  LaunchConfiguration,
  ProjectEntry,
  ProviderAgentDescriptor,
  ProviderNativeCommandDescriptor,
  ProviderKind,
  ProviderMentionReference,
  ProviderPluginDescriptor,
  ProviderSkillDescriptor,
} from "@synara/contracts";
import { getAgentMentionAutocompleteAliases } from "@synara/contracts";
import { agentMentionColor } from "~/lib/agentMentionCatalog";
import {
  buildCommandSearchFields,
  buildPluginSearchFields,
  buildSkillSearchFields,
  isInstalledProviderPlugin,
  normalizeProviderDiscoveryText,
  rankProviderDiscoveryItems,
} from "~/lib/providerDiscovery";
import {
  LOCAL_FOLDER_MENTION_NAME,
  matchesLocalFolderMentionShortcut,
} from "~/lib/localFolderMentions";
import {
  COLOR_PREVIEW_MENTION_INSERT_TEXT,
  COLOR_PREVIEW_MENTION_TOKEN,
  formatLaunchMentionTargetToken,
  LAUNCH_MENTION_INSERT_TEXT,
  LAUNCH_MENTION_TOKEN,
} from "~/lib/composerMentions";
import { basenameOfPath } from "../file-icons";
import type { ComposerTrigger } from "../composer-logic";
import {
  filterComposerSlashCommands,
  getAvailableComposerSlashCommands,
  getProviderNativeSlashCommandSearchTerms,
  shouldHideProviderNativeCommandFromComposerMenu,
} from "../composerSlashCommands";
import { launchConfigurationCommand } from "@synara/shared/launchConfig";
import { threadMentionPathForThreadId } from "@synara/shared/threadMentions";
import { useMessages } from "~/i18n/context";
import type { Messages } from "~/i18n/locales/en";

import type { ComposerCommandItem } from "../components/chat/ComposerCommandMenu";
import type { ProviderModelOption } from "../providerModelOptions";
import { compareProvidersByOrder } from "../providerOrdering";
import type { ComposerThreadMentionSource, Project } from "../types";

type ComposerPluginSuggestion = {
  plugin: ProviderPluginDescriptor;
  mention: ProviderMentionReference;
};

export type SearchableModelOption = {
  provider: ProviderKind;
  providerLabel: string;
  slug: string;
  name: string;
  searchSlug: string;
  searchName: string;
  searchProvider: string;
  searchUpstreamProvider: string;
};

const THREAD_MENTION_SUGGESTION_LIMIT = 20;

const EMPTY_MCP_TOOLS: readonly AgentMcpToolDescriptor[] = [];
const EMPTY_MCP_TOOL_ERRORS: readonly AgentMcpToolSourceError[] = [];
const EMPTY_LAUNCH_CONFIGURATIONS: readonly LaunchConfiguration[] = [];

// Descriptions are long prose; ranking them at the same weight as a name would let a single
// verbose tool outrank an exact server-name hit.
const MCP_TOOL_DESCRIPTION_FIELD_WEIGHT = 200;

interface McpServerSuggestion {
  readonly provider: AgentMcpToolDescriptor["provider"];
  readonly serverName: string;
  readonly toolCount: number;
}

/**
 * Candidates for a `&` trigger: one whole-server entry per configured server, then the individual
 * tools, then a dimmed row per server that could not be probed.
 *
 * Both the server name and the tool name feed the fuzzy match, so `&doc` surfaces
 * `context7:query-docs` (tool name) next to a hypothetical `docs` server (server name). The
 * normalizer turns `:` into a space, so typing `&context7:que` scores as the phrase it reads as.
 */
export function buildMcpToolComposerItems(input: {
  readonly query: string;
  readonly tools: readonly AgentMcpToolDescriptor[];
  readonly errors: readonly AgentMcpToolSourceError[];
}): ComposerCommandItem[] {
  const query = normalizeProviderDiscoveryText(input.query);

  const serversByKey = new Map<string, McpServerSuggestion>();
  for (const tool of input.tools) {
    const key = `${tool.provider}:${tool.serverName}`;
    const existing = serversByKey.get(key);
    serversByKey.set(key, {
      provider: tool.provider,
      serverName: tool.serverName,
      toolCount: (existing?.toolCount ?? 0) + 1,
    });
  }

  const serverItems: ComposerCommandItem[] = rankProviderDiscoveryItems(
    [...serversByKey.values()],
    query,
    (server) => [{ value: server.serverName }],
  ).map((server) => ({
    id: `mcp-server:${server.provider}:${server.serverName}`,
    type: "mcp-tool" as const,
    provider: server.provider,
    serverName: server.serverName,
    toolName: null,
    label: `&${server.serverName}`,
    description: server.toolCount === 1 ? "1 tool" : `All ${server.toolCount} tools`,
  }));

  const toolItems: ComposerCommandItem[] = rankProviderDiscoveryItems(
    input.tools,
    query,
    (tool) => [
      { value: `${tool.serverName}:${tool.toolName}` },
      { value: tool.toolName },
      { value: tool.serverName },
      { value: tool.description, weight: MCP_TOOL_DESCRIPTION_FIELD_WEIGHT },
    ],
  ).map((tool) => ({
    id: `mcp-tool:${tool.provider}:${tool.serverName}:${tool.toolName}`,
    type: "mcp-tool" as const,
    provider: tool.provider,
    serverName: tool.serverName,
    toolName: tool.toolName,
    label: `&${tool.serverName}:${tool.toolName}`,
    description: tool.description ?? "",
  }));

  // Failures are appended last and never ranked away: they explain an absence, so hiding them
  // behind a query would leave the user with a silently short list.
  const errorItems: ComposerCommandItem[] = input.errors.map((error, index) => ({
    id: `mcp-error:${error.provider}:${error.serverName ?? index}`,
    type: "mcp-tool" as const,
    provider: error.provider,
    serverName: error.serverName ?? "",
    toolName: null,
    unavailable: true,
    label: error.serverName ?? error.provider,
    description: error.message,
  }));

  return [...serverItems, ...toolItems, ...errorItems];
}

export const COLOR_PREVIEW_MENTION_ITEM_ID = "color-preview";

// Localized keywords are a synonym bag, not a name: weighting them keeps `@pre` scoring against
// the literal token first, and (weight > 0) disables fuzzy matching so unrelated queries cannot
// subsequence their way into a hit. Shared by every turn-mode row (`@Preview`, `@Launch`) so they
// rank against their own token on equal terms.
const TURN_MODE_MENTION_KEYWORD_FIELD_WEIGHT = 200;

/**
 * The single `@Preview` row. It is a constant rather than a discovery result — nothing is probed
 * — but it still goes through the shared ranker so `@`, `@pre`, and the localized wording filter
 * it exactly like every other mention suggestion.
 */
export function buildColorPreviewMentionComposerItems(input: {
  readonly query: string;
  readonly description: string;
  readonly keywords: string;
}): ComposerCommandItem[] {
  const item: ComposerCommandItem = {
    id: COLOR_PREVIEW_MENTION_ITEM_ID,
    type: "color-preview",
    label: COLOR_PREVIEW_MENTION_INSERT_TEXT,
    description: input.description,
  };
  return rankProviderDiscoveryItems([item], input.query, () => [
    { value: COLOR_PREVIEW_MENTION_TOKEN },
    { value: input.keywords, weight: TURN_MODE_MENTION_KEYWORD_FIELD_WEIGHT },
  ]);
}

export const LAUNCH_MENTION_ITEM_ID = "launch";

// A project may declare up to 50 services; a bare `@` must not bury every other
// mention kind under them. The ranker orders by relevance first, so a user who
// types part of a service name still reaches it past this cut.
const LAUNCH_TARGET_SUGGESTION_LIMIT = 8;

/**
 * The `@Launch` rows: the bare mode, then one `@Launch:<name>` per declared
 * service. Same shape as the `@Preview` row above — a turn mode rather than a
 * reference — ranked through the shared ranker so the localized wording and the
 * service names both filter like every other mention suggestion.
 */
export function buildLaunchMentionComposerItems(input: {
  readonly query: string;
  readonly description: string;
  readonly keywords: string;
  readonly targetDescription: (configuration: LaunchConfiguration) => string;
  readonly configurations?: readonly LaunchConfiguration[];
}): ComposerCommandItem[] {
  const modeItem: ComposerCommandItem = {
    id: LAUNCH_MENTION_ITEM_ID,
    type: "launch",
    label: LAUNCH_MENTION_INSERT_TEXT,
    description: input.description,
  };
  const modeItems = rankProviderDiscoveryItems([modeItem], input.query, () => [
    { value: LAUNCH_MENTION_TOKEN },
    { value: input.keywords, weight: TURN_MODE_MENTION_KEYWORD_FIELD_WEIGHT },
  ]);

  const targetItems = rankProviderDiscoveryItems(
    input.configurations ?? EMPTY_LAUNCH_CONFIGURATIONS,
    input.query,
    (configuration) => [
      { value: `${LAUNCH_MENTION_TOKEN}:${configuration.name}` },
      { value: configuration.name },
    ],
  )
    .slice(0, LAUNCH_TARGET_SUGGESTION_LIMIT)
    .map((configuration) => ({
      id: `${LAUNCH_MENTION_ITEM_ID}:${configuration.name}`,
      type: "launch" as const,
      target: configuration.name,
      label: formatLaunchMentionTargetToken(configuration.name),
      description: input.targetDescription(configuration),
    }));

  return [...modeItems, ...targetItems];
}

function threadSuggestionTitle(title: string): string {
  return title.trim() || "Untitled thread";
}

function threadSuggestionContainerName(project: Project | undefined): string {
  if (!project) return "Unknown project";
  if (project.kind === "chat") return "Chats";
  if (project.kind === "studio") return "Studio";
  return project.name.trim() || project.folderName.trim() || "Untitled project";
}

function threadSuggestionRecency(thread: ComposerThreadMentionSource): string {
  return thread.latestUserMessageAt ?? thread.lastVisitedAt ?? thread.createdAt;
}

interface ThreadMentionCandidate {
  readonly thread: ComposerThreadMentionSource;
  readonly title: string;
  readonly projectName: string;
  readonly mentionName: string;
}

function mentionNameKey(value: string): string {
  return value.trim().toLowerCase();
}

function makeUniqueMentionName(input: {
  readonly preferredName: string;
  readonly threadId: string;
  readonly reservedNames: ReadonlySet<string>;
  readonly usedNames: ReadonlySet<string>;
}): string {
  let attempt = 0;
  while (true) {
    const suffix =
      attempt === 0
        ? input.threadId.slice(-6) || input.threadId
        : attempt === 1
          ? input.threadId
          : `${input.threadId}:${attempt}`;
    const candidate = `${input.preferredName} (${suffix})`;
    const key = mentionNameKey(candidate);
    if (!input.reservedNames.has(key) && !input.usedNames.has(key)) {
      return candidate;
    }
    attempt += 1;
  }
}

// Mention tokens/chips resolve back to their reference by name, so two chats
// sharing a title would be indistinguishable once inserted (wrong provider
// icon, ambiguous context). Build friendly project-qualified names first, then
// guarantee uniqueness across the final serialized names with a stable id suffix.
function withDisambiguatedMentionNames(
  candidates: ReadonlyArray<Omit<ThreadMentionCandidate, "mentionName">>,
): ThreadMentionCandidate[] {
  const titleCounts = new Map<string, number>();
  const qualifiedCounts = new Map<string, number>();
  for (const candidate of candidates) {
    titleCounts.set(candidate.title, (titleCounts.get(candidate.title) ?? 0) + 1);
  }
  for (const candidate of candidates) {
    if ((titleCounts.get(candidate.title) ?? 0) > 1) {
      const qualified = `${candidate.title} (${candidate.projectName})`;
      qualifiedCounts.set(qualified, (qualifiedCounts.get(qualified) ?? 0) + 1);
    }
  }
  const preferredCandidates = candidates.map((candidate) => {
    const qualified = `${candidate.title} (${candidate.projectName})`;
    const preferredName =
      (titleCounts.get(candidate.title) ?? 0) <= 1
        ? candidate.title
        : (qualifiedCounts.get(qualified) ?? 0) > 1
          ? `${candidate.title} (${candidate.projectName}, ${candidate.thread.id.slice(-6)})`
          : qualified;
    return {
      thread: candidate.thread,
      title: candidate.title,
      projectName: candidate.projectName,
      preferredName,
    };
  });
  const preferredNameCounts = new Map<string, number>();
  for (const candidate of preferredCandidates) {
    const key = mentionNameKey(candidate.preferredName);
    preferredNameCounts.set(key, (preferredNameCounts.get(key) ?? 0) + 1);
  }
  const reservedNames = new Set(preferredNameCounts.keys());
  const usedNames = new Set<string>();

  return preferredCandidates.map((candidate) => {
    const preferredKey = mentionNameKey(candidate.preferredName);
    const mentionName =
      (preferredNameCounts.get(preferredKey) ?? 0) === 1 && !usedNames.has(preferredKey)
        ? candidate.preferredName
        : makeUniqueMentionName({
            preferredName: candidate.preferredName,
            threadId: candidate.thread.id,
            reservedNames,
            usedNames,
          });
    usedNames.add(mentionNameKey(mentionName));
    return {
      thread: candidate.thread,
      title: candidate.title,
      projectName: candidate.projectName,
      mentionName,
    };
  });
}

export function buildThreadMentionComposerItems(input: {
  readonly threads: readonly ComposerThreadMentionSource[];
  readonly projects: readonly Project[];
  readonly currentThreadId: string | null;
  readonly query: string;
}): ComposerCommandItem[] {
  const projectById = new Map(input.projects.map((project) => [project.id, project]));
  const candidates = withDisambiguatedMentionNames(
    input.threads
      .filter(
        (thread) => thread.id !== input.currentThreadId && (thread.archivedAt ?? null) === null,
      )
      .map((thread) => ({
        thread,
        title: threadSuggestionTitle(thread.title),
        projectName: threadSuggestionContainerName(projectById.get(thread.projectId)),
      })),
  );
  const query = normalizeProviderDiscoveryText(input.query);
  const ranked = (
    query
      ? rankProviderDiscoveryItems(candidates, query, ({ title }) => [{ value: title }])
      : candidates.toSorted((left, right) =>
          threadSuggestionRecency(right.thread).localeCompare(threadSuggestionRecency(left.thread)),
        )
  ).slice(0, THREAD_MENTION_SUGGESTION_LIMIT);

  return ranked.map(({ thread, title, projectName, mentionName }) => ({
    id: `thread:${thread.id}`,
    type: "thread" as const,
    threadId: thread.id,
    provider: thread.provider,
    mention: { name: mentionName, path: threadMentionPathForThreadId(thread.id) },
    label: title,
    description: projectName,
  }));
}

export function buildSearchableModelOptions(input: {
  providerOptions: ReadonlyArray<{ value: ProviderKind; label: string }>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
  providerOrder: readonly ProviderKind[];
  hiddenProviders: readonly ProviderKind[];
  protectedProviders: readonly ProviderKind[];
  lockedProvider?: ProviderKind | null;
}): SearchableModelOption[] {
  const hiddenProviderSet = new Set(input.hiddenProviders);
  const protectedProviderSet = new Set(input.protectedProviders);
  return input.providerOptions
    .toSorted((left, right) =>
      compareProvidersByOrder(input.providerOrder, left.value, right.value),
    )
    .filter((option) =>
      input.lockedProvider
        ? option.value === input.lockedProvider
        : protectedProviderSet.has(option.value) || !hiddenProviderSet.has(option.value),
    )
    .flatMap((option) =>
      input.modelOptionsByProvider[option.value].map(
        ({ slug, name, upstreamProviderId, upstreamProviderName }) => ({
          provider: option.value,
          providerLabel: option.label,
          slug,
          name,
          searchSlug: slug.toLowerCase(),
          searchName: name.toLowerCase(),
          searchProvider: option.label.toLowerCase(),
          searchUpstreamProvider: (upstreamProviderName ?? upstreamProviderId ?? "").toLowerCase(),
        }),
      ),
    );
}

export interface ComposerCommandMenuInput {
  composerTrigger: ComposerTrigger | null;
  provider: ProviderKind;
  providerPlugins: readonly ComposerPluginSuggestion[];
  providerNativeCommands: readonly ProviderNativeCommandDescriptor[];
  providerSkills: readonly ProviderSkillDescriptor[];
  workspaceEntries: readonly ProjectEntry[];
  searchableModelOptions: readonly SearchableModelOption[];
  supportsFastSlashCommand: boolean;
  canOfferCompactCommand: boolean;
  canOfferReviewCommand: boolean;
  canOfferForkCommand: boolean;
  canOfferSideCommand: boolean;
  canOfferExportCommand: boolean;
  surfaceAppSlashCommands?: ReadonlySet<string>;
  /** Empty on surfaces that do not offer `&` references (the kanban composer, for now). */
  mcpTools?: readonly AgentMcpToolDescriptor[];
  mcpToolErrors?: readonly AgentMcpToolSourceError[];
  dynamicAgents: readonly ProviderAgentDescriptor[];
  threadMentionSources?: {
    readonly threads: readonly ComposerThreadMentionSource[];
    readonly projects: readonly Project[];
    readonly currentThreadId: string | null;
  };
  /** `.nilcode/launch.json` entries, offered as `@Launch:<name>` rows. */
  launchConfigurations?: readonly LaunchConfiguration[];
}

/**
 * Assembles the menu rows for the active trigger. Kept as a pure function taking
 * the copy catalog explicitly: every rule here (which sources contribute, how
 * they rank, what order the groups appear in) is decided by the inputs alone, so
 * it is testable without mounting React just to reach the i18n context.
 */
export function buildComposerCommandMenuItems(
  input: ComposerCommandMenuInput & { composerCopy: Messages["composer"] },
): ComposerCommandItem[] {
  const composerCopy = input.composerCopy;
  const slashCommandDescriptions = composerCopy.slashCommands;
  const {
    composerTrigger,
    provider,
    providerPlugins,
    providerNativeCommands,
    providerSkills,
    workspaceEntries,
    searchableModelOptions,
    supportsFastSlashCommand,
    canOfferCompactCommand,
    canOfferReviewCommand,
    canOfferForkCommand,
    canOfferSideCommand,
    canOfferExportCommand,
    surfaceAppSlashCommands,
    mcpTools = EMPTY_MCP_TOOLS,
    mcpToolErrors = EMPTY_MCP_TOOL_ERRORS,
    dynamicAgents,
    threadMentionSources,
    launchConfigurations = EMPTY_LAUNCH_CONFIGURATIONS,
  } = input;

  if (!composerTrigger) return [];

  // Keep trigger-specific discovery outside ChatView so the view mostly orchestrates state.
  if (composerTrigger.kind === "mention") {
    const query = normalizeProviderDiscoveryText(composerTrigger.query);

    // Discovered subagents and the static alias table are different things: the
    // former are the user's real agents, the latter are Synara built-ins plus (on
    // Codex) model switches. Group them so a single `@` stays unambiguous.
    const discoveredAgentItems: ComposerCommandItem[] = rankProviderDiscoveryItems(
      dynamicAgents,
      query,
      ({ name, displayName }) => [{ value: name }, { value: displayName }],
    ).map(({ name, displayName, description, source }) => ({
      id: `agent:${provider}:${name}`,
      type: "agent" as const,
      provider,
      alias: name,
      // Same resolution the inline chip uses, so the glyph in this list is a
      // preview of the token the user is about to insert.
      color: agentMentionColor(name),
      group: source === "builtin" ? ("builtin" as const) : ("agent" as const),
      label: `@${name}`,
      description: description ?? (displayName === name ? "" : displayName),
    }));
    const discoveredAgentNames = new Set(dynamicAgents.map(({ name }) => name.toLowerCase()));
    // Aliases the discovery pass already covers would list the same agent twice.
    const aliasAgentItems: ComposerCommandItem[] = rankProviderDiscoveryItems(
      getAgentMentionAutocompleteAliases(provider).filter(
        ({ alias, kind }) => kind === "model" || !discoveredAgentNames.has(alias.toLowerCase()),
      ),
      query,
      ({ alias, displayName }) => [{ value: alias }, { value: displayName }],
    ).map(({ alias, displayName, color, kind }) => ({
      id: `agent:${provider}:${alias}`,
      type: "agent" as const,
      provider,
      alias,
      color,
      group: kind === "model" ? ("model" as const) : ("builtin" as const),
      label: `@${alias}`,
      description: displayName,
    }));
    const agentItems: ComposerCommandItem[] = [...discoveredAgentItems, ...aliasAgentItems];

    const pluginItems = rankProviderDiscoveryItems(
      providerPlugins.filter(({ plugin }) => isInstalledProviderPlugin(plugin)),
      query,
      ({ plugin }) => buildPluginSearchFields(plugin),
    ).map(({ plugin, mention }) => ({
      id: `plugin:${plugin.id}`,
      type: "plugin" as const,
      plugin,
      mention,
      label: plugin.interface?.displayName ?? plugin.name,
      description: plugin.interface?.shortDescription ?? plugin.source.path,
    }));
    const localRootItems =
      matchesLocalFolderMentionShortcut(composerTrigger.query) && composerTrigger.query !== "/"
        ? [
            {
              id: "local-root",
              type: "local-root" as const,
              label: `@${LOCAL_FOLDER_MENTION_NAME}`,
              description: "Browse folders on this computer",
            },
          ]
        : [];
    const pathItems = workspaceEntries.map((entry) => ({
      id: `path:${entry.kind}:${entry.path}`,
      type: "path" as const,
      path: entry.path,
      pathKind: entry.kind,
      label: basenameOfPath(entry.path),
      description: entry.parentPath ?? "",
    }));
    const threadItems = threadMentionSources
      ? buildThreadMentionComposerItems({
          ...threadMentionSources,
          query: composerTrigger.query,
        })
      : [];
    const colorPreviewItems = buildColorPreviewMentionComposerItems({
      query: composerTrigger.query,
      description: composerCopy.commandMenu.colorPreview.description,
      keywords: composerCopy.commandMenu.colorPreview.keywords,
    });
    const launchItems = buildLaunchMentionComposerItems({
      query: composerTrigger.query,
      description: composerCopy.commandMenu.launch.description,
      keywords: composerCopy.commandMenu.launch.keywords,
      configurations: launchConfigurations,
      // The command line is what distinguishes two similarly named services, and
      // it is already what the project actions row shows for the same entry.
      targetDescription: (configuration) =>
        launchConfigurationCommand(configuration) ?? composerCopy.commandMenu.launch.target,
    });
    // Keep mention suggestions ordered by primary intent. Delegation targets sit
    // right after plugins/chats — ahead of file paths, which the trailing "Files"
    // hint already tells users to reach by typing. Turn modes follow the targets:
    // a bare `@` should still default to the thing the user meant to reference,
    // and a query that names the mode ranks it to the top on its own.
    return [
      ...pluginItems,
      ...threadItems,
      ...agentItems,
      ...colorPreviewItems,
      ...launchItems,
      ...localRootItems,
      ...pathItems,
    ];
  }

  if (composerTrigger.kind === "slash-command") {
    const query = normalizeProviderDiscoveryText(composerTrigger.query);
    const availableCommands = getAvailableComposerSlashCommands({
      provider,
      supportsFastSlashCommand,
      canOfferCompactCommand,
      canOfferReviewCommand,
      canOfferForkCommand,
      canOfferSideCommand,
      canOfferExportCommand,
      providerNativeCommandNames: providerNativeCommands.map((command) => command.name),
    });
    const visibleAppCommands = surfaceAppSlashCommands
      ? availableCommands.filter((command) => surfaceAppSlashCommands.has(command))
      : availableCommands;
    const visibleAppCommandSet = new Set(visibleAppCommands);
    const builtInItems = filterComposerSlashCommands(
      composerTrigger.query,
      visibleAppCommands,
      slashCommandDescriptions,
    ).map((definition) => ({
      id: `slash:${definition.command}`,
      type: "slash-command" as const,
      command: definition.command,
      label: definition.label,
      description: definition.description,
      source: definition.source,
    }));
    const providerCommandItems = providerNativeCommands
      .filter(
        (command) =>
          !shouldHideProviderNativeCommandFromComposerMenu(provider, command.name, {
            availableAppCommands: visibleAppCommandSet,
          }),
      )
      .map((command) => ({
        command,
        aliasFields: getProviderNativeSlashCommandSearchTerms(provider, command.name).map(
          (term) => ({
            value: term,
          }),
        ),
      }));
    const rankedProviderCommandItems = rankProviderDiscoveryItems(
      providerCommandItems,
      query,
      ({ command, aliasFields }) => [...aliasFields, ...buildCommandSearchFields(command)],
    ).map(({ command }) => ({
      id: `provider-command:${provider}:${command.name}`,
      type: "provider-native-command" as const,
      provider,
      command: command.name,
      label: `/${command.name}`,
      description: command.description ?? `Run ${provider} native command`,
    }));
    // `/` is the universal picker surface; provider dispatch can adapt the
    // visible slash token to backend-specific skill syntax when needed.
    const skillItems: ComposerCommandItem[] = rankProviderDiscoveryItems(
      providerSkills,
      query,
      buildSkillSearchFields,
    ).map((skill) => ({
      id: `skill:${skill.path}`,
      type: "skill" as const,
      skill,
      label: skill.interface?.displayName ?? skill.name,
      description: skill.interface?.shortDescription ?? skill.description ?? skill.path,
    }));
    return [...builtInItems, ...rankedProviderCommandItems, ...skillItems];
  }

  if (composerTrigger.kind === "mcp-tool") {
    return buildMcpToolComposerItems({
      query: composerTrigger.query,
      tools: mcpTools,
      errors: mcpToolErrors,
    });
  }

  if (composerTrigger.kind === "skill") {
    const query = normalizeProviderDiscoveryText(composerTrigger.query);
    return rankProviderDiscoveryItems(providerSkills, query, buildSkillSearchFields).map(
      (skill) => ({
        id: `skill:${skill.path}`,
        type: "skill" as const,
        skill,
        label: skill.interface?.displayName ?? skill.name,
        description: skill.interface?.shortDescription ?? skill.description ?? skill.path,
      }),
    );
  }

  return rankProviderDiscoveryItems(searchableModelOptions, composerTrigger.query, (option) => [
    { value: option.name },
    { value: option.slug },
    { value: option.searchName },
    { value: option.searchSlug },
    { value: option.providerLabel, weight: 200 },
    { value: option.searchProvider, weight: 200 },
    { value: option.searchUpstreamProvider, weight: 200 },
  ]).map(({ provider, providerLabel, slug, name }) => ({
    id: `model:${provider}:${slug}`,
    type: "model" as const,
    provider,
    model: slug,
    label: name,
    description: `${providerLabel} · ${slug}`,
  }));
}

/** Binds the active copy catalog to {@link buildComposerCommandMenuItems}. */
export function useComposerCommandMenuItems(
  input: ComposerCommandMenuInput,
): ComposerCommandItem[] {
  const composerCopy = useMessages().composer;
  return buildComposerCommandMenuItems({ ...input, composerCopy });
}

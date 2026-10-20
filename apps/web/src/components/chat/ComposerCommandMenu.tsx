import {
  type AgentMcpProvider,
  type GitHubReference,
  type ProjectEntry,
  type ModelSlug,
  type ProviderNativeCommandDescriptor,
  type ProviderMentionReference,
  type ProviderInstanceId,
  type ProviderKind,
  type ProviderPluginDescriptor,
  type ProviderSkillDescriptor,
} from "@synara/contracts";
import { type ReactNode } from "react";
import { type ComposerTriggerKind } from "../../composer-logic";
import { type ComposerSlashCommand } from "../../composerSlashCommands";
import {
  BotIcon,
  BrainIcon,
  ChangesIcon,
  CircleAlertIcon,
  DeviceLaptopIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  McpToolIcon,
  type LucideIcon,
  PluginIcon,
  SkillCubeIcon,
  TerminalIcon,
  WorktreeIcon,
} from "~/lib/icons";
import { CentralIcon } from "~/lib/central-icons";
import { COLOR_PREVIEW_MENTION_ICON_NAME, LAUNCH_MENTION_ICON_NAME } from "~/lib/composerMentions";
import { slashCommandIcon } from "~/lib/slashCommandIcons";
import { formatSkillScope } from "~/lib/providerDiscovery";
import type { ProviderCommandNotice } from "~/lib/claudeArtifactCommands";
import { cn } from "~/lib/utils";
import { resolveAgentChipColor } from "../composerInlineChip";
import { FileEntryIcon } from "./FileEntryIcon";
import { ProviderIcon } from "../ProviderIcon";
import {
  ComposerMenuPanel,
  COMPOSER_MENU_PANEL_GLYPH_CLASS_NAME,
  type ComposerMenuPanelGroup,
} from "./ComposerMenuPanel";
import { ConnectorIcon } from "../ConnectorIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useMessages } from "~/i18n/context";
import type { Messages } from "~/i18n/locales/en";

/** The command-menu slice of the active catalog, threaded into the pure helpers below. */
type CommandMenuCopy = Messages["composer"]["commandMenu"];

function humanizeProviderCommandName(command: string): string {
  return command
    .split(/[-_]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function commandMenuTitle(
  item: Extract<ComposerCommandItem, { type: "slash-command" | "provider-native-command" }>,
  copy: CommandMenuCopy["commands"],
): string {
  switch (item.command) {
    case "clear":
      return copy.clear;
    case "compact":
      return copy.compact;
    case "model":
      return copy.model;
    case "fast":
      return copy.fast;
    case "plan":
      return copy.plan;
    case "debug":
      return copy.debug;
    case "default":
      return copy.default;
    case "review":
      return copy.review;
    case "fork":
      return copy.fork;
    case "side":
      return copy.side;
    case "status":
      return copy.status;
    case "subagents":
      return copy.subagents;
    case "feedback":
      return copy.feedback;
    default:
      return humanizeProviderCommandName(item.command);
  }
}

function commandMenuTrailingMeta(
  item: ComposerCommandItem,
  copy: CommandMenuCopy["meta"],
): string | null {
  if (item.type === "agent") {
    return item.group === "model" ? copy.switchModel : copy.delegateTask;
  }

  if (item.type === "plugin") {
    return copy.plugin;
  }

  if (item.type === "connector") {
    return "Connector";
  }

  if (item.type === "thread") {
    return null;
  }

  if (item.type === "github-reference") {
    return `${item.reference.kind === "pull" ? copy.pullRequest : copy.issue} · ${item.state}`;
  }

  if (item.type === "local-root") {
    return copy.local;
  }

  if (item.type === "skill") {
    return formatSkillScope(item.skill.scope);
  }

  if (item.type === "mcp-tool") {
    if (item.unavailable) return copy.unavailable;
    return item.toolName === null ? copy.mcpServer : copy.mcpTool;
  }

  if (item.type === "model") {
    return copy.model;
  }

  if (item.type === "slash-command" || item.type === "provider-native-command") {
    return `/${item.command}`;
  }

  // Right-align the parent path so many same-named entries (e.g. worktrees) stay
  // distinguishable without crowding the name column.
  if (item.type === "path") {
    return item.description.length > 0 ? item.description : null;
  }

  return null;
}

function commandMenuSecondaryText(item: ComposerCommandItem): string | null {
  // The menu is driven from the composer, so focus never reaches the warning icon:
  // the row itself has to say why the command will not work.
  if (item.type === "provider-native-command" && item.notice) {
    return item.notice.summary;
  }

  if (item.type === "slash-command" || item.type === "provider-native-command") {
    return item.description;
  }

  if (item.type === "agent") {
    return item.description;
  }

  if (
    item.type === "plugin" ||
    item.type === "connector" ||
    item.type === "skill" ||
    item.type === "local-root" ||
    item.type === "color-preview" ||
    item.type === "launch" ||
    item.type === "thread" ||
    item.type === "mcp-tool" ||
    item.type === "github-reference"
  ) {
    return item.description;
  }

  return null;
}

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "github-reference";
      reference: GitHubReference;
      state: "open" | "closed" | "merged";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "local-root";
      label: string;
      description: string;
    }
  | {
      /** `@Preview`: a mode for the turn being sent, not a reference to anything. */
      id: string;
      type: "color-preview";
      label: string;
      description: string;
    }
  | {
      /**
       * `@Launch`: a mode for the turn being sent. `target` names one service from
       * `.nilcode/launch.json` (`@Launch:mc-server`); absent means the bare mode.
       */
      id: string;
      type: "launch";
      target?: string;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
      source: "app" | "shared";
    }
  | {
      id: string;
      type: "provider-native-command";
      provider: ProviderKind;
      command: ProviderNativeCommandDescriptor["name"];
      label: string;
      description: string;
      /** Why the command cannot fully work right now: row text plus a warning tooltip. */
      notice?: ProviderCommandNotice | null;
    }
  | {
      id: string;
      type: "fork-target";
      target: "local" | "worktree";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "review-target";
      target: "changes" | "base-branch";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "model";
      provider: ProviderKind;
      instanceId: ProviderInstanceId;
      model: ModelSlug;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "plugin";
      plugin: ProviderPluginDescriptor;
      mention: ProviderMentionReference;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "thread";
      threadId: string;
      provider: ProviderKind;
      mention: ProviderMentionReference;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "connector";
      /** Display name, also what picks the brand mark or favicon. */
      connectorName: string;
      mention: ProviderMentionReference;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      skill: ProviderSkillDescriptor;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "mcp-tool";
      provider: AgentMcpProvider;
      serverName: string;
      /** `null` references every tool of the server (`&server`). */
      toolName: string | null;
      /** A server that could not be probed: shown greyed out and not selectable. */
      unavailable?: boolean;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "agent";
      provider: ProviderKind;
      alias: string;
      color: string;
      /** Menu section: a discovered subagent, a Synara built-in, or a model switch. */
      group: "agent" | "builtin" | "model";
      label: string;
      description: string;
    };

type ComposerCommandGroupModel = {
  id: string;
  label: string | null;
  items: ComposerCommandItem[];
};

export function groupCommandItems(
  items: ComposerCommandItem[],
  triggerKind: ComposerTriggerKind | null,
  groupSlashCommandSections: boolean,
  labels: CommandMenuCopy["groups"],
): ComposerCommandGroupModel[] {
  if (triggerKind === "mention") {
    const connectorItems = items.filter((item) => item.type === "connector");
    const pluginItems = items.filter((item) => item.type === "plugin");
    const threadItems = items.filter((item) => item.type === "thread");
    const localItems = items.filter((item) => item.type === "local-root" || item.type === "path");
    const agentItems = items.filter((item) => item.type === "agent" && item.group === "agent");
    const builtInAgentItems = items.filter(
      (item) => item.type === "agent" && item.group === "builtin",
    );
    const modelAliasItems = items.filter((item) => item.type === "agent" && item.group === "model");
    const modeItems = items.filter((item) => item.type === "color-preview");
    const otherItems = items.filter(
      (item) =>
        item.type !== "connector" &&
        item.type !== "plugin" &&
        item.type !== "thread" &&
        item.type !== "local-root" &&
        item.type !== "path" &&
        item.type !== "color-preview" &&
        item.type !== "agent",
    );

    const groups: ComposerCommandGroupModel[] = [];
    if (connectorItems.length > 0) {
      groups.push({ id: "connectors", label: "Connectors", items: connectorItems });
    }
    if (pluginItems.length > 0) {
      groups.push({ id: "plugins", label: labels.plugins, items: pluginItems });
    }
    if (threadItems.length > 0) {
      groups.push({ id: "chats", label: labels.chats, items: threadItems });
    }
    if (agentItems.length > 0) {
      groups.push({ id: "subagents", label: labels.subagents, items: agentItems });
    }
    if (builtInAgentItems.length > 0) {
      groups.push({ id: "built-in-agents", label: labels.builtInAgents, items: builtInAgentItems });
    }
    if (modelAliasItems.length > 0) {
      groups.push({ id: "model-aliases", label: labels.models, items: modelAliasItems });
    }
    if (modeItems.length > 0) {
      groups.push({ id: "modes", label: labels.modes, items: modeItems });
    }
    if (localItems.length > 0) {
      groups.push({ id: "local", label: labels.local, items: localItems });
    }
    if (otherItems.length > 0) {
      groups.push({ id: "other", label: null, items: otherItems });
    }
    return groups;
  }

  if (triggerKind === "github-reference") {
    return [{ id: "github", label: labels.github, items }];
  }

  if (triggerKind !== "slash-command" || !groupSlashCommandSections) {
    return [{ id: "default", label: null, items }];
  }

  const builtInItems = items.filter((item) => item.type === "slash-command");
  const providerItems = items.filter((item) => item.type === "provider-native-command");
  const skillItems = items.filter((item) => item.type === "skill");
  const otherItems = items.filter(
    (item) =>
      item.type !== "slash-command" &&
      item.type !== "provider-native-command" &&
      item.type !== "skill",
  );

  const groups: ComposerCommandGroupModel[] = [];
  if (builtInItems.length > 0) {
    groups.push({ id: "built-in", label: labels.builtIn, items: builtInItems });
  }
  if (providerItems.length > 0) {
    groups.push({ id: "provider", label: labels.provider, items: providerItems });
  }
  if (skillItems.length > 0) {
    groups.push({ id: "skills", label: labels.skills, items: skillItems });
  }
  if (otherItems.length > 0) {
    groups.push({ id: "other", label: null, items: otherItems });
  }
  return groups;
}

function CommandNoticeBadge(props: { notice: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span role="img" aria-label={props.notice} className="inline-flex items-center" />}
      >
        <CircleAlertIcon className="size-3.5 text-warning" />
      </TooltipTrigger>
      <TooltipPopup
        side="top"
        align="end"
        className="max-w-72 whitespace-normal text-ui-sm leading-snug"
      >
        {props.notice}
      </TooltipPopup>
    </Tooltip>
  );
}

export function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  groupSlashCommandSections?: boolean;
  emptyStateText?: string;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const composerCopy = useMessages().composer;
  const commandMenuCopy = composerCopy.commandMenu;
  const groups = groupCommandItems(
    props.items,
    props.triggerKind,
    props.groupSlashCommandSections ?? true,
    commandMenuCopy.groups,
  );
  const panelGroups: ComposerMenuPanelGroup[] = groups.map((group) => ({
    id: group.id,
    label: group.label,
    rows: group.items.map((item) => ({
      id: item.id,
      icon: commandMenuItemGlyph(item, props.resolvedTheme),
      title:
        item.type === "slash-command" || item.type === "provider-native-command"
          ? commandMenuTitle(item, commandMenuCopy.commands)
          : item.label,
      secondary: commandMenuSecondaryText(item),
      trailing:
        item.type === "provider-native-command" && item.notice ? (
          <span className="inline-flex items-center gap-1.5">
            {commandMenuTrailingMeta(item, commandMenuCopy.meta)}
            <CommandNoticeBadge notice={item.notice.detail} />
          </span>
        ) : (
          commandMenuTrailingMeta(item, commandMenuCopy.meta)
        ),
      disabled: item.type === "mcp-tool" && item.unavailable === true,
    })),
  }));
  const itemsById = new Map(props.items.map((item) => [item.id, item]));

  return (
    <ComposerMenuPanel
      groups={panelGroups}
      activeRowId={props.activeItemId}
      onHighlightRow={props.onHighlightedItemChange}
      onSelectRow={(rowId) => {
        const item = itemsById.get(rowId);
        if (item) props.onSelect(item);
      }}
      footer={
        props.triggerKind === "mention" ? (
          <div className="pt-0.5 pb-2">
            <p className="px-2 py-0 font-medium text-muted-foreground text-xs">
              {commandMenuCopy.files}
            </p>
            <p className="px-2 pt-0.5 text-[11px] text-muted-foreground/55">
              {commandMenuCopy.filesHint}
            </p>
          </div>
        ) : null
      }
      status={
        props.items.length === 0 ? (
          <p
            className={cn(
              "text-muted-foreground/50 text-ui-sm",
              props.isLoading
                ? "flex h-[calc(1.625rem+0.5rem)] items-center px-2 text-left"
                : "px-2 py-1.5",
            )}
          >
            {props.isLoading
              ? props.triggerKind === "mention"
                ? commandMenuCopy.loading.mentions
                : props.triggerKind === "skill"
                  ? commandMenuCopy.loading.skills
                  : props.triggerKind === "mcp-tool"
                    ? commandMenuCopy.loading.mcp
                    : props.triggerKind === "github-reference"
                      ? commandMenuCopy.loading.github
                      : commandMenuCopy.loading.commands
              : (props.emptyStateText ??
                (props.triggerKind === "mention"
                  ? commandMenuCopy.empty.mention
                  : props.triggerKind === "skill"
                    ? commandMenuCopy.empty.skill
                    : props.triggerKind === "mcp-tool"
                      ? commandMenuCopy.empty.mcp
                      : props.triggerKind === "github-reference"
                        ? commandMenuCopy.empty.github
                        : commandMenuCopy.empty.command))}
          </p>
        ) : null
      }
    />
  );
}

// Files mirror the recap / diff changed-files treatment (FileEntryIcon at
// size-3.5 with the same dimmed foreground) so a file reads identically whether
// it appears in a turn summary or in the composer.
const COMPOSER_COMMAND_ITEM_FILE_ICON_CLASSNAME =
  "size-3.5 text-[var(--color-text-foreground)] opacity-70 dark:opacity-80";

const COMPOSER_COMMAND_ITEM_GLYPH_CLASSNAME = COMPOSER_MENU_PANEL_GLYPH_CLASS_NAME;

function commandMenuSlashGlyph(command: string, fallback: LucideIcon): ReactNode {
  const Icon = slashCommandIcon(command, fallback);
  return <Icon className={COMPOSER_COMMAND_ITEM_GLYPH_CLASSNAME} />;
}

function commandMenuItemGlyph(item: ComposerCommandItem, theme: "light" | "dark"): ReactNode {
  const cls = COMPOSER_COMMAND_ITEM_GLYPH_CLASSNAME;
  switch (item.type) {
    case "path":
      return (
        <FileEntryIcon
          pathValue={item.path}
          kind={item.pathKind}
          theme={theme}
          className={
            item.pathKind === "directory" ? cls : COMPOSER_COMMAND_ITEM_FILE_ICON_CLASSNAME
          }
        />
      );
    case "local-root":
      return <DeviceLaptopIcon className={cls} />;
    case "color-preview":
      // Same glyph the inserted `@Preview` chip uses, so the row previews the token.
      return <CentralIcon name={COLOR_PREVIEW_MENTION_ICON_NAME} className={cls} />;
    case "launch":
      // Same glyph the inserted `@Launch` chip uses, so the row previews the token.
      return <CentralIcon name={LAUNCH_MENTION_ICON_NAME} className={cls} />;
    case "fork-target":
      return item.target === "local" ? (
        <DeviceLaptopIcon className={cls} />
      ) : (
        <WorktreeIcon className={cls} />
      );
    case "review-target":
      return item.target === "changes" ? (
        <ChangesIcon className={cls} />
      ) : (
        <GitBranchIcon className={cls} />
      );
    case "slash-command":
      return commandMenuSlashGlyph(item.command, TerminalIcon);
    case "provider-native-command":
      // Provider native commands surface skills (e.g. Claude exposes skills as
      // slash commands), so default to the skill block glyph used for skill
      // tokens in the composer/timeline — named commands still keep their icon.
      return commandMenuSlashGlyph(item.command, SkillCubeIcon);
    case "model":
      return <BrainIcon className={cls} />;
    case "agent":
      // Tinted with the same per-agent color the inline chip uses, so scanning
      // the list and scanning a written prompt rely on the same cue.
      return <BotIcon className={cls} style={{ color: resolveAgentChipColor(item.color).text }} />;
    case "plugin":
      return <PluginIcon className={cls} />;
    case "thread":
      return <ProviderIcon provider={item.provider} className={cls} />;
    case "connector":
      return <ConnectorIcon name={item.connectorName} className={cls} />;
    case "skill":
      return <SkillCubeIcon className={cls} />;
    case "mcp-tool":
      return <McpToolIcon className={cls} />;
    case "github-reference":
      return <GitPullRequestIcon className={cls} />;
    default:
      return null;
  }
}

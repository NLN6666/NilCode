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
  COMPOSER_MENU_PANEL_GROUP_LABEL_CLASS_NAME,
  type ComposerMenuPanelGroup,
} from "./ComposerMenuPanel";
import { ConnectorIcon } from "../ConnectorIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useTranslation } from "~/i18n";

type ChatTranslator = ReturnType<typeof useTranslation>["t"];

function humanizeProviderCommandName(command: string): string {
  return command
    .split(/[-_]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function commandMenuTitle(
  item: Extract<ComposerCommandItem, { type: "slash-command" | "provider-native-command" }>,
  translate: ChatTranslator,
): string {
  switch (item.command) {
    case "clear":
      return translate("chat:clear");
    case "compact":
      return translate("chat:compactContext");
    case "model":
      return translate("chat:detail_model");
    case "fast":
      return translate("chat:fastMode");
    case "plan":
      return translate("chat:planMode");
    case "debug":
      return translate("chat:debugMode");
    case "default":
      return translate("chat:defaultMode");
    case "review":
      return translate("chat:codeReview");
    case "fork":
      return translate("workspace:fork");
    case "side":
      return translate("chat:sidechat");
    case "status":
      return translate("chat:detail_status");
    case "subagents":
      return translate("chat:subagents");
    case "feedback":
      return translate("workspace:feedbackSynara");
    default:
      return humanizeProviderCommandName(item.command);
  }
}

function commandMenuTrailingMeta(
  item: ComposerCommandItem,
  translate: ChatTranslator,
): string | null {
  if (item.type === "agent") {
    return item.group === "model"
      ? translate("chat:detail_model")
      : translate("common:task_delegate");
  }

  if (item.type === "plugin") {
    return translate("common:plugin_pluginsTab");
  }

  if (item.type === "connector") {
    return translate("settings:connectors");
  }

  if (item.type === "thread") {
    return null;
  }

  if (item.type === "github-reference") {
    const referenceKind =
      item.reference.kind === "pull" ? translate("chat:pullRequest") : translate("settings:issue");
    const state =
      item.state === "open"
        ? translate("git:opened")
        : item.state === "closed"
          ? translate("chat:closed")
          : translate("git:merged");
    return `${referenceKind} · ${state}`;
  }

  if (item.type === "local-root") {
    return translate("computer:worktreeMode_local");
  }

  if (item.type === "skill") {
    return formatSkillScope(item.skill.scope);
  }

  if (item.type === "mcp-tool") {
    if (item.unavailable) return translate("chat:providerModelPicker_unavailable");
    return item.toolName === null
      ? translate("chat:commandMenu_mcpServer")
      : translate("chat:commandMenu_mcpTool");
  }

  if (item.type === "model") {
    return translate("chat:detail_model");
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
  translate: ChatTranslator,
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
      groups.push({
        id: "connectors",
        label: translate("settings:connectors"),
        items: connectorItems,
      });
    }
    if (pluginItems.length > 0) {
      groups.push({
        id: "plugins",
        label: translate("common:plugin_pluginsTab"),
        items: pluginItems,
      });
    }
    if (threadItems.length > 0) {
      groups.push({ id: "chats", label: translate("workspace:general_chats"), items: threadItems });
    }
    if (agentItems.length > 0) {
      groups.push({
        id: "subagents",
        label: translate("chat:subagents"),
        items: agentItems,
      });
    }
    if (builtInAgentItems.length > 0) {
      groups.push({
        id: "built-in-agents",
        label: translate("chat:builtIn"),
        items: builtInAgentItems,
      });
    }
    if (modelAliasItems.length > 0) {
      groups.push({
        id: "model-aliases",
        label: translate("workspace:nav_models"),
        items: modelAliasItems,
      });
    }
    if (modeItems.length > 0) {
      groups.push({ id: "modes", label: translate("chat:mode_label"), items: modeItems });
    }
    if (localItems.length > 0) {
      groups.push({
        id: "local",
        label: translate("computer:worktreeMode_local"),
        items: localItems,
      });
    }
    if (otherItems.length > 0) {
      groups.push({ id: "other", label: null, items: otherItems });
    }
    return groups;
  }

  if (triggerKind === "github-reference") {
    return [{ id: "github", label: translate("chat:commandMenu_githubReferences"), items }];
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
    groups.push({ id: "built-in", label: translate("chat:builtIn"), items: builtInItems });
  }
  if (providerItems.length > 0) {
    groups.push({
      id: "provider",
      label: translate("workspace:models_customModelProvider"),
      items: providerItems,
    });
  }
  if (skillItems.length > 0) {
    groups.push({
      id: "skills",
      label: translate("common:plugin_skillsSection"),
      items: skillItems,
    });
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
  const { t } = useTranslation();
  const groups = groupCommandItems(
    props.items,
    props.triggerKind,
    props.groupSlashCommandSections ?? true,
    t,
  );
  const panelGroups: ComposerMenuPanelGroup[] = groups.map((group) => ({
    id: group.id,
    label: group.label,
    rows: group.items.map((item) => ({
      id: item.id,
      icon: commandMenuItemGlyph(item, props.resolvedTheme),
      title:
        item.type === "slash-command" || item.type === "provider-native-command"
          ? commandMenuTitle(item, t)
          : item.label,
      secondary: commandMenuSecondaryText(item),
      trailing:
        item.type === "provider-native-command" && item.notice ? (
          <span className="inline-flex items-center gap-1.5">
            {commandMenuTrailingMeta(item, t)}
            <CommandNoticeBadge notice={item.notice.detail} />
          </span>
        ) : (
          commandMenuTrailingMeta(item, t)
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
            <p
              className={cn(
                COMPOSER_MENU_PANEL_GROUP_LABEL_CLASS_NAME,
                "px-2 py-0 font-medium text-muted-foreground text-ui leading-snug",
              )}
            >
              {t("workspace:toolCallDetails_filesSection")}
            </p>
            <p className="px-2 pt-0.5 text-ui-sm text-muted-foreground/55">
              {t("workspace:typeToSearchForFiles")}
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
                ? t("chat:searchingMentions")
                : props.triggerKind === "skill"
                  ? t("chat:loadingSkills")
                  : t("chat:loadingCommands")
              : (props.emptyStateText ??
                (props.triggerKind === "mention"
                  ? t("chat:noMatchingPluginChatOrFile")
                  : props.triggerKind === "skill"
                    ? t("chat:noMatchingSkill")
                    : t("chat:noMatchingCommand")))}
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

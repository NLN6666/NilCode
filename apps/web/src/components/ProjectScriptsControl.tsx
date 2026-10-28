// FILE: ProjectScriptsControl.tsx
// Purpose: Chat-header control for running a project's actions (scripts).
//          Creating and editing an action lives in ProjectActionDialog, which this control
//          shares with the Environment panel's Actions section.
// Layer: Chat shell header control

import type { ProjectScript, ResolvedKeybindingsConfig } from "@synara/contracts";
import { ChevronDownIcon, PlusIcon, SearchIcon, SettingsIcon, StopIcon } from "~/lib/icons";
import React, { useCallback, useMemo, useState } from "react";

import { shortcutLabelForCommand } from "~/keybindings";
import { useMessages } from "~/i18n/context";
import { cn } from "~/lib/utils";
import { commandForProjectScript, primaryProjectScript } from "~/projectScripts";
import {
  CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
  CHAT_HEADER_SPLIT_TRAILING_CLASS_NAME,
  ChatHeaderIconButton,
  ChatHeaderButton,
  ChatHeaderSplitDivider,
  ChatHeaderSplitGroup,
} from "./chat/chatHeaderControls";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import {
  ProjectActionDialog,
  ScriptIcon,
  type NewProjectScriptInput,
} from "./chat/ProjectActionDialog";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuShortcut, MenuTrigger } from "./ui/menu";

const NO_RUNNING_SCRIPTS: ReadonlySet<string> = new Set<string>();

interface ProjectScriptsControlProps {
  scripts: ProjectScript[];
  keybindings: ResolvedKeybindingsConfig;
  preferredScriptId?: string | null;
  showInlineControls?: boolean;
  hideInlineLabel?: boolean;
  /** Actions whose service is alive right now. These render as Stop instead of Run. */
  runningScriptIds?: ReadonlySet<string>;
  onRunScript: (script: ProjectScript) => void;
  onStopScript?: (script: ProjectScript) => void;
  /** Omitted where there is no project to inspect; the affordance hides itself. */
  onDetectServices?: (() => void) | undefined;
  onAddScript: (input: NewProjectScriptInput) => Promise<void> | void;
  onUpdateScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void> | void;
  onDeleteScript: (scriptId: string) => Promise<void> | void;
}

export default function ProjectScriptsControl({
  scripts,
  keybindings,
  preferredScriptId: preferredScriptIdProp,
  showInlineControls: showInlineControlsProp,
  hideInlineLabel: hideInlineLabelProp,
  runningScriptIds: runningScriptIdsProp,
  onRunScript,
  onStopScript,
  onDetectServices,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
}: ProjectScriptsControlProps) {
  const copy = useMessages().projectTools.scripts;
  const preferredScriptId = preferredScriptIdProp ?? null;
  const showInlineControls = showInlineControlsProp ?? true;
  const hideInlineLabel = hideInlineLabelProp ?? false;
  const runningScriptIds = runningScriptIdsProp ?? NO_RUNNING_SCRIPTS;
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Manual memoization kept: this file does not compile under React Compiler (see compile-report).
  const primaryScript = useMemo(() => {
    if (preferredScriptId) {
      const preferred = scripts.find((script) => script.id === preferredScriptId);
      if (preferred) return preferred;
    }
    return primaryProjectScript(scripts);
  }, [preferredScriptId, scripts]);
  const editingScript = useMemo(
    () =>
      editingScriptId ? (scripts.find((script) => script.id === editingScriptId) ?? null) : null,
    [editingScriptId, scripts],
  );
  const actionMenuItemClassName =
    "group grid min-h-9 grid-cols-[1rem_minmax(0,1fr)_1.5rem] items-center gap-2 rounded-xl px-2.5 py-1.5 text-ui-lg leading-none data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:bg-[var(--color-background-button-secondary-hover)] focus-visible:text-foreground data-highlighted:hover:bg-[var(--color-background-button-secondary-hover)] data-highlighted:hover:text-foreground data-highlighted:focus-visible:bg-[var(--color-background-button-secondary-hover)] data-highlighted:focus-visible:text-foreground [&>svg]:mx-0 [&>svg]:size-4";

  const openAddDialog = () => {
    setEditingScriptId(null);
    setDialogOpen(true);
  };

  const openEditDialog = (script: ProjectScript) => {
    setEditingScriptId(script.id);
    setDialogOpen(true);
  };

  // One click target per action: Run while it is idle, Stop once its service is
  // live. The icon carries the mode; the label keeps showing the action's name so
  // the button neither jumps in width nor loses which service it controls.
  const toggleScript = useCallback(
    (script: ProjectScript) => {
      if (runningScriptIds.has(script.id) && onStopScript) {
        onStopScript(script);
        return;
      }
      onRunScript(script);
    },
    [onRunScript, onStopScript, runningScriptIds],
  );

  // Shared by the populated dropdown and the empty-state one. A project with no
  // actions yet is exactly when this matters most, so the empty state grows a
  // dropdown rather than leaving the affordance unreachable.
  const trailingMenuItems = (
    <>
      <MenuItem className={actionMenuItemClassName} onClick={openAddDialog}>
        <PlusIcon className="size-4 text-muted-foreground" />
        <span className="col-span-2 min-w-0 truncate">{copy.add}</span>
      </MenuItem>
      {onDetectServices ? (
        <MenuItem
          className={actionMenuItemClassName}
          onClick={onDetectServices}
          title={copy.detectServicesHint}
        >
          <SearchIcon className="size-4 text-muted-foreground" />
          <span className="col-span-2 min-w-0 truncate">{copy.detectServices}</span>
        </MenuItem>
      ) : null}
    </>
  );

  const handleSave = useCallback(
    async (input: NewProjectScriptInput) => {
      if (editingScriptId) {
        await onUpdateScript(editingScriptId, input);
        return;
      }
      await onAddScript(input);
    },
    [editingScriptId, onAddScript, onUpdateScript],
  );

  return (
    <>
      {showInlineControls && primaryScript ? (
        <ChatHeaderSplitGroup label={copy.group}>
          <ChatHeaderButton
            className={cn(
              CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
              "min-w-0 gap-1.5 px-2.5",
              hideInlineLabel ? "px-2" : "max-w-44",
            )}
            onClick={() => toggleScript(primaryScript)}
            aria-label={
              runningScriptIds.has(primaryScript.id)
                ? copy.stopAria(primaryScript.name)
                : copy.run(primaryScript.name)
            }
            title={
              runningScriptIds.has(primaryScript.id)
                ? copy.stopAria(primaryScript.name)
                : copy.run(primaryScript.name)
            }
          >
            {runningScriptIds.has(primaryScript.id) ? (
              <StopIcon className="size-3.5 shrink-0 text-destructive" />
            ) : (
              <ScriptIcon icon={primaryScript.icon} className="size-3.5 shrink-0" />
            )}
            <span
              className={cn(
                "max-w-32 truncate font-normal",
                hideInlineLabel ? "sr-only" : "hidden sm:inline",
              )}
            >
              {primaryScript.name}
            </span>
          </ChatHeaderButton>
          <ChatHeaderSplitDivider />
          <Menu highlightItemOnHover={false}>
            <MenuTrigger
              render={
                <ChatHeaderIconButton
                  tone="surface"
                  label={copy.menu}
                  title={copy.menu}
                  className={CHAT_HEADER_SPLIT_TRAILING_CLASS_NAME}
                />
              }
            >
              <ChevronDownIcon className="size-3.5" />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="end" className="min-w-64" sideOffset={8}>
              {scripts.map((script) => {
                const shortcutLabel = shortcutLabelForCommand(
                  keybindings,
                  commandForProjectScript(script.id),
                );
                const isRunning = runningScriptIds.has(script.id);
                return (
                  <MenuItem
                    key={script.id}
                    className={actionMenuItemClassName}
                    onClick={() => toggleScript(script)}
                    aria-label={isRunning ? copy.stopAria(script.name) : copy.run(script.name)}
                  >
                    {isRunning ? (
                      <StopIcon className="size-4 text-destructive" />
                    ) : (
                      <ScriptIcon icon={script.icon} className="size-4 text-muted-foreground" />
                    )}
                    <span className="min-w-0 truncate">
                      {script.runOnWorktreeCreate ? `${script.name} (setup)` : script.name}
                    </span>
                    <span className="flex min-w-0 items-center justify-end">
                      {shortcutLabel && (
                        <MenuShortcut className="ms-0 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                          {shortcutLabel}
                        </MenuShortcut>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 rounded-lg opacity-50 transition-opacity sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-visible:pointer-events-auto sm:group-focus-visible:opacity-100"
                        aria-label={`Edit ${script.name}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openEditDialog(script);
                        }}
                      >
                        <SettingsIcon className="size-3.5" />
                      </Button>
                    </span>
                  </MenuItem>
                );
              })}
              {trailingMenuItems}
            </ComposerPickerMenuPopup>
          </Menu>
        </ChatHeaderSplitGroup>
      ) : showInlineControls && onDetectServices ? (
        <ChatHeaderSplitGroup label={copy.group}>
          <ChatHeaderButton
            className={cn(
              CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
              "gap-1.5 px-2.5",
              hideInlineLabel && "px-2",
            )}
            onClick={openAddDialog}
            aria-label={copy.add}
            title={copy.add}
          >
            <PlusIcon className="size-3.5" />
            <span className={cn("font-normal", hideInlineLabel ? "sr-only" : "hidden sm:inline")}>
              {copy.add}
            </span>
          </ChatHeaderButton>
          <ChatHeaderSplitDivider />
          <Menu highlightItemOnHover={false}>
            <MenuTrigger
              render={
                <ChatHeaderIconButton
                  label={copy.menu}
                  tone="outline"
                  className={CHAT_HEADER_SPLIT_TRAILING_CLASS_NAME}
                />
              }
            >
              <ChevronDownIcon className="size-3.5" />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="end" className="min-w-64" sideOffset={8}>
              {trailingMenuItems}
            </ComposerPickerMenuPopup>
          </Menu>
        </ChatHeaderSplitGroup>
      ) : showInlineControls ? (
        <ChatHeaderButton
          className={cn("gap-1.5 px-2.5", hideInlineLabel && "px-2")}
          onClick={openAddDialog}
          aria-label={copy.add}
          title={copy.add}
        >
          <PlusIcon className="size-3.5" />
          <span className={cn("font-normal", hideInlineLabel ? "sr-only" : "hidden sm:inline")}>
            {copy.add}
          </span>
        </ChatHeaderButton>
      ) : null}

      <ProjectActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        scripts={scripts}
        keybindings={keybindings}
        editingScript={editingScript}
        onSave={handleSave}
        onDelete={onDeleteScript}
      />
    </>
  );
}

// FILE: BrowserPaneTerminalSplit.tsx
// Purpose: Stack the project's service terminal under the browser preview inside one dock pane —
//          a draggable vertical split whose bottom half collapses to a status bar.
// Layer: Chat right-dock UI
// Depends on: browserTerminalSplit.logic (sizing), projectServiceTerminalScope (which terminal
//             set to show), useTerminalSurfaceController (store wiring), ThreadTerminalDrawer.
//
// The terminal shown here is the PROJECT's service scope, not this chat's own drawer: a dev
// server is a project-level resource (its port is), so every thread of the project must see the
// same running state, the same Stop button, and the same output. `projectServiceTerminalThreadId`
// is the same scope `runProjectScript` starts services in.
//
// Collapsed state deliberately reuses the scope's `terminalOpen` instead of adding another flag:
// starting a service already sets it, which is exactly the "expand when a service starts"
// behavior we want — and it now expands in every thread of the project at once.
//
// `cwd` is the HOST thread's workspace: it only applies to terminals created from this pane's
// "+" button. A service keeps the cwd of the run that started it, so a worktree thread's dev
// server still runs in its worktree even though the scope is shared.

import type { ProjectId, ThreadId } from "@synara/contracts";
import { resolveThreadWorkspaceCwd } from "@synara/shared/threadEnvironment";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useMessages } from "~/i18n/context";
import { TerminalIcon } from "~/lib/icons";
import { resolveProjectScriptTerminalScope } from "~/lib/projectServiceTerminalScope";
import { cn } from "~/lib/utils";
import { useTerminalSurfaceController } from "~/hooks/useTerminalSurfaceController";
import { projectScriptRuntimeEnv } from "~/projectScripts";
import { useStore } from "~/store";
import { createProjectSelector, createThreadWorkspaceMetadataSelector } from "~/storeSelectors";
import { selectRunningServiceScriptIds, useTerminalStateStore } from "~/terminalStateStore";
import {
  BROWSER_TERMINAL_DEFAULT_HEIGHT,
  browserTerminalHeightFromDrag,
  clampBrowserTerminalHeight,
} from "./browserTerminalSplit.logic";
import ThreadTerminalDrawer from "../ThreadTerminalDrawer";
import { DisclosureChevron } from "../ui/DisclosureChevron";

export function BrowserPaneTerminalSplit(props: {
  hostThreadId: ThreadId;
  projectId: ProjectId | null;
  children: ReactNode;
}) {
  const copy = useMessages().chat.panes.serviceTerminal;
  const scopeId =
    resolveProjectScriptTerminalScope({
      isService: true,
      projectId: props.projectId,
      threadId: props.hostThreadId,
    }) ?? props.hostThreadId;
  const terminal = useTerminalSurfaceController(scopeId);
  const terminalState = terminal.terminalState;
  const setTerminalOpen = useTerminalStateStore((store) => store.setTerminalOpen);
  const project = useStore(
    useMemo(() => createProjectSelector(props.projectId), [props.projectId]),
  );
  const threadWorkspace = useStore(
    useMemo(() => createThreadWorkspaceMetadataSelector(props.hostThreadId), [props.hostThreadId]),
  );

  const projectCwd = project?.kind === "project" ? project.cwd : null;
  const cwd =
    resolveThreadWorkspaceCwd({
      projectCwd,
      envMode: threadWorkspace.envMode,
      worktreePath: threadWorkspace.worktreePath,
      workingDirectory: threadWorkspace.workingDirectory,
    }) ?? "";
  const runtimeProjectCwd = threadWorkspace.workingDirectory ?? projectCwd;
  const runtimeEnv = useMemo(
    () =>
      runtimeProjectCwd
        ? projectScriptRuntimeEnv({
            project: { cwd: runtimeProjectCwd },
            worktreePath: threadWorkspace.worktreePath,
          })
        : {},
    [runtimeProjectCwd, threadWorkspace.worktreePath],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [terminalHeight, setTerminalHeight] = useState(BROWSER_TERMINAL_DEFAULT_HEIGHT);
  const dragRef = useRef<{ startHeight: number; startPointerY: number } | null>(null);

  const expanded = terminalState.terminalOpen;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const resolvedTerminalHeight = clampBrowserTerminalHeight({
    desiredHeight: terminalHeight,
    containerHeight,
  });

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!expanded) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startHeight: resolvedTerminalHeight, startPointerY: event.clientY };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setTerminalHeight(
      browserTerminalHeightFromDrag({
        startHeight: drag.startHeight,
        startPointerY: drag.startPointerY,
        pointerY: event.clientY,
        containerHeight,
      }),
    );
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Name the alive service(s) on the collapsed bar so the strip says what it is holding
  // rather than a generic "Terminal". Read from the project-wide service scope, which is
  // where `runProjectScript` starts them, so every thread of the project reports the same.
  const runningScriptIds = useMemo(
    () => selectRunningServiceScriptIds(terminalState),
    [terminalState],
  );
  const runningScriptNames =
    project?.kind === "project"
      ? project.scripts
          .filter((script) => runningScriptIds.has(script.id))
          .map((script) => script.name)
      : [];
  const statusLabel =
    runningScriptNames.length === 1 && runningScriptNames[0]
      ? copy.running(runningScriptNames[0])
      : runningScriptNames.length > 1
        ? copy.runningCount(runningScriptNames.length)
        : copy.title;

  return (
    <div ref={containerRef} className="flex h-full min-h-0 w-full flex-col">
      <div className="min-h-0 flex-1">{props.children}</div>

      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={copy.resize}
        className={cn(
          "h-1 shrink-0 border-t border-border/70 transition-colors",
          expanded ? "cursor-row-resize hover:bg-[var(--color-border)]" : "cursor-default",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      />

      <div className="flex shrink-0 flex-col bg-[var(--color-background-surface)]">
        <button
          type="button"
          className="flex h-7 shrink-0 items-center gap-1.5 px-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={expanded}
          aria-label={expanded ? copy.collapse : copy.expand}
          title={expanded ? copy.collapse : copy.expand}
          onClick={() => setTerminalOpen(scopeId, !expanded)}
        >
          <DisclosureChevron open={expanded} />
          <TerminalIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{statusLabel}</span>
          {runningScriptNames.length > 0 ? (
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-[var(--color-text-success,theme(colors.emerald.500))]"
            />
          ) : null}
        </button>

        <div
          className="w-full shrink-0 overflow-hidden transition-[height] duration-220 ease-out motion-reduce:transition-none"
          style={{ height: expanded ? `${resolvedTerminalHeight}px` : "0px" }}
        >
          {/* Mounted only while open: a collapsed pane must not spawn a shell for a project
              whose service was never started. Unmounting detaches the xterm runtime without
              disposing it, so re-expanding restores the same buffer and the same PTY. */}
          {expanded ? (
            <ThreadTerminalDrawer
              key={scopeId}
              threadId={scopeId}
              cwd={cwd}
              runtimeEnv={runtimeEnv}
              height={resolvedTerminalHeight}
              presentationMode="workspace"
              isVisible
              terminalIds={terminalState.terminalIds}
              terminalLabelsById={terminalState.terminalLabelsById}
              terminalTitleOverridesById={terminalState.terminalTitleOverridesById}
              terminalCliKindsById={terminalState.terminalCliKindsById}
              terminalAttentionStatesById={terminalState.terminalAttentionStatesById ?? {}}
              runningTerminalIds={terminalState.runningTerminalIds}
              activeTerminalId={terminalState.activeTerminalId}
              terminalGroups={terminalState.terminalGroups}
              activeTerminalGroupId={terminalState.activeTerminalGroupId}
              focusRequestId={terminal.focusRequestId}
              onSplitTerminal={terminal.splitRight}
              onSplitTerminalDown={terminal.splitDown}
              onNewTerminal={terminal.newTerminalGroup}
              onNewTerminalTab={terminal.createTerminalTab}
              onMoveTerminalToGroup={terminal.moveTerminalToNewGroup}
              onActiveTerminalChange={terminal.activateTerminal}
              onCloseTerminal={terminal.closeTerminal}
              onTerminalSessionExited={terminal.handleTerminalSessionExited}
              onCloseTerminalGroup={terminal.closeTerminalGroup}
              onHeightChange={terminal.setTerminalHeight}
              onResizeTerminalSplit={terminal.resizeTerminalSplit}
              onTerminalMetadataChange={terminal.setTerminalMetadata}
              onTerminalActivityChange={terminal.setTerminalActivity}
              onAddTerminalContext={() => {}}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default BrowserPaneTerminalSplit;

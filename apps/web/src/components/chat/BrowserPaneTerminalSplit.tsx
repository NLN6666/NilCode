// FILE: BrowserPaneTerminalSplit.tsx
// Purpose: Stack the thread's terminal under the browser preview inside one dock pane —
//          a draggable vertical split whose bottom half collapses to a status bar.
// Layer: Chat right-dock UI
// Depends on: browserTerminalSplit.logic (sizing), browserTerminalHostStore (mount slot),
//             terminalStateStore (open/collapsed + which action's service is alive).
//
// The terminal itself is NOT rendered here. This component only publishes the slot; ChatView
// portals its existing ThreadTerminalDrawer into it, so the terminal keeps one xterm runtime
// and one set of store callbacks whether it sits here or in the chat column.
//
// Collapsed state deliberately reuses `terminalOpen` instead of adding another flag: running an
// action already sets it, which is exactly the "expand when a service starts" behavior we want.

import type { ProjectId, ThreadId } from "@synara/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useMessages } from "~/i18n/context";
import { TerminalIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useBrowserTerminalHostStore } from "~/browserTerminalHostStore";
import { useStore } from "~/store";
import { createProjectSelector } from "~/storeSelectors";
import {
  selectRunningServiceScriptIds,
  selectThreadTerminalState,
  useTerminalStateStore,
} from "~/terminalStateStore";
import {
  BROWSER_TERMINAL_DEFAULT_HEIGHT,
  browserTerminalHeightFromDrag,
  clampBrowserTerminalHeight,
} from "./browserTerminalSplit.logic";
import { DisclosureChevron } from "../ui/DisclosureChevron";

export function BrowserPaneTerminalSplit(props: {
  hostThreadId: ThreadId;
  projectId: ProjectId | null;
  children: ReactNode;
}) {
  const copy = useMessages().chat.panes.serviceTerminal;
  const terminalState = useTerminalStateStore((store) =>
    selectThreadTerminalState(store.terminalStateByThreadId, props.hostThreadId),
  );
  const setTerminalOpen = useTerminalStateStore((store) => store.setTerminalOpen);
  const setHost = useBrowserTerminalHostStore((store) => store.setHost);
  const project = useStore(
    useMemo(() => createProjectSelector(props.projectId), [props.projectId]),
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [terminalHeight, setTerminalHeight] = useState(BROWSER_TERMINAL_DEFAULT_HEIGHT);
  const dragRef = useRef<{ startHeight: number; startPointerY: number } | null>(null);

  const expanded = terminalState.terminalOpen;

  // Publish the slot for as long as this pane is mounted. ChatView decides whether to portal
  // into it (it renders no drawer at all while the terminal is closed), so registering
  // unconditionally keeps the two sides from disagreeing about who owns the terminal.
  const registerHost = useCallback(
    (node: HTMLDivElement | null) => {
      setHost(props.hostThreadId, node);
    },
    [props.hostThreadId, setHost],
  );
  useEffect(() => () => setHost(props.hostThreadId, null), [props.hostThreadId, setHost]);

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
  // rather than a generic "Terminal".
  const runningScriptIds = selectRunningServiceScriptIds(terminalState);
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
          onClick={() => setTerminalOpen(props.hostThreadId, !expanded)}
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

        {/* Kept mounted so the portal target survives a collapse; height is what animates. */}
        <div
          ref={registerHost}
          className="w-full shrink-0 overflow-hidden transition-[height] duration-220 ease-out motion-reduce:transition-none"
          style={{ height: expanded ? `${resolvedTerminalHeight}px` : "0px" }}
        />
      </div>
    </div>
  );
}

export default BrowserPaneTerminalSplit;

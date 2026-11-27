import type { ProjectId, ThreadId } from "@synara/contracts";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useTerminalContextComposerTarget } from "~/hooks/useTerminalContextComposerTarget";
import { useTranslation } from "~/i18n";
import { SINGLE_CHAT_PANE_SCOPE_ID } from "~/lib/chatPaneScope";
import { DISCLOSURE_HEIGHT_MOTION_CLASS } from "~/lib/disclosureMotion";
import { TerminalIcon, XIcon } from "~/lib/icons";
import { resolveProjectScriptTerminalScope } from "~/lib/projectServiceTerminalScope";
import { cn } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { createProjectSelector } from "~/storeSelectors";
import { useTerminalStateStore, type ThreadTerminalState } from "~/terminalStateStore";
import {
  closeProjectScriptTerminal,
  settleExitedProjectScriptTerminal,
} from "../terminal/terminalSession";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { IconButton } from "../ui/icon-button";
import { toastManager } from "../ui/toast";
import {
  BROWSER_TERMINAL_DEFAULT_HEIGHT,
  browserTerminalHeightFromDrag,
  clampBrowserTerminalHeight,
} from "./browserTerminalSplit.logic";

const ThreadTerminalDrawer = lazy(() => import("../ThreadTerminalDrawer"));

function useProjectActionTerminalScopes(
  hostThreadId: ThreadId | null,
  projectId: ProjectId | null,
) {
  const actionScope = resolveProjectScriptTerminalScope({
    isService: false,
    threadId: hostThreadId,
    projectId,
  });
  const serviceScope = resolveProjectScriptTerminalScope({
    isService: true,
    threadId: hostThreadId,
    projectId,
  });
  const actionState = useTerminalStateStore((state) =>
    actionScope === null ? undefined : state.terminalStateByThreadId[actionScope],
  );
  const serviceState = useTerminalStateStore((state) =>
    serviceScope === null ? undefined : state.terminalStateByThreadId[serviceScope],
  );
  return { actionScope, actionState, serviceScope, serviceState };
}

function hasActions(state: ThreadTerminalState | undefined) {
  return state !== undefined && Object.keys(state.projectScriptIdsByTerminalId).length > 0;
}

export function useHasProjectActionTerminals(
  hostThreadId: ThreadId | null,
  projectId: ProjectId | null,
) {
  const { actionState, serviceState } = useProjectActionTerminalScopes(hostThreadId, projectId);
  return hasActions(actionState) || hasActions(serviceState);
}

function terminalRows(threadId: ThreadId | null, state: ThreadTerminalState | undefined) {
  if (threadId === null || state === undefined) return [];
  return Object.entries(state.projectScriptIdsByTerminalId).map(([id, scriptId]) => ({
    id,
    scriptId,
    threadId,
    state,
    running: state.runningTerminalIds.includes(id),
  }));
}

/** The action tray sits below the active dock content, not inside the browser or terminal tab. */
export function ProjectActionTerminalSplit(props: {
  hostThreadId: ThreadId;
  projectId: ProjectId | null;
  paneScopeId?: string;
  isVisible: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const project = useStore(
    useMemo(() => createProjectSelector(props.projectId), [props.projectId]),
  );
  const { actionScope, actionState, serviceScope, serviceState } = useProjectActionTerminalScopes(
    props.hostThreadId,
    props.projectId,
  );
  const composerTarget = useTerminalContextComposerTarget(
    props.paneScopeId ?? SINGLE_CHAT_PANE_SCOPE_ID,
  );
  const rows = [
    ...terminalRows(serviceScope, serviceState),
    ...(serviceScope === actionScope ? [] : terminalRows(actionScope, actionState)),
  ];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = rows.find((row) => row.id === expandedId);
  const hasRows = rows.length > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [terminalHeight, setTerminalHeight] = useState(BROWSER_TERMINAL_DEFAULT_HEIGHT);
  const dragRef = useRef<{ startHeight: number; startPointerY: number } | null>(null);
  const resolvedTerminalHeight = clampBrowserTerminalHeight({
    desiredHeight: terminalHeight,
    containerHeight,
  });

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !hasRows || !props.isVisible) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasRows, props.isVisible]);

  return (
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">{props.children}</div>
      {hasRows && props.isVisible ? (
        <div className="flex shrink-0 flex-col border-t border-border/70 bg-[var(--color-background-surface)]">
          {expanded ? (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label={t("chat:projectActionTerminal_resize")}
              className="h-1 shrink-0 cursor-row-resize hover:bg-border"
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = {
                  startHeight: resolvedTerminalHeight,
                  startPointerY: event.clientY,
                };
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag) return;
                setTerminalHeight(
                  browserTerminalHeightFromDrag({
                    ...drag,
                    pointerY: event.clientY,
                    containerHeight,
                  }),
                );
              }}
              onLostPointerCapture={() => {
                dragRef.current = null;
              }}
            />
          ) : null}
          <div className="max-h-28 overflow-y-auto">
            {rows.map((row) => {
              const name =
                project?.scripts.find((script) => script.id === row.scriptId)?.name ??
                row.state.terminalLabelsById[row.id] ??
                t("chat:terminal");
              const open = row.id === expandedId;
              const toggleLabel = open
                ? t("chat:projectActionTerminal_collapse", { value0: name })
                : t("chat:projectActionTerminal_expand", { value0: name });
              return (
                <div key={row.id} className="flex h-7 items-center px-1">
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-1 text-ui-xs text-muted-foreground transition-colors hover:text-foreground"
                    aria-expanded={open}
                    aria-label={toggleLabel}
                    title={toggleLabel}
                    onClick={() => setExpandedId(open ? null : row.id)}
                  >
                    <DisclosureChevron open={open} />
                    <TerminalIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{name}</span>
                    {row.running ? (
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
                    ) : null}
                  </button>
                  <IconButton
                    label={t("workspace:closeTerminal")}
                    title={t("workspace:closeTerminal")}
                    onClick={() => {
                      void closeProjectScriptTerminal(readNativeApi(), row.threadId, row.id).catch(
                        (error: unknown) => {
                          toastManager.add({
                            type: "error",
                            title: t("chat:unableToCloseTerminal"),
                            description:
                              error instanceof Error ? error.message : t("common:pleaseTryAgain"),
                          });
                        },
                      );
                    }}
                  >
                    <XIcon className="size-3.5" />
                  </IconButton>
                </div>
              );
            })}
          </div>
          <div
            className={cn("w-full shrink-0", DISCLOSURE_HEIGHT_MOTION_CLASS)}
            style={{ height: expanded ? resolvedTerminalHeight : 0 }}
          >
            {expanded ? (
              <Suspense fallback={null}>
                <ThreadTerminalDrawer
                  key={expanded.id}
                  threadId={expanded.threadId}
                  cwd={project?.cwd ?? "."}
                  activeTerminalId={expanded.id}
                  terminalLabelsById={expanded.state.terminalLabelsById}
                  terminalTitleOverridesById={expanded.state.terminalTitleOverridesById}
                  terminalCliKindsById={expanded.state.terminalCliKindsById}
                  focusRequestId={0}
                  onTerminalSessionExited={(id) => {
                    settleExitedProjectScriptTerminal(readNativeApi(), expanded.threadId, id);
                  }}
                  onTerminalMetadataChange={(id, metadata) => {
                    useTerminalStateStore
                      .getState()
                      .setTerminalMetadata(expanded.threadId, id, metadata);
                  }}
                  onTerminalActivityChange={(id, activity) => {
                    useTerminalStateStore
                      .getState()
                      .setTerminalActivity(expanded.threadId, id, activity);
                  }}
                  onAddTerminalContext={composerTarget}
                />
              </Suspense>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

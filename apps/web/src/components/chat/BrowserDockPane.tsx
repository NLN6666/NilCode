// FILE: BrowserDockPane.tsx
// Purpose: Resolve which browser surface a chat pane drives and arbitrate ownership of it,
//          then render the browser panel against that surface.
// Layer: Chat right-dock UI
// Depends on: shared browser-surface resolution, the surface claim store, and BrowserPanel.
//
// Both chat surfaces (single and split) mount the browser through here so the sharing rules
// live in exactly one place. Two decisions happen before BrowserPanel renders:
//
//  1. WHICH surface. A project set to `shared` points all of its threads at one project-wide
//     browser; otherwise each thread drives its own. Resolution is `@synara/shared/browserSurface`,
//     the same helper the agent gateway uses, so the agent and the user never end up on
//     different browsers.
//  2. WHO drives it. A surface is one native view and can only be hosted by one pane, so a
//     second pane on the same surface renders in `preview` mode — it still shows the live
//     page's title and URL from the shared cached state, and any interaction takes over.

import { DEFAULT_PROJECT_BROWSER_SHARING, type ThreadId } from "@synara/contracts";
import { Suspense, useMemo, useState } from "react";

import { resolveBrowserSurfaceId } from "@synara/shared/browserSurface";

import { useBrowserSurfaceClaim } from "~/browserSurfaceClaimStore";
import { randomUUID } from "~/lib/utils";
import { setProjectBrowserSharing } from "~/lib/projectBrowserSharing";
import type { DockPaneRuntimeMode } from "~/lib/dockPaneActivation";
import { useStore } from "~/store";
import { createProjectSelector, createThreadSelector } from "~/storeSelectors";
import { useTranslation } from "~/i18n";

import { LazyBrowserPanel } from "./ChatThreadSurfacePrimitives";
import { PanelStateMessage } from "./PanelStateMessage";

export function BrowserDockPane(props: {
  threadId: ThreadId;
  mode?: "sidebar" | "floating";
  /** Distinguishes two mounted panes on the same surface. */
  paneId: string;
  onClosePanel: () => void;
  runtimeMode?: DockPaneRuntimeMode;
  onRequestLive?: () => void;
}) {
  const { t } = useTranslation();
  const thread = useStore(useMemo(() => createThreadSelector(props.threadId), [props.threadId]));
  const projectId = thread?.projectId ?? null;
  const project = useStore(useMemo(() => createProjectSelector(projectId), [projectId]));
  const sharing = project?.browserSharing ?? DEFAULT_PROJECT_BROWSER_SHARING;
  const browserSurfaceId = resolveBrowserSurfaceId({
    threadId: props.threadId,
    projectId,
    sharing,
  });

  // Offered here as well as in the sidebar project menu: the difference between one shared
  // browser and one per thread is only felt while using the browser, so the switch belongs
  // within reach of it.
  const projectBrowserSharing = useMemo(() => {
    if (projectId === null) return undefined;
    const shared = sharing === "shared";
    return {
      shared,
      onToggle: () => {
        void setProjectBrowserSharing({
          projectId,
          browserSharing: shared ? "isolated" : "shared",
          failureTitle: t(
            shared ? "chat:browserSharing_isolateFailed" : "chat:browserSharing_shareFailed",
          ),
        });
      },
    };
  }, [projectId, sharing, t]);

  // A shared surface can move between host threads while this keyed pane stays mounted.
  // Give each mounted pane its own stable claim identity rather than deriving it from
  // host-thread/pane ids that can collide with another split pane after a host switch.
  const [ownerKey] = useState(() => randomUUID());
  const { isOwner, takeOver } = useBrowserSurfaceClaim({ surfaceId: browserSurfaceId, ownerKey });

  // A pane that does not own the surface must issue no browser IPC at all, which `preview`
  // already guarantees — every call in BrowserPanel is gated on the live runtime.
  const runtimeMode: DockPaneRuntimeMode = isOwner ? (props.runtimeMode ?? "live") : "preview";
  const onRequestLive = useMemo(() => {
    const requestLive = props.onRequestLive;
    return () => {
      takeOver();
      requestLive?.();
    };
  }, [props.onRequestLive, takeOver]);

  return (
    <Suspense
      fallback={<PanelStateMessage>{t("chat:browserSharing_loadingBrowser")}</PanelStateMessage>}
    >
      <LazyBrowserPanel
        mode={props.mode ?? "sidebar"}
        threadId={props.threadId}
        browserSurfaceId={browserSurfaceId}
        onClosePanel={props.onClosePanel}
        runtimeMode={runtimeMode}
        onRequestLive={onRequestLive}
        projectBrowserSharing={projectBrowserSharing}
      />
    </Suspense>
  );
}

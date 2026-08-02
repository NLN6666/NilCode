// FILE: DockThreadPane.tsx
// Purpose: Embeds another thread's live chat surface inside a right-dock pane.
// Layer: Chat right-dock UI
// Exports: DockThreadPane
// Why: Dock panes are not part of the route's visible-thread set, so an embedded
//      thread holds no detail-stream lease of its own. Without one the transcript
//      renders empty for any thread nothing else happens to be streaming, which
//      is the common case for a subagent opened from the sidebar.

import { useEffect } from "react";

import type { ThreadId } from "@synara/contracts";

import { dockSidechatPaneScopeId } from "../../lib/chatPaneScope";
import type { SplitViewPanePanelState } from "../../splitViewStore";
import { retainThreadDetailSubscription } from "../../threadDetailSubscriptionRetention";
import { DeferredChatView, noopChatSurfaceAction } from "./ChatThreadSurfacePrimitives";

export function DockThreadPane(props: {
  threadId: ThreadId;
  paneId: string;
  panelState: SplitViewPanePanelState;
  onClose: () => void;
}) {
  const { threadId } = props;

  // Closing the pane unmounts this component and releases the lease, so opening
  // and closing panes repeatedly never accumulates live detail streams.
  useEffect(() => retainThreadDetailSubscription(threadId), [threadId]);

  return (
    <DeferredChatView
      threadId={threadId}
      paneScopeId={dockSidechatPaneScopeId(props.paneId)}
      deferMount={false}
      surfaceMode="split"
      isFocusedPane={false}
      panelState={props.panelState}
      onToggleDiff={noopChatSurfaceAction}
      onToggleBrowser={noopChatSurfaceAction}
      onOpenBrowserUrl={noopChatSurfaceAction}
      onOpenTurnDiff={noopChatSurfaceAction}
      onCloseThreadPane={props.onClose}
    />
  );
}

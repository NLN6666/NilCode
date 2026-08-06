// FILE: chatPaneScope.ts
// Purpose: Single source for chat pane scope ids — the `data-chat-pane-scope`
//          attribute contract shared by ChatView (which stamps the attribute on
//          the composer form), the chat route (which assigns scopes to panes),
//          and panelResize's composer probe (which queries by scope).
// Layer: Web chat-surface contracts (no runtime logic beyond string building).

/** The full-width single chat pane (also ChatView's default scope). */
export const SINGLE_CHAT_PANE_SCOPE_ID = "single";

/** The chat pane docked inside the editor workspace view. */
export const EDITOR_CHAT_PANE_SCOPE_ID = "editor-chat";

const DOCK_SIDECHAT_PANE_SCOPE_PREFIX = "dock-sidechat:";

/** A sidechat thread hosted as a right-dock pane. */
export function dockSidechatPaneScopeId(paneId: string): string {
  return `${DOCK_SIDECHAT_PANE_SCOPE_PREFIX}${paneId}`;
}

/**
 * Whether a chat pane is itself embedded in a right dock. Dock panes report
 * `surfaceMode: "split"` (they render the compact surface), so this is the only
 * reliable way to tell "embedded in a dock, which therefore exists" apart from
 * "a real split-view pane, which has no dock at all".
 */
export function isDockSidechatPaneScopeId(paneScopeId: string): boolean {
  return paneScopeId.startsWith(DOCK_SIDECHAT_PANE_SCOPE_PREFIX);
}

/** A chat pane inside a split view. */
export function splitViewPaneScopeId(splitViewId: string, paneId: string): string {
  return `${splitViewId}:${paneId}`;
}

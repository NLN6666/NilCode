// FILE: browserSurface.ts
// Purpose: Resolve which in-app browser surface a thread drives, so a project can either share
//   one browser across all of its threads or give every thread its own.
// Layer: Shared runtime utility
// Depends on: contract identity + project browser sharing types

import { ThreadId, type ProjectBrowserSharing, type ProjectId } from "@synara/contracts";

/**
 * Prefix marking a browser surface that belongs to a project rather than a thread.
 *
 * The desktop browser runtime keys every tab, renderer, and panel bound by an opaque owner id
 * and creates state for an unseen id on demand, so a project surface needs no runtime changes —
 * only an id that can never collide with a real thread id. Thread ids are generated identifiers
 * that never carry a colon-delimited prefix, which is what makes this namespace safe.
 */
export const PROJECT_BROWSER_SURFACE_PREFIX = "project-browser:";

/**
 * The browser surface owned by a project as a whole.
 *
 * Typed as `ThreadId` because it flows through the existing browser IPC and automation channels
 * in the `threadId` slot. This is the one place that conversion is allowed: every other caller
 * must take the id from here rather than building the string itself.
 */
export function projectBrowserSurfaceId(projectId: ProjectId): ThreadId {
  return ThreadId.makeUnsafe(`${PROJECT_BROWSER_SURFACE_PREFIX}${projectId}`);
}

export interface ResolveBrowserSurfaceIdInput {
  readonly threadId: ThreadId;
  /** Null for threads outside a project (scratch chats), which can never share. */
  readonly projectId: ProjectId | null | undefined;
  readonly sharing: ProjectBrowserSharing | null | undefined;
}

/**
 * The browser surface a thread drives.
 *
 * Falls back to the thread's own surface whenever sharing is off, unset, or the thread has no
 * project: an unknown or missing setting must never silently merge two threads' browsers.
 */
export function resolveBrowserSurfaceId(input: ResolveBrowserSurfaceIdInput): ThreadId {
  if (input.sharing !== "shared" || !input.projectId) {
    return input.threadId;
  }
  return projectBrowserSurfaceId(input.projectId);
}

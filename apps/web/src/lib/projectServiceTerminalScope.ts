// FILE: projectServiceTerminalScope.ts
// Purpose: Derive the project-wide terminal scope that long-running services run in.
// Layer: Terminal scope helpers
// Exports: project service scope prefix, the id factory, and the one rule deciding which
//          terminal scope a project action runs in.
//
// A service declares a port, and a port is a project-level singleton: two chats in the
// same project cannot each own `erp-seed` on :5173. So the service terminal is keyed by
// the project rather than by the chat that happened to start it — every thread in the
// project then reads the same running state, drives the same Stop button, and looks at
// the same terminal. Mirrors `dockTerminalScope`: a synthetic ThreadId flows through
// every existing `threadId` slot (store, runtime registry, server session) unchanged.

import type { ProjectId, ThreadId } from "@synara/contracts";

export const PROJECT_SERVICE_TERMINAL_SCOPE_PREFIX = "project-service:";

export function projectServiceTerminalThreadId(projectId: ProjectId): ThreadId {
  return `${PROJECT_SERVICE_TERMINAL_SCOPE_PREFIX}${projectId}` as ThreadId;
}

/**
 * Which terminal scope a project action runs in — the single source of this rule, shared by
 * the runner (start), the action buttons (status + stop), and the preview pane (display), so
 * they can never disagree about where a service lives.
 *
 * A service runs project-wide; a test or build run belongs to the chat that asked for it. A
 * projectless chat has nowhere shared to put anything, so it keeps its own scope.
 */
export function resolveProjectScriptTerminalScope(input: {
  isService: boolean;
  projectId: ProjectId | null;
  threadId: ThreadId | null;
}): ThreadId | null {
  if (input.isService && input.projectId !== null) {
    return projectServiceTerminalThreadId(input.projectId);
  }
  return input.threadId;
}

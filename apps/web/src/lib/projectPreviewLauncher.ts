// FILE: projectPreviewLauncher.ts
// Purpose: Wait for a started service's declared port and open it in the in-app browser,
//          outliving the chat view that pressed Run.
// Layer: Web runtime utility
// Exports: opener registration, preview start, and the pending-wait teardown.
//
// Why this is not a hook's local state: a service belongs to the PROJECT (see
// projectServiceTerminalScope), so the user starts a dev server in one chat and switches to
// another while it boots. A wait owned by ChatView aborts on that unmount and the preview
// never opens. The wait therefore lives here, keyed by project, and the opening is late-bound
// to whichever chat of that project is mounted when the port finally answers.

import type { ProjectId, ProjectScript } from "@synara/contracts";

import { toastManager } from "~/components/ui/toast";
import {
  previewUrlForPort,
  waitForPreviewReady,
  type WaitForPreviewOptions,
} from "~/lib/previewReadiness";
import { readNativeApi } from "~/nativeApi";

/** Opens `url` in the in-app browser of the chat that registered it. */
export type ProjectPreviewOpener = (url: string) => void;

const openerByProjectId = new Map<ProjectId, ProjectPreviewOpener>();
const pendingByProjectId = new Map<ProjectId, AbortController>();

/**
 * Publish the mounted chat's browser as the target for its project's previews.
 *
 * Last registration wins: exactly one chat surface per project is mounted at a time, and after
 * a thread switch the new one is the window the user is actually looking at. The returned
 * disposer only clears the slot when it still holds this opener, so an unmount that lands after
 * its successor mounted cannot blank it.
 */
export function registerProjectPreviewOpener(
  projectId: ProjectId,
  opener: ProjectPreviewOpener,
): () => void {
  openerByProjectId.set(projectId, opener);
  return () => {
    if (openerByProjectId.get(projectId) === opener) {
      openerByProjectId.delete(projectId);
    }
  };
}

/** Drop a project's pending wait — the service was stopped, or its chat is gone for good. */
export function abortProjectPreview(projectId: ProjectId): void {
  pendingByProjectId.get(projectId)?.abort();
  pendingByProjectId.delete(projectId);
}

function openExternallyToast(script: ProjectScript, url: string, port: number): void {
  // No in-app browser on the web build (it is an Electron WebContentsView), and no mounted
  // chat to open one in when the user has navigated away. Both degrade to the same offer.
  toastManager.add({
    type: "success",
    title: `"${script.name}" is serving on port ${port}`,
    description: url,
    actionProps: {
      children: "Open",
      onClick: () => {
        void readNativeApi()?.shell.openExternal(url);
      },
    },
  });
}

export interface StartProjectPreviewInput {
  readonly projectId: ProjectId;
  readonly script: ProjectScript;
  /** Electron hosts the in-app browser; the web build can only hand the URL to the real one. */
  readonly canOpenInApp: boolean;
  /** Probe/clock overrides; tests drive readiness without a real socket. */
  readonly readiness?: WaitForPreviewOptions;
}

/**
 * Begin waiting for `script.port`; a no-op for actions that declare none.
 *
 * One wait per project: starting another action supersedes the previous one, matching the
 * single browser surface it would open into.
 */
export function startProjectPreview(input: StartProjectPreviewInput): void {
  const port = input.script.port;
  if (port === null || port === undefined) {
    return;
  }

  const { projectId, script } = input;
  pendingByProjectId.get(projectId)?.abort();
  const controller = new AbortController();
  pendingByProjectId.set(projectId, controller);
  const url = previewUrlForPort(port);

  void waitForPreviewReady(url, { ...input.readiness, signal: controller.signal }).then((ready) => {
    if (controller.signal.aborted) {
      return;
    }
    if (pendingByProjectId.get(projectId) === controller) {
      pendingByProjectId.delete(projectId);
    }
    if (!ready) {
      toastManager.add({
        type: "error",
        title: `"${script.name}" never started serving on port ${port}`,
        description: "Check the terminal output, or update the action's preview port.",
      });
      return;
    }
    const opener = input.canOpenInApp ? openerByProjectId.get(projectId) : undefined;
    if (opener) {
      opener(url);
      return;
    }
    openExternallyToast(script, url, port);
  });
}

/** Test seam: drop every registration and pending wait between cases. */
export function resetProjectPreviewLauncherForTest(): void {
  for (const controller of pendingByProjectId.values()) {
    controller.abort();
  }
  pendingByProjectId.clear();
  openerByProjectId.clear();
}

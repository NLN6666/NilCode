// FILE: projectBrowserSharing.ts
// Purpose: Dispatch a project's browser-sharing setting.
// Layer: Web command dispatch
//
// Two surfaces flip this setting — the sidebar project menu and the browser panel's own actions
// menu — so the command shape and the failure handling live here instead of being duplicated at
// each call site. The failure title is passed in so this module stays locale-free and each
// surface can word its toast for its own context.

import type { ProjectBrowserSharing, ProjectId } from "@synara/contracts";

import { toastManager } from "../components/ui/toast";
import { readNativeApi } from "../nativeApi";
import { newCommandId } from "./utils";

/**
 * No optimistic mirror: unlike pinning there is no client-side limit to enforce, so the projected
 * project row stays the only source of truth and every surface reflects the change on the echo.
 */
export async function setProjectBrowserSharing(input: {
  projectId: ProjectId;
  browserSharing: ProjectBrowserSharing;
  failureTitle: string;
}): Promise<void> {
  const api = readNativeApi();
  if (!api) return;
  try {
    await api.orchestration.dispatchCommand({
      type: "project.meta.update",
      commandId: newCommandId(),
      projectId: input.projectId,
      browserSharing: input.browserSharing,
    });
  } catch (error) {
    toastManager.add({
      type: "error",
      title: input.failureTitle,
      description: error instanceof Error ? error.message : undefined,
    });
  }
}

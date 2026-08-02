// FILE: useProjectScriptPreview.ts
// Purpose: Bind the mounted chat's in-app browser to its project's service previews, and
//          start the wait when an action with a declared port runs.
// Layer: Web ChatView controller hook
// Exports: useProjectScriptPreview
//
// The waiting itself lives in `projectPreviewLauncher`, at module scope: a dev server belongs
// to the project, so the user routinely switches chats while it boots and a wait owned by this
// hook would abort on unmount. Here we only publish where a ready preview should open.

import type { ProjectId, ProjectScript } from "@synara/contracts";
import { useCallback, useEffect, useRef } from "react";

import { isElectron } from "~/env";
import { registerProjectPreviewOpener, startProjectPreview } from "~/lib/projectPreviewLauncher";

export interface ProjectScriptPreviewController {
  /** Begin waiting for `script.port`; a no-op for actions that declare none. */
  readonly startPreview: (script: ProjectScript) => void;
}

export function useProjectScriptPreview(input: {
  readonly projectId: ProjectId | null;
  readonly openBrowserUrl: (url: string) => void;
}): ProjectScriptPreviewController {
  const { projectId, openBrowserUrl } = input;

  // Read through a ref so re-registration is driven by the project alone: `openBrowserUrl` is
  // rebuilt whenever routing state changes, and re-registering on every one of those would
  // churn the launcher's slot for no behavioral gain.
  const openBrowserUrlRef = useRef(openBrowserUrl);
  openBrowserUrlRef.current = openBrowserUrl;

  useEffect(() => {
    if (projectId === null) return;
    return registerProjectPreviewOpener(projectId, (url) => openBrowserUrlRef.current(url));
  }, [projectId]);

  const startPreview = useCallback(
    (script: ProjectScript) => {
      if (projectId === null) return;
      startProjectPreview({ projectId, script, canOpenInApp: isElectron });
    },
    [projectId],
  );

  return { startPreview };
}

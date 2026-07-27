// FILE: useProjectScriptPreview.ts
// Purpose: After an action with a declared preview port starts, wait for the port to
//          serve and then open it — in the in-app browser on desktop, externally on web.
// Layer: Web ChatView controller hook
// Exports: useProjectScriptPreview

import type { ProjectScript } from "@synara/contracts";
import { useCallback, useEffect, useRef } from "react";

import { toastManager } from "~/components/ui/toast";
import { isElectron } from "~/env";
import { previewUrlForPort, waitForPreviewReady } from "~/lib/previewReadiness";
import { readNativeApi } from "~/nativeApi";

export interface ProjectScriptPreviewController {
  /** Begin waiting for `script.port`; a no-op for actions that declare none. */
  readonly startPreview: (script: ProjectScript) => void;
}

export function useProjectScriptPreview(input: {
  readonly openBrowserUrl: (url: string) => void;
}): ProjectScriptPreviewController {
  const openBrowserUrl = input.openBrowserUrl;
  const pendingRef = useRef<AbortController | null>(null);

  // Only one preview can be pending: starting a second action supersedes the
  // first, and unmounting must not leave a poll running against a dead view.
  useEffect(() => () => pendingRef.current?.abort(), []);

  const startPreview = useCallback(
    (script: ProjectScript) => {
      const port = script.port;
      if (port === null || port === undefined) {
        return;
      }

      pendingRef.current?.abort();
      const controller = new AbortController();
      pendingRef.current = controller;
      const url = previewUrlForPort(port);

      void waitForPreviewReady(url, { signal: controller.signal }).then((ready) => {
        if (controller.signal.aborted) {
          return;
        }
        pendingRef.current = null;
        if (!ready) {
          toastManager.add({
            type: "error",
            title: `"${script.name}" never started serving on port ${port}`,
            description: "Check the terminal output, or update the action's preview port.",
          });
          return;
        }
        if (isElectron) {
          openBrowserUrl(url);
          return;
        }
        // The in-app browser is an Electron WebContentsView; on the web build the
        // nearest equivalent is handing the URL to the real browser.
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
      });
    },
    [openBrowserUrl],
  );

  return { startPreview };
}

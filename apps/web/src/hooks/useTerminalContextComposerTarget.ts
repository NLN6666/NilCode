// FILE: useTerminalContextComposerTarget.ts
// Purpose: Subscribe terminal surfaces to the composer target for their pane scope.
// Layer: Web terminal capability hook

import { useCallback, useSyncExternalStore } from "react";

import {
  getTerminalContextComposerTarget,
  subscribeTerminalContextComposerTarget,
  type TerminalContextComposerTarget,
} from "~/lib/terminalContextComposerRegistry";

export function useTerminalContextComposerTarget(
  paneScopeId: string,
): TerminalContextComposerTarget | undefined {
  const subscribe = useCallback(
    (listener: () => void) => subscribeTerminalContextComposerTarget(paneScopeId, listener),
    [paneScopeId],
  );
  const getSnapshot = useCallback(
    () => getTerminalContextComposerTarget(paneScopeId),
    [paneScopeId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

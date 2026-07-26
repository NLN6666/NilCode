// FILE: PullRequestDockPane.tsx
// Purpose: Adapter from a right-dock "pullRequest" pane to the detail panel — the single place
//          that validates the pane's identity fields, builds the PullRequestDetailInput, and
//          keys the panel so switching pull requests remounts it. Shared by the chat thread
//          dock and the /pull-requests route dock so neither duplicates this mapping.
// Layer: Pull request presentation
// Exports: PullRequestDockPane

import type { RightDockPane } from "~/rightDockStore.logic";

import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import {
  pullRequestDetailInputFromPane,
  pullRequestDetailInputKey,
} from "./pullRequestDetail.logic";
import { PullRequestDetailPanel } from "./PullRequestDetailPanel";
import { useMessages } from "~/i18n/context";

export function PullRequestDockPane({
  pane,
  onClose,
  pollingEnabled = true,
}: {
  pane: RightDockPane;
  onClose?: (() => void) | undefined;
  pollingEnabled?: boolean;
}) {
  const copy = useMessages().pullRequests;
  const input = pullRequestDetailInputFromPane(pane);
  if (!input) {
    return <PanelStateMessage>{copy.selectOne}</PanelStateMessage>;
  }
  return (
    <PullRequestDetailPanel
      key={pullRequestDetailInputKey(input)}
      input={input}
      initialTab={pane.pullRequestInitialTab ?? "summary"}
      pollingEnabled={pollingEnabled}
      {...(onClose ? { onClose } : {})}
    />
  );
}

export default PullRequestDockPane;

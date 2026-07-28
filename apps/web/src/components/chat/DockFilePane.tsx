// FILE: DockFilePane.tsx
// Purpose: Right-dock pane that previews one workspace file through the shared
//          WorkspaceFilePreview. Markdown opens already parsed (rendered); the
//          shared header carries the source toggle and open-in-editor controls.
// Layer: Chat right-dock UI
// Exports: DockFilePane

import type { ChatFileReference } from "~/lib/chatReferences";
import type { FileCommentSelection } from "~/lib/fileComments";
import { WorkspaceFilePreview } from "../WorkspaceFilePreview";
import { PanelStateMessage } from "./PanelStateMessage";
import { useMessages } from "~/i18n/context";

export function DockFilePane(props: {
  workspaceRoot: string | null;
  filePath: string | null;
  onReferenceInChat?: ((reference: ChatFileReference) => void) | undefined;
  onAskWhyInChat?: ((reference: ChatFileReference) => void) | undefined;
  onCommentInChat?: ((comment: FileCommentSelection) => void) | undefined;
}) {
  const copy = useMessages().chat.panes;
  return (
    <WorkspaceFilePreview
      workspaceRoot={props.workspaceRoot}
      filePath={props.filePath}
      markdownPreviewDefault
      emptyState={
        <PanelStateMessage density="compact" fill="flex">
          <p>{copy.clickFileToPreview}</p>
        </PanelStateMessage>
      }
      onReferenceInChat={props.onReferenceInChat}
      onAskWhyInChat={props.onAskWhyInChat}
      onCommentInChat={props.onCommentInChat}
    />
  );
}

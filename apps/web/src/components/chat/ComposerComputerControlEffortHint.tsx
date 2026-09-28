// FILE: ComposerComputerControlEffortHint.tsx
// Purpose: One-line strip above the composer suggesting Medium effort while a chat
// drives the desktop, with one-click apply and a permanent dismiss. Mounts and
// unmounts like its sibling stacked panels (live changes, goal) rather than
// animating, so the rail never reserves space for a hint that is not showing.
// Layer: Chat composer UI
// Exports: ComposerComputerControlEffortHint

import { MonitorIcon, XIcon } from "~/lib/icons";
import { IconButton } from "../ui/icon-button";
import { useMessages } from "~/i18n/context";
import { COMPOSER_INLINE_ACTION_PILL_CLASS_NAME } from "./composerPickerStyles";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  ComposerStackedPanelRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import { COMPOSER_STACKED_PANEL_ICON_CLASS_NAME } from "./composerStackedPanelStyles";

interface ComposerComputerControlEffortHintProps {
  onApply: () => void;
  onDismiss: () => void;
  attachedToPrevious?: boolean;
}

export function ComposerComputerControlEffortHint({
  onApply,
  onDismiss,
  attachedToPrevious: attachedToPreviousProp,
}: ComposerComputerControlEffortHintProps) {
  const copy = useMessages().composer.computerControlEffortHint;
  const attachedToPrevious = attachedToPreviousProp ?? false;
  return (
    <ComposerStackedPanel
      attachedToPrevious={attachedToPrevious}
      data-testid="composer-computer-control-effort-hint"
    >
      <ComposerStackedPanelRow>
        <ComposerStackedPanelRowMain>
          <MonitorIcon aria-hidden="true" className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
          <ComposerStackedPanelRowLabel>
            {copy.message}
          </ComposerStackedPanelRowLabel>
        </ComposerStackedPanelRowMain>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={COMPOSER_INLINE_ACTION_PILL_CLASS_NAME}
            onClick={onApply}
          >
            {copy.apply}
          </button>
          <IconButton variant="ghost" size="icon-chip" label={copy.dismiss} onClick={onDismiss}>
            <XIcon />
          </IconButton>
        </div>
      </ComposerStackedPanelRow>
    </ComposerStackedPanel>
  );
}

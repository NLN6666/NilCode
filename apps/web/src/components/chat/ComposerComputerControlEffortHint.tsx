// FILE: ComposerComputerControlEffortHint.tsx
// Purpose: Composer tip suggesting Medium effort while a chat drives the desktop, with
// one-click apply and a permanent dismiss.
// Layer: Chat composer UI
// Exports: ComposerComputerControlEffortHint

import { MonitorIcon } from "~/lib/icons";
import { useMessages } from "~/i18n/context";
import { COMPOSER_STACKED_PANEL_ICON_CLASS_NAME } from "./composerStackedPanelStyles";
import { ComposerTipRow } from "./ComposerTipRow";

interface ComposerComputerControlEffortHintProps {
  onApply: () => void;
  onDismiss: () => void;
}

export function ComposerComputerControlEffortHint({
  onApply,
  onDismiss,
}: ComposerComputerControlEffortHintProps) {
  const copy = useMessages().composer.computerControlEffortHint;
  return (
    <ComposerTipRow
      icon={<MonitorIcon aria-hidden="true" className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />}
      message={copy.message}
      actionLabel={copy.apply}
      onAction={onApply}
      onDismiss={onDismiss}
      testId="composer-computer-control-effort-hint"
    />
  );
}

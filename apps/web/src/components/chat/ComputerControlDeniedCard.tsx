// FILE: ComputerControlDeniedCard.tsx
// Purpose: Transcript card shown when an agent's desktop tool call was rejected because
//          the chat has computer control switched off. Replaces the buried tool error
//          with a one-click way to switch control on and retry.
// Layer: Chat transcript UI

import { ComputerActionCard } from "./ComputerActionCard";
import { useMessages } from "~/i18n/context";

export function ComputerControlDeniedCard({
  computerControlEnabled,
  textFontSizePx,
  metaFontSizePx,
  onEnable,
}: {
  // Live composer state: once the user (or this card) switches control on, the
  // card flips to a confirmation instead of offering a dead button.
  readonly computerControlEnabled?: boolean;
  readonly textFontSizePx?: number;
  readonly metaFontSizePx?: number;
  readonly onEnable?: () => void;
}) {
  const copy = useMessages().chat.computerControl;
  const enabled = computerControlEnabled === true;
  return (
    <ComputerActionCard
      tone={enabled ? "success" : "warning"}
      title={enabled ? copy.enabledTitle : copy.disabledTitle}
      textFontSizePx={textFontSizePx}
      metaFontSizePx={metaFontSizePx}
      action={onEnable && !enabled ? { label: copy.enable, onClick: onEnable } : undefined}
    >
      <p>
        {enabled ? copy.enabledDescription : copy.disabledDescription}
      </p>
    </ComputerActionCard>
  );
}

// FILE: QueuedComposerActions.tsx
// Purpose: Inline action cluster (Steer / Delete / Menu) rendered on each queued
// composer row. Used in both the compact and expanded composer layouts so the
// action chrome stays in lockstep across surfaces.
// Layer: Chat composer UI primitive
// Exports: QueuedComposerActions

import { useMessages } from "~/i18n/context";
import { EllipsisIcon, SteerIcon, Trash2 } from "~/lib/icons";

import type { QueuedComposerTurn } from "../../composerDraftStore";

import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";

type QueuedComposerActionsProps = {
  queuedTurn: QueuedComposerTurn;
  onSteer: (queuedTurn: QueuedComposerTurn) => void;
  onRemove: (queuedTurnId: string) => void;
  onEdit: (queuedTurn: QueuedComposerTurn) => void;
  /** True when the live provider has no native steer, so sending discards the
   *  answer in flight. The label says so instead of promising Codex semantics. */
  interruptsLiveTurn: boolean;
};

function QueuedComposerActions({
  queuedTurn,
  onSteer,
  onRemove,
  onEdit,
  interruptsLiveTurn,
}: QueuedComposerActionsProps) {
  const copy = useMessages().composer.queued;
  return (
    <div className="flex shrink-0 items-center gap-0">
      <Button
        variant="subtle"
        size="chip"
        title={interruptsLiveTurn ? copy.steerInterruptHint : copy.steerHint}
        onClick={() => void onSteer(queuedTurn)}
      >
        <SteerIcon />
        <span>{interruptsLiveTurn ? copy.steerInterrupt : copy.steer}</span>
      </Button>
      <IconButton
        variant="ghost"
        size="icon-chip"
        label={copy.delete}
        onClick={() => onRemove(queuedTurn.id)}
      >
        <Trash2 />
      </IconButton>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-chip"
              aria-label={copy.menu}
              className="[&_svg]:mx-0"
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="end" side="top" sideOffset={6}>
          <MenuItem onClick={() => onEdit(queuedTurn)}>{copy.edit}</MenuItem>
          <MenuItem onClick={() => onRemove(queuedTurn.id)}>{copy.deletePrompt}</MenuItem>
        </ComposerPickerMenuPopup>
      </Menu>
    </div>
  );
}

export { QueuedComposerActions };

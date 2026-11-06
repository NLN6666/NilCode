// FILE: DraftAttachmentWarning.tsx
// Purpose: Single source of truth for the "this draft attachment may not survive a
//   reload" warning shared by image and file attachment chips — the amber glyph, its
//   accessible label, and the explanatory copy. Keeps the wording and affordance from
//   drifting between the two surfaces.
// Layer: Chat attachment presentation
// Exports: DraftAttachmentWarningIcon
//
// The wording itself lives in `composer.attachments.draftWarning*` so both chips read
// the same catalog entries instead of importing English constants from here.

import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { CircleAlertIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useTranslation } from "~/i18n";

// `inline` sits in a card's detail row; `badge` floats over an image thumbnail
// (opaque surface + shadow so it stays legible on any preview).
export type DraftAttachmentWarningVariant = "inline" | "badge";

type DraftAttachmentWarningIconProps = ComponentPropsWithoutRef<"span"> & {
  variant?: DraftAttachmentWarningVariant;
};

// forwardRef + prop spread so the badge can act as a Base UI tooltip trigger.
export const DraftAttachmentWarningIcon = forwardRef<
  HTMLSpanElement,
  DraftAttachmentWarningIconProps
>(function DraftAttachmentWarningIcon({ variant: variantProp, className, ...rest }, ref) {
  const { t } = useTranslation();
  const variant = variantProp ?? "inline";
  return (
    <span
      ref={ref}
      {...rest}
      role="img"
      aria-label={t("chat:attachment_draftWarningLabel")}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-amber-600",
        variant === "badge" ? "size-5 bg-[var(--composer-surface)] shadow-sm" : "size-4",
        className,
      )}
    >
      <CircleAlertIcon className="size-3" />
    </span>
  );
});

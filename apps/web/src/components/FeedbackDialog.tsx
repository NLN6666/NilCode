// FILE: FeedbackDialog.tsx
// Purpose: Collects categorized Synara feedback with privacy-safe diagnostics.
// Layer: Shared UI component
// Depends on: Feedback delivery logic and the shared dialog primitives.

import { useEffect, useRef, useState } from "react";
import {
  buildFeedbackSubmission,
  FEEDBACK_CATEGORIES,
  submitFeedback,
  type FeedbackCategory,
  type FeedbackThreadContext,
} from "../feedback";
import { Button } from "./ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";
import { toastManager } from "./ui/toast";
import { useMessages } from "~/i18n/context";
import { dialogs as defaultDialogCopy } from "~/i18n/locales/en/dialogs";

export interface FeedbackDialogProps {
  open: boolean;
  context: FeedbackThreadContext;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({ open, context, onOpenChange }: FeedbackDialogProps) {
  const copy = useMessages().dialogs.feedback;
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (category: FeedbackCategory | null, details: string) => {
    setIsSending(true);
    try {
      await submitFeedback(buildFeedbackSubmission({ category, details, context }));
      setIsSending(false);
      onOpenChange(false);
      toastManager.add({
        type: "success",
        title: defaultDialogCopy.feedback.sent,
        description: defaultDialogCopy.feedback.sentHint,
      });
    } catch (error) {
      setIsSending(false);
      toastManager.add({
        type: "error",
        title: defaultDialogCopy.feedback.failed,
        description: error instanceof Error ? error.message : defaultDialogCopy.feedback.failedHint,
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSending) onOpenChange(nextOpen);
      }}
    >
      <DialogPopup className="max-w-xl" showCloseButton={!isSending}>
        <DialogHeader className="gap-0 px-5 pt-5 pb-3">
          <DialogTitle className="text-xl tracking-[-0.01em]">{copy.title}</DialogTitle>
        </DialogHeader>
        {/* The form state lives below DialogPopup, which unmounts its children
            once the close transition ends — every open starts from a blank
            form without a reset effect, and closing never flashes empty. */}
        <FeedbackDialogForm isSending={isSending} onSubmit={handleSubmit} />
      </DialogPopup>
    </Dialog>
  );
}

function FeedbackDialogForm({
  isSending,
  onSubmit,
}: {
  isSending: boolean;
  onSubmit: (category: FeedbackCategory | null, details: string) => Promise<void>;
}) {
  const formCopy = useMessages().dialogs.feedback;
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [details, setDetails] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const canSubmit = details.trim().length > 0 && !isSending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit(category, details);
  };

  return (
    <form
      className="flex min-h-0 flex-col gap-3 px-5 pb-5"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <div className="flex flex-wrap gap-1.5" aria-label={formCopy.category}>
        {FEEDBACK_CATEGORIES.map((option) => {
          const selected = category === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              variant={selected ? "secondary" : "outline"}
              size="sm"
              aria-pressed={selected}
              // Reference pills breathe at ~14px per side; the default `sm`
              // padding (10px) crams the label against the pill wall.
              className="rounded-full px-3.5 font-normal"
              disabled={isSending}
              // Keeps the caret (and the field's focus ring) in the details
              // textarea, so picking a category never interrupts typing.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setCategory(selected ? null : option.value)}
            >
              <span aria-hidden="true">{selected ? "−" : "+"}</span>
              {option.label}
            </Button>
          );
        })}
      </div>

      <Textarea
        ref={textareaRef}
        value={details}
        maxLength={5_000}
        placeholder={formCopy.detailsPlaceholder}
        aria-label={formCopy.detailsLabel}
        disabled={isSending}
        className="[&_[data-slot=textarea]]:min-h-32 [&_[data-slot=textarea]]:resize-y"
        onChange={(event) => setDetails(event.target.value)}
      />

      <p className="text-xs leading-relaxed text-muted-foreground">{formCopy.diagnosticsHint}</p>

      <Button type="submit" className="w-full" disabled={!canSubmit}>
        {isSending ? (
          <>
            <Spinner />
            {formCopy.sending}
          </>
        ) : (
          formCopy.submit
        )}
      </Button>
    </form>
  );
}

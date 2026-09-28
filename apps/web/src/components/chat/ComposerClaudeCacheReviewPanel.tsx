import type { PendingClaudeCacheReview } from "@synara/contracts";
import { useRef, useState } from "react";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { ComposerChoiceRow } from "./ComposerChoiceRow";
import { COMPOSER_INPUT_SURFACE_CLASS_NAME } from "./composerPickerStyles";
import { useMessages } from "~/i18n/context";

export type ClaudeCacheReviewDecision = "continue" | "compact" | "cancel";

// An accepted choice is already visible in the transcript (compaction progress
// or the resumed turn), so the panel only returns if the review fails.
export function isClaudeCacheReviewPanelVisible(review: PendingClaudeCacheReview): boolean {
  return review.status !== "responding" && review.status !== "compacting";
}

export function ComposerClaudeCacheReviewPanel({
  review,
  compactDisabledReason,
  isCompactionRequest = false,
  onRespond,
}: {
  review: PendingClaudeCacheReview;
  compactDisabledReason: string | null;
  isCompactionRequest?: boolean;
  onRespond: (
    review: PendingClaudeCacheReview,
    decision: ClaudeCacheReviewDecision,
  ) => Promise<void>;
}) {
  const copy = useMessages().composer.claudeCacheReview;
  const submittedReviewRef = useRef<PendingClaudeCacheReview | null>(null);
  const [submittedReview, setSubmittedReview] = useState<PendingClaudeCacheReview | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const actionable = review.status === "pending" || review.status === "failed";
  const disabled = !actionable || submittedReview === review;
  const contextTokens = review.assessment.contextTokens;
  const title =
    review.status === "uncertain"
      ? copy.uncertainTitle
      : isCompactionRequest
        ? copy.compactTitle
        : copy.expiredTitle;

  const respondOnce = (decision: ClaudeCacheReviewDecision) => {
    if (disabled || submittedReviewRef.current === review) return;
    if (decision === "compact" && (compactDisabledReason !== null || isCompactionRequest)) return;
    submittedReviewRef.current = review;
    setSubmittedReview(review);
    setDispatchError(null);
    void onRespond(review, decision).catch((error: unknown) => {
      if (submittedReviewRef.current !== review) return;
      submittedReviewRef.current = null;
      setSubmittedReview(null);
      setDispatchError(
        error instanceof Error ? error.message : copy.submitFailed,
      );
    });
  };

  if (!isClaudeCacheReviewPanelVisible(review)) return null;

  return (
    <section
      aria-label={copy.ariaLabel}
      aria-busy={submittedReview === review}
      className={cn(COMPOSER_INPUT_SURFACE_CLASS_NAME, "overflow-hidden px-3.5 py-3")}
    >
      <p className="text-ui-lg font-medium leading-snug text-foreground/90">{title}</p>
      <p className="mt-1.5 text-ui leading-relaxed text-muted-foreground">
        {review.status === "uncertain"
          ? copy.uncertainDescription
          : copy.heldMessage(
              contextTokens === undefined
                ? copy.contextUnknown
                : copy.contextTokens(formatContextWindowTokens(contextTokens)),
            )}
      </p>
      {actionable ? (
        <p className="mt-1.5 text-ui leading-relaxed text-muted-foreground">
          {copy.compactDescription}
        </p>
      ) : null}
      {review.error || dispatchError ? (
        <p role="alert" className="mt-2 text-ui leading-relaxed text-destructive">
          {dispatchError ?? review.error}
        </p>
      ) : null}
      <div className="mt-2.5 space-y-0.5">
        <ComposerChoiceRow
          shortcut={null}
          label={isCompactionRequest ? copy.compactExistingLabel : copy.continueLabel}
          description={
            isCompactionRequest
              ? copy.compactExistingDescription
              : copy.continueDescription
          }
          disabled={disabled}
          onSelect={() => respondOnce("continue")}
        />
        {!isCompactionRequest ? (
          <ComposerChoiceRow
            shortcut={null}
            label={copy.compactThenSendLabel}
            description={
              compactDisabledReason ??
              copy.compactThenSendDescription
            }
            disabled={disabled || compactDisabledReason !== null}
            onSelect={() => respondOnce("compact")}
          />
        ) : null}
        <ComposerChoiceRow
          shortcut={null}
          label={copy.cancelLabel}
          description={copy.cancelDescription}
          disabled={disabled}
          onSelect={() => respondOnce("cancel")}
        />
      </div>
    </section>
  );
}

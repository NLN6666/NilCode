import {
  type ContextWindowSnapshot,
  deriveContextWindowMeterDisplay,
  formatContextWindowTokens,
  formatCostUsd,
} from "~/lib/contextWindow";
import { useMessages } from "~/i18n/context";
import { useState } from "react";
import { useNowMs } from "~/hooks/useNowMs";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ClaudeCacheDetails } from "./ClaudeCacheDetails";
import { Button } from "../ui/button";

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  cumulativeCostUsd?: number | null | undefined;
  activeWindowLabel?: string | null | undefined;
  pendingWindowLabel?: string | null | undefined;
  showClaudeCache?: boolean;
  onOpenChange?: (open: boolean) => void;
  compactAction?: {
    disabledReason: string | null;
    isSubmitting: boolean;
    onCompact: () => Promise<boolean>;
  };
}) {
  const m = useMessages();
  const { usage, cumulativeCostUsd, activeWindowLabel, pendingWindowLabel } = props;
  const [open, setOpen] = useState(false);
  const nowMs = useNowMs(open && usage.claudeCache != null, 10_000);
  const display = deriveContextWindowMeterDisplay(usage);
  const modelWindowTokens = usage.contextWindowTokens ?? null;
  // Only worth its own line when the session gets less than the model holds;
  // an equal pair would just repeat the row above it.
  const showsCompactionBudget =
    typeof modelWindowTokens === "number" &&
    typeof usage.maxTokens === "number" &&
    usage.maxTokens < modelWindowTokens;
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (display.normalizedPercentage / 100) * circumference;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        props.onOpenChange?.(nextOpen);
      }}
    >
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="group inline-flex shrink-0 items-center justify-center rounded-full p-0.5 transition-opacity hover:opacity-80"
            aria-label={display.ariaLabel}
          >
            <span className="relative flex h-4 w-4 items-center justify-center">
              <svg
                viewBox="0 0 16 16"
                className="-rotate-90 absolute inset-0 h-full w-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="8"
                  cy="8"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-muted-foreground/25 dark:text-muted-foreground/40"
                />
                <circle
                  cx="8"
                  cy="8"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="text-primary transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none dark:text-[var(--color-text-foreground)]"
                />
              </svg>
            </span>
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
        <div className="space-y-1.5 leading-tight">
          <div className="text-[11px] font-medium text-muted-foreground">
            {m.chat.contextWindow.title}
          </div>
          {pendingWindowLabel ? (
            <div className="text-xs text-muted-foreground">
              {m.chat.contextWindow.currentSession(
                activeWindowLabel ?? m.chat.contextWindow.unknown,
              )}
            </div>
          ) : null}
          {display.usedPercentageLabel ? (
            <div className="whitespace-nowrap text-ui leading-snug font-medium text-foreground">
              <span>{display.usedPercentageLabel}</span>
              {display.hasReliableTokenRatio ? (
                <>
                  <span className="mx-1">⋅</span>
                  <span>{display.tokenUsageLabel}</span>
                  <span>/</span>
                  <span>
                    {formatContextWindowTokens(usage.maxTokens)} {m.chat.contextWindow.contextUsed}
                  </span>
                </>
              ) : (
                <span className="ml-1">{m.chat.contextWindow.contextUsed}</span>
              )}
            </div>
          ) : (
            <div className="text-sm text-foreground">
              {display.tokenUsageLabel} {m.chat.contextWindow.tokensUsedSoFar}
            </div>
          )}
          {/*
            `maxTokens` is the budget the bar fills toward, which providers may
            set below the model's capacity (Claude compacts at 200k by default,
            even on a 1M model). Name the model window only when the runtime
            reported it; where it did not, `maxTokens` *is* the model window —
            Codex reads its own `model_context_window` straight from the
            app-server — so the original line stays correct for those providers.
          */}
          {modelWindowTokens !== null ? (
            <div className="text-xs text-muted-foreground">
              {m.chat.contextWindow.modelWindow(formatContextWindowTokens(modelWindowTokens))}
            </div>
          ) : usage.maxTokens !== null ? (
            <div className="text-xs text-muted-foreground">
              {m.chat.contextWindow.modelWindow(formatContextWindowTokens(usage.maxTokens))}
            </div>
          ) : null}
          {showsCompactionBudget ? (
            <div className="text-xs text-muted-foreground">
              {m.chat.contextWindow.compactsAt(formatContextWindowTokens(usage.maxTokens))}
            </div>
          ) : null}
          {pendingWindowLabel ? (
            <div className="text-xs text-muted-foreground">
              {m.chat.contextWindow.nextTurn(pendingWindowLabel)}
            </div>
          ) : null}
          {(usage.totalProcessedTokens ?? null) !== null &&
          (usage.totalProcessedTokens ?? 0) > usage.usedTokens ? (
            <div className="text-xs text-muted-foreground">
              {m.chat.contextWindow.totalProcessed(
                formatContextWindowTokens(usage.totalProcessedTokens ?? null),
              )}
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="text-xs text-muted-foreground">{m.chat.contextWindow.autoCompacts}</div>
          ) : null}
          {cumulativeCostUsd !== null && cumulativeCostUsd !== undefined ? (
            <div className="text-xs text-muted-foreground">
              {m.chat.contextWindow.sessionCost(formatCostUsd(cumulativeCostUsd))}
            </div>
          ) : null}
          {usage.claudeCache || props.showClaudeCache ? (
            <ClaudeCacheDetails observation={usage.claudeCache ?? undefined} nowMs={nowMs} />
          ) : null}
          {props.compactAction ? (
            <div className="max-w-72 space-y-1.5 border-t border-border/50 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  props.compactAction.disabledReason !== null || props.compactAction.isSubmitting
                }
                onClick={() => {
                  void props.compactAction?.onCompact();
                }}
              >
                {props.compactAction.isSubmitting
                  ? m.chat.contextWindow.compactStarting
                  : m.chat.contextWindow.compactNow}
              </Button>
              <p className="text-ui leading-relaxed text-muted-foreground">
                {props.compactAction.disabledReason ??
                  m.chat.contextWindow.compactCaveat}
              </p>
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

import type { ResolvedThreadWorkspaceState } from "@synara/shared/threadEnvironment";
import type { ProviderInteractionMode } from "@synara/contracts";
import type { DraftThreadEnvMode } from "../../composerDraftStore";
import {
  type ContextWindowSnapshot,
  formatContextWindowTokens,
  formatCostUsd,
} from "../../lib/contextWindow";
import type { RateLimitStatus } from "./RateLimitBanner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { useMessages } from "~/i18n/context";

function formatRateLimitMessage(rateLimitStatus: RateLimitStatus): string {
  const resetSuffix = rateLimitStatus.resetsAt
    ? ` Resets at ${new Date(rateLimitStatus.resetsAt).toLocaleTimeString()}.`
    : "";
  if (rateLimitStatus.status === "rejected") {
    return `Rate limit reached.${resetSuffix}`;
  }
  const utilizationSuffix =
    typeof rateLimitStatus.utilization === "number"
      ? ` (${Math.round(rateLimitStatus.utilization * 100)}% used)`
      : "";
  return `Approaching rate limit${utilizationSuffix}.${resetSuffix}`;
}

function formatEnvironmentLabel(
  envMode: DraftThreadEnvMode,
  envState: ResolvedThreadWorkspaceState,
): string {
  if (envMode === "local") {
    return "Local";
  }
  return envState === "worktree-pending" ? "New worktree (pending)" : "Worktree";
}

export function ComposerSlashStatusDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModel: string | null | undefined;
  fastModeEnabled: boolean;
  selectedPromptEffort: string | null;
  interactionMode: ProviderInteractionMode;
  envMode: DraftThreadEnvMode;
  envState: ResolvedThreadWorkspaceState;
  branch: string | null;
  contextWindow: ContextWindowSnapshot | null;
  cumulativeCostUsd: number | null;
  rateLimitStatus: RateLimitStatus | null;
  activeContextWindowLabel?: string | null;
  pendingContextWindowLabel?: string | null;
}) {
  const copy = useMessages().composer.status;
  const {
    open,
    onOpenChange,
    selectedModel,
    fastModeEnabled,
    selectedPromptEffort,
    interactionMode,
    envMode,
    envState,
    branch,
    contextWindow,
    cumulativeCostUsd,
    rateLimitStatus,
    activeContextWindowLabel,
    pendingContextWindowLabel,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{copy.model}</p>
              <p className="font-medium text-foreground">{selectedModel}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{copy.fastMode}</p>
              <p className="font-medium text-foreground">{fastModeEnabled ? copy.on : copy.off}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{copy.reasoning}</p>
              <p className="font-medium text-foreground">
                {selectedPromptEffort ?? copy.defaultEffort}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{copy.mode}</p>
              <p className="font-medium text-foreground">
                {interactionMode === "plan" ? copy.planMode : copy.defaultMode}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{copy.environment}</p>
              <p className="font-medium text-foreground">
                {formatEnvironmentLabel(envMode, envState)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{copy.branch}</p>
              <p className="font-medium text-foreground">{branch ?? copy.unknown}</p>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{copy.contextWindow}</p>
                <p className="text-sm text-muted-foreground">{copy.contextWindowHint}</p>
                {pendingContextWindowLabel ? (
                  <p className="text-sm text-muted-foreground">
                    {copy.sessionWindows(
                      activeContextWindowLabel ?? copy.unknown,
                      pendingContextWindowLabel,
                    )}
                  </p>
                ) : null}
              </div>
              {contextWindow ? (
                <ContextWindowMeter
                  usage={contextWindow}
                  cumulativeCostUsd={cumulativeCostUsd}
                  activeWindowLabel={activeContextWindowLabel}
                  pendingWindowLabel={pendingContextWindowLabel}
                />
              ) : null}
            </div>
            {contextWindow ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">{copy.used}</p>
                  <p className="font-medium text-foreground">
                    {formatContextWindowTokens(contextWindow.usedTokens)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{copy.remaining}</p>
                  <p className="font-medium text-foreground">
                    {formatContextWindowTokens(contextWindow.remainingTokens)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{copy.window}</p>
                  <p className="font-medium text-foreground">
                    {formatContextWindowTokens(contextWindow.maxTokens)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{copy.cost}</p>
                  <p className="font-medium text-foreground">
                    {cumulativeCostUsd !== null
                      ? formatCostUsd(cumulativeCostUsd)
                      : copy.costUnavailable}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{copy.noContextUsage}</p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{copy.rateLimits}</p>
            {rateLimitStatus ? (
              <p className="text-sm text-foreground">{formatRateLimitMessage(rateLimitStatus)}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{copy.noRateLimitWarning}</p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {copy.close}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

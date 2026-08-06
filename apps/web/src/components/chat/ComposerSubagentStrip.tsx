// FILE: ComposerSubagentStrip.tsx
// Purpose: Compact subagent rows stacked above the composer input (status dot,
// nickname, role/model, live status); clicking a row docks that subagent's thread
// as a right-dock tab. Finished agents file themselves behind one collapsed
// "N done" line so a fan-out never buries the rows still worth watching.
// Wraps the shared stacked-header frame like the active task list.
// Layer: Chat composer UI
// Exports: ComposerSubagentStrip

import { useState } from "react";

import type { ThreadId } from "@synara/contracts";
import { pluralize } from "@synara/shared/text";

import {
  BackgroundTrayIcon,
  BackToParentIcon,
  BotIcon,
  LoaderIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  StopIcon,
} from "~/lib/icons";
import {
  settledSubagentStatusDotClassName,
  subagentStatusDotClassName,
  subagentStatusTextToneClassName,
} from "~/lib/subagentPresentation";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import type {
  ComposerSubagentStripItem,
  ComposerSubagentStripRow,
} from "./ComposerSubagentStrip.logic";
import { partitionComposerSubagentStripRows } from "./ComposerSubagentStrip.logic";
import {
  ComposerStackedPanelHeaderRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
} from "./composerStackedPanelStyles";
import { useMessages } from "~/i18n/context";

const STRIP_ROW_CLASS_NAME =
  "group -mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-[var(--color-background-button-secondary-hover)]";

interface ComposerSubagentStripProps {
  items: ReadonlyArray<ComposerSubagentStripRow>;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  /** Navigates the whole surface — used by the "back to parent" row. */
  onOpenThread: (threadId: ThreadId) => void;
  /** Docks a subagent transcript beside the parent; falls back to navigation. */
  onOpenSubagentThread?: (threadId: ThreadId) => void;
  onBackgroundItem?: (item: ComposerSubagentStripItem) => void;
  onStopItem?: (item: ComposerSubagentStripItem) => void;
  onStopAll?: () => void;
  attachedToPrevious?: boolean;
}

function SubagentStripRow({
  item,
  settled,
  onOpen,
  onBackgroundItem,
  onStopItem,
}: {
  item: ComposerSubagentStripItem;
  settled: boolean;
  onOpen: (threadId: ThreadId) => void;
  onBackgroundItem?: ((item: ComposerSubagentStripItem) => void) | undefined;
  onStopItem?: ((item: ComposerSubagentStripItem) => void) | undefined;
}) {
  const copy = useMessages().composer.subagents;
  return (
    <div
      data-testid="composer-subagent-row"
      data-viewed={item.isViewed || undefined}
      data-settled={settled || undefined}
      className={cn(
        STRIP_ROW_CLASS_NAME,
        item.isViewed && "bg-[var(--color-background-button-secondary)]",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={item.fullLabel}
        onClick={() => onOpen(item.threadId)}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            settled
              ? settledSubagentStatusDotClassName(item.statusKind)
              : subagentStatusDotClassName(item.statusKind),
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12px] font-medium",
            settled ? "text-muted-foreground/55" : "text-foreground/85",
          )}
        >
          <span>{item.primaryLabel}</span>
          {item.role ? (
            <span className="ml-1 text-[11px] font-normal text-muted-foreground/55">
              ({item.role})
            </span>
          ) : null}
          {item.modelLabel ? (
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground/45">
              {item.modelLabel}
            </span>
          ) : null}
          {item.isBackground ? (
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground/45">
              background
            </span>
          ) : null}
        </span>
        {item.statusLabel ? (
          <span
            className={cn(
              "shrink-0 text-[11px]",
              // A completed run inside the settled roster is already implied by the
              // group it sits in; failures keep their tone so they still stand out.
              settled && item.statusKind === "completed"
                ? "text-muted-foreground/40"
                : subagentStatusTextToneClassName(item.statusKind),
            )}
          >
            {item.statusLabel}
          </span>
        ) : null}
      </button>
      {item.isActive && !item.isBackground && onBackgroundItem ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
            COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
          )}
          onClick={() => onBackgroundItem(item)}
          aria-label={copy.runInBackground}
          title={copy.runInBackground}
        >
          <BackgroundTrayIcon className="size-3" />
        </Button>
      ) : null}
      {item.isActive && onStopItem ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
            COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
          )}
          onClick={() => onStopItem(item)}
          aria-label={copy.stop}
          title={copy.stop}
        >
          <StopIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

export const ComposerSubagentStrip = function ComposerSubagentStrip({
  items,
  compact,
  onCompactChange,
  onOpenThread,
  onOpenSubagentThread,
  onBackgroundItem,
  onStopItem,
  onStopAll,
  attachedToPrevious: attachedToPreviousProp,
}: ComposerSubagentStripProps) {
  const copy = useMessages().composer.subagents;
  const [settledExpanded, setSettledExpanded] = useState(false);
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const { parentRow, liveRows, settledRows } = partitionComposerSubagentStripRows(items);
  const subagentCount = liveRows.length + settledRows.length;
  const runningCount = liveRows.filter((item) => item.isActive).length;
  const openSubagentThread = onOpenSubagentThread ?? onOpenThread;
  const settledDisclosureLabel = settledExpanded ? copy.hideSettled : copy.showSettled;

  return (
    <ComposerStackedPanel
      passthroughSideMargins
      attachedToPrevious={attachedToPrevious}
      data-testid="composer-subagent-strip"
    >
      <ComposerStackedPanelHeaderRow>
        <ComposerStackedPanelRowMain>
          {compact && runningCount > 0 ? (
            <LoaderIcon className={cn(COMPOSER_STACKED_PANEL_ICON_CLASS_NAME, "animate-spin")} />
          ) : (
            <BotIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
          )}
          <ComposerStackedPanelRowLabel tone="meta">
            {runningCount > 0
              ? `${runningCount} of ${subagentCount} ${pluralize(subagentCount, "subagent")} running`
              : `${subagentCount} ${pluralize(subagentCount, "subagent")}`}
          </ComposerStackedPanelRowLabel>
        </ComposerStackedPanelRowMain>
        {onStopAll && runningCount > 1 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn("shrink-0", COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME)}
            onClick={onStopAll}
            aria-label={copy.stopAll}
            title={copy.stopAllTitle}
          >
            <StopIcon className="size-3" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn("shrink-0", COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME)}
          onClick={() => onCompactChange(!compact)}
          aria-label={compact ? copy.expandStrip : copy.collapseStrip}
          title={compact ? copy.expandStrip : copy.collapseStrip}
        >
          {compact ? (
            <PanelExpandIcon className="size-3" />
          ) : (
            <PanelCollapseIcon className="size-3" />
          )}
        </Button>
      </ComposerStackedPanelHeaderRow>

      <DisclosureRegion open={!compact}>
        <div
          className={cn(
            "space-y-0",
            COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
            COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
          )}
        >
          {parentRow ? (
            <div
              key={parentRow.key}
              data-testid="composer-subagent-parent-row"
              className={STRIP_ROW_CLASS_NAME}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={parentRow.label}
                onClick={() => onOpenThread(parentRow.threadId)}
              >
                <BackToParentIcon className="size-3 shrink-0 text-muted-foreground/55" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/85">
                  {parentRow.label}
                </span>
              </button>
            </div>
          ) : null}
          {liveRows.map((item) => (
            <SubagentStripRow
              key={item.key}
              item={item}
              settled={false}
              onOpen={openSubagentThread}
              onBackgroundItem={onBackgroundItem}
              onStopItem={onStopItem}
            />
          ))}
          {settledRows.length > 0 ? (
            <>
              <div className={STRIP_ROW_CLASS_NAME} data-testid="composer-subagent-settled-group">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={settledExpanded}
                  aria-label={settledDisclosureLabel}
                  title={settledDisclosureLabel}
                  onClick={() => setSettledExpanded((open) => !open)}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/25" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted-foreground/55">
                    {copy.settledGroup(settledRows.length)}
                  </span>
                  <DisclosureChevron
                    open={settledExpanded}
                    className="shrink-0 text-muted-foreground/38"
                  />
                </button>
              </div>
              <DisclosureRegion open={settledExpanded}>
                <div className="space-y-0 pl-3.5">
                  {settledRows.map((item) => (
                    <SubagentStripRow
                      key={item.key}
                      item={item}
                      settled
                      onOpen={openSubagentThread}
                      onBackgroundItem={onBackgroundItem}
                      onStopItem={onStopItem}
                    />
                  ))}
                </div>
              </DisclosureRegion>
            </>
          ) : null}
        </div>
      </DisclosureRegion>
    </ComposerStackedPanel>
  );
};

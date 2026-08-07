// FILE: SubagentDetailSections.tsx
// Purpose: Per-subagent metadata card, lazily loaded conversation preview, and the
//          jump-to-full-conversation affordance inside the agent activity detail view.
// Layer: Chat presentation component
// Depends on: workLog subagent records, subagentPresentation, thread detail retention

import { ThreadId } from "@synara/contracts";
import { useEffect, useState, type CSSProperties } from "react";

import { useMessages } from "~/i18n/context";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import {
  formatSubagentModelLabel,
  normalizeSubagentStatusKind,
  resolveSubagentPresentation,
  subagentStatusDotClassName,
  subagentStatusTextToneClassName,
} from "~/lib/subagentPresentation";
import { cn } from "~/lib/utils";
import type { WorkLogEntry, WorkLogSubagent } from "../../workLog";
import { useStore } from "../../store";
import { getThreadFromState } from "../../threadDerivation";
import { retainThreadDetailSubscription } from "../../threadDetailSubscriptionRetention";
import type { ChatMessage } from "../../types";

/** Enough to tell what the agent did without pulling a whole transcript into the DOM. */
const PREVIEW_MESSAGE_LIMIT = 6;
const PREVIEW_TEXT_LIMIT = 400;

const EMPTY_MESSAGES: ReadonlyArray<ChatMessage> = [];

/**
 * One row per distinct subagent across the detail's entries. Later entries win so a
 * finished agent shows its terminal status rather than the status it started with.
 */
export function collectDetailSubagents(
  entries: ReadonlyArray<WorkLogEntry>,
): ReadonlyArray<WorkLogSubagent> {
  const byKey = new Map<string, WorkLogSubagent>();
  for (const entry of entries) {
    for (const subagent of entry.subagents ?? []) {
      byKey.set(subagent.resolvedThreadId ?? subagent.threadId, subagent);
    }
  }
  return [...byKey.values()];
}

export function SubagentDetailSections(props: {
  subagents: ReadonlyArray<WorkLogSubagent>;
  chatTypographyStyle: CSSProperties;
  footerTextStyle: CSSProperties;
  onOpenThread?: ((threadId: ThreadId) => void) | undefined;
  /** Docks the subagent beside its parent; falls back to `onOpenThread` when absent. */
  onOpenSubagentThread?: ((threadId: ThreadId) => void) | undefined;
}) {
  if (props.subagents.length === 0) {
    return null;
  }

  return (
    <div className="divide-y divide-border/45">
      {props.subagents.map((subagent) => (
        <SubagentDetailCard
          key={subagent.resolvedThreadId ?? subagent.threadId}
          subagent={subagent}
          chatTypographyStyle={props.chatTypographyStyle}
          footerTextStyle={props.footerTextStyle}
          onOpenThread={props.onOpenThread}
          onOpenSubagentThread={props.onOpenSubagentThread}
        />
      ))}
    </div>
  );
}

function SubagentDetailCard(props: {
  subagent: WorkLogSubagent;
  chatTypographyStyle: CSSProperties;
  footerTextStyle: CSSProperties;
  onOpenThread?: ((threadId: ThreadId) => void) | undefined;
  onOpenSubagentThread?: ((threadId: ThreadId) => void) | undefined;
}) {
  const { subagent } = props;
  const copy = useMessages().chat.activity.subagent;
  const [conversationOpen, setConversationOpen] = useState(false);

  const presentation = resolveSubagentPresentation({
    nickname: subagent.nickname,
    role: subagent.role,
    title: subagent.title,
    fallbackId: subagent.resolvedThreadId ?? subagent.threadId,
  });
  const statusKind = normalizeSubagentStatusKind(subagent.rawStatus, subagent.isActive ?? false);
  const modelLabel = formatSubagentModelLabel(subagent.model);
  const resolvedThreadId = subagent.resolvedThreadId;
  // The dock is where every other entry point lands a subagent; plain navigation
  // is only the fallback for hosts that have no dock of their own.
  const openThread = props.onOpenSubagentThread ?? props.onOpenThread;
  const metaRows = [
    modelLabel ? { key: "model", label: copy.model, value: modelLabel } : null,
    presentation.role ? { key: "role", label: copy.role, value: presentation.role } : null,
    subagent.statusLabel
      ? { key: "status", label: copy.status, value: subagent.statusLabel }
      : null,
    subagent.effort ? { key: "effort", label: copy.effort, value: subagent.effort } : null,
    subagent.background === true
      ? { key: "background", label: copy.background, value: copy.backgroundOn }
      : null,
  ].filter((row): row is { key: string; label: string; value: string } => row !== null);

  return (
    <div className="py-3 first:pt-0 last:pb-0" data-testid="subagent-detail-card">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn("size-1.5 shrink-0 rounded-full", subagentStatusDotClassName(statusKind))}
        />
        <p
          className="min-w-0 flex-1 truncate font-medium text-foreground/78"
          style={props.chatTypographyStyle}
        >
          {presentation.primaryLabel}
        </p>
        {subagent.statusLabel ? (
          <span
            className={cn("shrink-0", subagentStatusTextToneClassName(statusKind))}
            style={props.footerTextStyle}
          >
            {subagent.statusLabel}
          </span>
        ) : null}
      </div>

      {metaRows.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[minmax(4rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
          {metaRows.map((row) => (
            <div key={row.key} className="contents">
              <dt className="truncate text-muted-foreground/48" style={props.footerTextStyle}>
                {row.label}
              </dt>
              <dd
                className="min-w-0 truncate text-muted-foreground/70"
                style={props.footerTextStyle}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {resolvedThreadId ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground/70 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
            style={props.footerTextStyle}
            aria-expanded={conversationOpen}
            onClick={() => setConversationOpen((open) => !open)}
          >
            <DisclosureChevron open={conversationOpen} className="size-3" />
            <span>{conversationOpen ? copy.hideConversation : copy.showConversation}</span>
          </button>
        ) : null}
        <button
          type="button"
          data-testid="subagent-open-full-conversation"
          className="inline-flex items-center rounded-md px-1.5 py-1 text-muted-foreground/70 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
          style={props.footerTextStyle}
          disabled={!resolvedThreadId || !openThread}
          title={resolvedThreadId ? undefined : copy.noThread}
          onClick={
            resolvedThreadId && openThread
              ? () => openThread(ThreadId.makeUnsafe(resolvedThreadId))
              : undefined
          }
        >
          {copy.openFullConversation}
        </button>
        {resolvedThreadId ? null : (
          <span className="text-muted-foreground/48" style={props.footerTextStyle}>
            {copy.noThread}
          </span>
        )}
      </div>

      {resolvedThreadId ? (
        <DisclosureRegion open={conversationOpen} className="mt-1">
          {/* Stays mounted so the shell can measure its height on the way closed;
              the subscription itself is what's gated on `open`. */}
          <SubagentConversationPreview
            open={conversationOpen}
            threadId={ThreadId.makeUnsafe(resolvedThreadId)}
            chatTypographyStyle={props.chatTypographyStyle}
            footerTextStyle={props.footerTextStyle}
          />
        </DisclosureRegion>
      ) : null}
    </div>
  );
}

function SubagentConversationPreview(props: {
  open: boolean;
  threadId: ThreadId;
  chatTypographyStyle: CSSProperties;
  footerTextStyle: CSSProperties;
}) {
  const { open, threadId } = props;
  const copy = useMessages().chat.activity.subagent;
  const messages = useStore(
    (state) => getThreadFromState(state, threadId)?.messages ?? EMPTY_MESSAGES,
  );

  // A fan-out can hold 5-10 children; retaining unconditionally would open a live
  // channel for every one of them the moment this detail view renders. Collapsing
  // releases, so repeated toggling never accumulates leases.
  useEffect(() => {
    if (!open) {
      return;
    }
    return retainThreadDetailSubscription(threadId);
  }, [open, threadId]);

  const previewMessages = messages.slice(-PREVIEW_MESSAGE_LIMIT);
  const hiddenCount = messages.length - previewMessages.length;

  if (previewMessages.length === 0) {
    return (
      <p className="py-2 text-muted-foreground/48" style={props.footerTextStyle}>
        {copy.noMessages}
      </p>
    );
  }

  return (
    <div className="space-y-2 py-2">
      {hiddenCount > 0 ? (
        <p className="text-muted-foreground/48" style={props.footerTextStyle}>
          {copy.earlierMessages(hiddenCount)}
        </p>
      ) : null}
      {previewMessages.map((message) => (
        <div key={message.id} className="min-w-0">
          <p className="text-muted-foreground/48" style={props.footerTextStyle}>
            {copy.roles[message.role]}
          </p>
          <p
            className="whitespace-pre-wrap break-words text-muted-foreground/70"
            style={props.chatTypographyStyle}
          >
            {truncatePreviewText(message.text)}
          </p>
        </div>
      ))}
    </div>
  );
}

function truncatePreviewText(text: string): string {
  const normalized = text.trim();
  return normalized.length > PREVIEW_TEXT_LIMIT
    ? `${normalized.slice(0, PREVIEW_TEXT_LIMIT)}…`
    : normalized;
}

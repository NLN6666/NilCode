// FILE: AgentActivityDetailView.tsx
// Purpose: Full-width transcript replacement for inspecting agent activity without opening side UI.
// Layer: Chat presentation component
// Depends on: agentActivity.logic and ChatMarkdown

import type { ThreadId } from "@synara/contracts";
import { pluralize } from "~/i18n/pluralize";
import { type CSSProperties, type ReactNode } from "react";
import { BotIcon, ChevronLeftIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { WorkLogEntry } from "../../session-logic";
import { formatShortTimestamp } from "../../timestampFormat";
import type { TimestampFormat } from "../../appSettings";
import ChatMarkdown from "../ChatMarkdown";
import { getChatMessageFooterTextStyle, getChatTranscriptTextStyle } from "./chatTypography";
import {
  CHAT_COLUMN_FRAME_CLASS_NAME,
  CHAT_COLUMN_GUTTER_CLASS_NAME,
  ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
} from "./composerPickerStyles";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import {
  type AgentActivityDetail,
  type AgentActivityEntryTitle,
  formatAgentActivityEntryPreview,
  formatAgentActivityEntryTitle,
  isReasoningUpdateWorkEntry,
} from "./agentActivity.logic";
import { collectDetailSubagents, SubagentDetailSections } from "./SubagentDetailSections";
import { useTranslation } from "~/i18n";

const ACTIVITY_TITLE_KEYS = {
  reasoning: "chat:sessionStatus_reasoning",
  agentTask: "chat:agentTask",
  activity: "workspace:profile_activity",
} as const satisfies Record<Exclude<AgentActivityEntryTitle["kind"], "text">, string>;

/** `agentActivity.logic` stays locale-free, so titles arrive as keys. */
function resolveActivityTitle(
  title: AgentActivityEntryTitle,
  translate: ReturnType<typeof useTranslation>["t"],
): string {
  return title.kind === "text" ? title.text : translate(ACTIVITY_TITLE_KEYS[title.kind]);
}

const DETAIL_BOTTOM_INSET_PX = 64;

interface AgentActivityDetailViewProps {
  detail: AgentActivityDetail;
  chatFontSizePx: number;
  contentInsetRightPx?: number | undefined;
  markdownCwd: string | undefined;
  onBack: () => void;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onOpenThread?: ((threadId: ThreadId) => void) | undefined;
  /** Subagent-specific opener: docks the child beside its parent instead of navigating. */
  onOpenSubagentThread?: ((threadId: ThreadId) => void) | undefined;
  timestampFormat: TimestampFormat;
}

export function AgentActivityDetailView({
  detail,
  chatFontSizePx,
  contentInsetRightPx,
  markdownCwd,
  onBack,
  onImageExpand,
  onOpenThread,
  onOpenSubagentThread,
  timestampFormat,
}: AgentActivityDetailViewProps) {
  const { t } = useTranslation();
  const chatTypographyStyle = getChatTranscriptTextStyle(chatFontSizePx);
  const footerTextStyle = getChatMessageFooterTextStyle(chatFontSizePx);
  const scrollStyle: CSSProperties = {
    ...(contentInsetRightPx ? { paddingRight: contentInsetRightPx } : {}),
    paddingBottom: DETAIL_BOTTOM_INSET_PX,
  };
  const prompt = findPrompt(detail.entries);
  const result = findResult(detail.entries);
  const subagents = collectDetailSubagents(detail.entries);

  return (
    <div
      data-agent-activity-detail="true"
      data-chat-scroll-container="true"
      className={cn(
        "h-full overflow-x-hidden overflow-y-auto overscroll-y-contain py-3 [scrollbar-gutter:stable] sm:py-4",
        ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
        CHAT_COLUMN_GUTTER_CLASS_NAME,
      )}
      style={scrollStyle}
    >
      <div className={cn(CHAT_COLUMN_FRAME_CLASS_NAME, "px-1")}>
        <button
          type="button"
          data-scroll-anchor-ignore
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground/70 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
          style={footerTextStyle}
          onClick={onBack}
        >
          <ChevronLeftIcon className="size-3.5" />
          <span>{t("common:app_back")}</span>
        </button>

        <div className="mt-3 border-b border-border/55 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-border/45 bg-background/65 text-muted-foreground/58">
              <BotIcon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="truncate text-ui-lg font-medium leading-6 text-foreground/92">
                  {resolveActivityTitle(detail.title, t)}
                </h2>
                <span className="rounded-full border border-border/45 px-2 py-0.5 text-ui-xs font-medium text-muted-foreground/56">
                  {t("chat:symbol7", {
                    value0: detail.entries.length,
                    value1: pluralize(detail.entries.length, "update"),
                  })}
                </span>
              </div>
              {detail.summary ? (
                <p className="mt-1 max-w-4xl text-muted-foreground/58" style={chatTypographyStyle}>
                  {detail.summary}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {subagents.length > 0 ? (
          <AgentActivitySection title={t("chat:subagent")}>
            <SubagentDetailSections
              subagents={subagents}
              chatTypographyStyle={chatTypographyStyle}
              footerTextStyle={footerTextStyle}
              onOpenThread={onOpenThread}
              onOpenSubagentThread={onOpenSubagentThread}
            />
          </AgentActivitySection>
        ) : null}

        {prompt ? (
          <AgentActivitySection title={t("chat:agentActivity_promptSection")}>
            <ChatMarkdown
              text={prompt}
              cwd={markdownCwd}
              isStreaming={false}
              style={chatTypographyStyle}
              onImageExpand={onImageExpand}
            />
          </AgentActivitySection>
        ) : null}

        {result ? (
          <AgentActivitySection title={t("chat:agentActivity_resultSection")}>
            <ChatMarkdown
              text={result}
              cwd={markdownCwd}
              isStreaming={false}
              style={chatTypographyStyle}
              onImageExpand={onImageExpand}
            />
          </AgentActivitySection>
        ) : null}

        <AgentActivitySection title={t("workspace:profile_activity")}>
          <div className="divide-y divide-border/45">
            {detail.entries.map((entry) => (
              <AgentActivityEventRow
                key={entry.id}
                entry={entry}
                markdownCwd={markdownCwd}
                chatTypographyStyle={chatTypographyStyle}
                footerTextStyle={footerTextStyle}
                onImageExpand={onImageExpand}
                timestampFormat={timestampFormat}
              />
            ))}
          </div>
        </AgentActivitySection>
      </div>
    </div>
  );
}

function AgentActivitySection(props: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border/45 py-4 last:border-b-0">
      <h3 className="mb-2 text-ui-sm font-medium text-muted-foreground/48">{props.title}</h3>
      {props.children}
    </section>
  );
}

function AgentActivityEventRow(props: {
  entry: WorkLogEntry;
  markdownCwd: string | undefined;
  chatTypographyStyle: CSSProperties;
  footerTextStyle: CSSProperties;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  timestampFormat: TimestampFormat;
}) {
  const { formatLocale, t } = useTranslation();
  const preview = formatAgentActivityEntryPreview(props.entry);
  const title = resolveActivityTitle(formatAgentActivityEntryTitle(props.entry), t);
  const body =
    isReasoningUpdateWorkEntry(props.entry) || props.entry.activityKind === "tool.summary"
      ? (props.entry.detail ?? preview)
      : (preview ?? props.entry.detail);

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p className="truncate font-medium text-foreground/78" style={props.chatTypographyStyle}>
          {title}
        </p>
        <p className="shrink-0 tabular-nums text-muted-foreground/38" style={props.footerTextStyle}>
          {formatShortTimestamp(props.entry.createdAt, props.timestampFormat, formatLocale)}
        </p>
      </div>
      {body ? (
        <div className="mt-1 text-muted-foreground/70">
          <ChatMarkdown
            text={body}
            cwd={props.markdownCwd}
            isStreaming={false}
            style={props.chatTypographyStyle}
            onImageExpand={props.onImageExpand}
          />
        </div>
      ) : null}
    </div>
  );
}

function findPrompt(entries: ReadonlyArray<WorkLogEntry>): string | null {
  for (const entry of entries) {
    const prompt = entry.subagentAction?.prompt;
    if (prompt) {
      return prompt;
    }
  }
  return null;
}

function findResult(entries: ReadonlyArray<WorkLogEntry>): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.itemType === "collab_agent_tool_call" && entry.detail) {
      return entry.detail;
    }
  }
  return null;
}

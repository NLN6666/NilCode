// FILE: FileCommentsSummaryChip.tsx
// Purpose: Renders the compact file-comment count chip used in composer and user bubbles.
// Layer: Chat attachment presentation

import { MessageCircleIcon } from "~/lib/icons";
import { useTranslation } from "~/i18n";
import { AttachmentSummaryChip } from "./AttachmentSummaryChip";

// Minimal shape shared by composer drafts (FileCommentDraft) and parsed bubble
// entries (ParsedFileCommentEntry) so one chip renders both without an id.
interface FileCommentChipEntry {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

interface FileCommentsSummaryChipProps {
  comments: ReadonlyArray<FileCommentChipEntry>;
  onRemove?: (() => void) | undefined;
}

// The tooltip heading pairs a verbatim file path with a localized line range.
// `serializeFileCommentLabel` is deliberately NOT used here — it is the wire format
// for the <file_comments> prompt block and must stay English.
//
// Path first, then the range: the path is what distinguishes one entry from the next
// when several are stacked, and a space separator keeps both "src/a.ts line 12" and
// "src/a.ts 第 12 行" readable without locale-specific punctuation.
function fileCommentHeading(
  comment: FileCommentChipEntry,
  translate: ReturnType<typeof useTranslation>["t"],
): string {
  const range =
    comment.startLine === comment.endLine
      ? translate("chat:fileLineComment_line", { value0: comment.startLine })
      : translate("chat:fileLineComment_lines", {
          value0: comment.startLine,
          value1: comment.endLine,
        });
  return `${comment.path} ${range}`;
}

export function FileCommentsSummaryChip(props: FileCommentsSummaryChipProps) {
  const { t } = useTranslation();
  if (props.comments.length === 0) {
    return null;
  }

  return (
    <AttachmentSummaryChip
      icon={MessageCircleIcon}
      label={t("chat:symbol7", {
        value0: props.comments.length,
        value1: t("common:countUnitComment", { count: props.comments.length }),
      })}
      removeLabel={t("chat:fileComments_remove")}
      onRemove={props.onRemove}
      tooltip={props.comments.map((comment, index) => (
        <div
          key={`${comment.path}:${comment.startLine}-${comment.endLine}:${index}`}
          className="space-y-0.5"
        >
          <p className="text-[0.6875rem] font-medium text-muted-foreground">
            {fileCommentHeading(comment, t)}
          </p>
          <p className="text-ui leading-relaxed">{comment.text}</p>
        </div>
      ))}
    />
  );
}

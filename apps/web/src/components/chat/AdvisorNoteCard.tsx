// FILE: AdvisorNoteCard.tsx
// Purpose: Renders one advisor note as its own transcript card.
// Layer: web chat feature (presentational).
//
// The note is deliberately not a user bubble and not a work-log row. It is a
// third voice in the conversation: something said *about* the work by a model
// that never touched it. A left rail coloured by severity is what separates it
// at a glance from the agent's own output, and the channel line is what keeps
// "the advisor said this" honest about whether the agent ever heard it.

import type { CSSProperties } from "react";

import { EyeIcon } from "~/lib/icons";
import type { WorkLogAdvisorNote } from "../../workLog";
import { useMessages } from "~/i18n/context";
import { cn } from "~/lib/utils";

// Severity is the whole point of the rail: a nit must not read as urgently as
// something that stopped the turn.
const RAIL_CLASS_BY_SEVERITY = {
  nit: "bg-border",
  concern: "bg-amber-500/70",
  blocker: "bg-destructive/70",
} as const;

const SEVERITY_TEXT_CLASS = {
  nit: "text-muted-foreground",
  concern: "text-amber-600 dark:text-amber-400",
  blocker: "text-destructive",
} as const;

export function AdvisorNoteCard({
  message,
  note,
  chatTypographyStyle,
}: {
  message: string;
  note: WorkLogAdvisorNote;
  chatTypographyStyle?: CSSProperties;
}) {
  const copy = useMessages().chat.advisor;

  return (
    <div className="flex min-w-0 gap-3">
      <div
        aria-hidden="true"
        className={cn("w-0.5 shrink-0 rounded-full", RAIL_CLASS_BY_SEVERITY[note.severity])}
      />
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tracking-[0.01em]">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground/80">
            <EyeIcon className="size-3 shrink-0" />
            <span className="font-medium uppercase">{copy.label}</span>
          </span>
          <span className={cn("font-medium", SEVERITY_TEXT_CLASS[note.severity])}>
            {copy.severity[note.severity]}
          </span>
          <span className="text-muted-foreground/60">{copy.channel[note.channel]}</span>
        </div>
        {/* Plain text, not markdown: the protocol caps a note at one or two
            sentences, and rendering it as markdown would let advisor output
            style the transcript. */}
        <p
          className="mt-1 whitespace-pre-wrap break-words text-foreground/90"
          style={chatTypographyStyle}
        >
          {message}
        </p>
      </div>
    </div>
  );
}

// FILE: AdvisorObservationRow.tsx
// Purpose: Renders one folded run of advisor observations — "it looked and said nothing".
// Layer: web chat feature (presentational).
//
// Silence is the advisor's designed answer: in a healthy session it is what almost
// every evaluation returns. That created a real failure mode — a working advisor and
// an advisor that never ran produce the identical empty transcript, so the feature
// was reported as broken while its logs showed 8 clean evaluations out of 8.
// See findings.md #18.
//
// This row exists to close that gap, which sets its whole design brief: it must be
// enough to prove the advisor is alive, and quiet enough that being present on most
// turns is not a cost. It is deliberately NOT an AdvisorNoteCard — there is no
// severity rail and no message, because nothing was said.

import { EyeIcon } from "~/lib/icons";
import { useMessages } from "~/i18n/context";
import type { WorkLogAdvisorObservation } from "../../workLog";

type ObservationReason = WorkLogAdvisorObservation["reason"];

// Strongest reason wins the label. A run that folded one withheld note among ten
// silences is a run where the advisor *did* speak and a rule ate it — reporting
// that as "reviewed 11 times" would hide the only interesting thing in the run.
const REASON_PRIORITY: readonly ObservationReason[] = ["quarantined", "withheld", "silent"];

function dominantReason(reasons: ReadonlyArray<ObservationReason>): ObservationReason {
  return REASON_PRIORITY.find((candidate) => reasons.includes(candidate)) ?? "silent";
}

export function AdvisorObservationRow({
  count,
  reasons,
}: {
  count: number;
  reasons: ReadonlyArray<WorkLogAdvisorObservation["reason"]>;
}) {
  const copy = useMessages().chat.advisor;
  const reason = dominantReason(reasons);

  // `count` only qualifies the plain-silence case. A withheld or quarantined run
  // already says the notable thing; appending "× 7" to it would bury the lede.
  const label =
    reason === "quarantined"
      ? copy.observation.quarantined
      : reason === "withheld"
        ? copy.observation.withheld
        : count > 1
          ? copy.observation.reviewedRepeated(count)
          : copy.observation.reviewed;

  // A muted single line, matching the transcript's other metadata rows rather than
  // AdvisorNoteCard's severity rail: real advice must stay visibly louder than the
  // note that no advice was given. EyeIcon is shared with AdvisorNoteCard so both
  // rows read as the same voice.
  //
  // This treatment is a judgement call and the easiest thing here to change — it is
  // on screen for almost every turn. The two dials worth reaching for: how loud the
  // ordinary-silence case should be, and whether `withheld`/`quarantined` deserve
  // more than the shared muted tone they currently get.
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/60">
      <EyeIcon className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

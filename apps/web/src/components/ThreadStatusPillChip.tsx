// FILE: ThreadStatusPillChip.tsx
// Purpose: Dot + label rendering of a thread status pill, shared by kanban
//          cards and the sidebar Activity rows so the two can never drift.
// Layer: UI component
// Exports: ThreadStatusPillChip

import { StatusChip } from "~/components/ui/status-chip";
import { useTranslation } from "~/i18n";
import { cn } from "~/lib/utils";
import type { ThreadStatusPill } from "./Sidebar.logic";

const STATUS_LABEL_KEYS: Readonly<Record<ThreadStatusPill["label"], string>> = {
  "Pending Approval": "workspace:pendingApproval",
  "Awaiting Input": "workspace:awaitingInput",
  Working: "workspace:status_working",
  Connecting: "chat:composer_connecting",
  "Preparing worktree": "workspace:composer_preparingWorktree",
  "In Background": "workspace:inBackground",
  "Plan Ready": "chat:planReady",
  Reminder: "workspace:reminder",
  Completed: "workspace:triageOutcome_completed",
};

export function ThreadStatusPillChip({
  pill,
  className,
}: {
  pill: ThreadStatusPill;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <StatusChip
      variant="inline"
      dotClassName={pill.dotClass}
      pulse={pill.pulse}
      className={cn(pill.colorClass, className)}
    >
      <span className="truncate">{t(STATUS_LABEL_KEYS[pill.label])}</span>
    </StatusChip>
  );
}

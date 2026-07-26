import {
  type AutomationCreateInput,
  type AutomationDefinition,
  type AutomationId,
  type AutomationListResult,
  type AutomationMemory,
  type AutomationMode,
  type AutomationNotificationPolicy,
  type AutomationRun,
  type AutomationRunResult,
  type AutomationStreamEvent,
  type AutomationUpdateInput,
  type AutomationWorktreeMode,
  type ModelSelection,
  type ProviderKind,
  type RuntimeMode,
  type ThreadId,
} from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAppSettings } from "~/appSettings";
import { useMessages } from "~/i18n/context";
import type { Messages } from "~/i18n/locales/en";
import type { Thread } from "~/types";
import {
  ComposerPickerMenuPopup,
  ComposerPickerMenuSubPopup,
} from "~/components/chat/ComposerPickerMenuPopup";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { TimePicker } from "~/components/ui/time-picker";
import { toastManager } from "~/components/ui/toast";
import {
  hasBlockingAutomationDraftWarnings,
  type AutomationDraftWarning,
  type AutomationDraftWarningId,
} from "~/lib/automationDraft";
import {
  acknowledgedRiskIdsForFormWarnings,
  applyScheduleToForm,
  automationFastIntervalLimitMessage,
  buildAutomationFormWarnings,
  createInputFromForm,
  datetimeLocalFromIso,
  defaultModelSelection,
  formatCadence,
  formatCadenceLong,
  formatClockTime,
  formatDateTime,
  formatNextRun,
  formatSchedule,
  formFromDefinition,
  groupHeartbeatAutomationsByTargetThread,
  heartbeatAutomationsForThread,
  isFormSubmittable,
  isoFromDatetimeLocal,
  modelSelectionForProjectChange,
  projectModelSelection,
  providerOptionsForAutomationEdit,
  providerOptionsForAutomationModelSelection,
  scheduleFromForm,
  scheduleFromKind,
  scheduleKindFromSchedule,
  SCHEDULE_KIND_OPTIONS,
  TIME_OF_DAY_PATTERN,
  updateInputFromForm,
  updateWeeklyScheduleDay,
  updateWeeklyScheduleTime,
  weekdayLabel,
  type AutomationFormState,
  type IntervalUnit,
  type ScheduleKind,
} from "~/lib/automationForm";
import { SkillCubeIcon, WorktreeIcon } from "~/lib/icons";
import { CentralIcon } from "~/lib/central-icons";
import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import { cn } from "~/lib/utils";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { buildModelSelection } from "~/providerModelOptions";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { useStore } from "~/store";
import { resolveThreadPickerTitle } from "./-chatThreadRoute.logic";

export const automationQueryKey = ["automations"] as const;
export const EMPTY_AUTOMATION_LIST: AutomationListResult = {
  definitions: [],
  runs: [],
  memories: [],
};

export {
  acknowledgedRiskIdsForFormWarnings,
  applyScheduleToForm,
  automationFastIntervalLimitMessage,
  buildAutomationFormWarnings,
  createInputFromForm,
  datetimeLocalFromIso,
  defaultModelSelection,
  formatCadence,
  formatCadenceLong,
  formatClockTime,
  formatDateTime,
  formatNextRun,
  formatSchedule,
  formFromDefinition,
  groupHeartbeatAutomationsByTargetThread,
  heartbeatAutomationsForThread,
  isFormSubmittable,
  isoFromDatetimeLocal,
  modelSelectionForProjectChange,
  projectModelSelection,
  providerOptionsForAutomationEdit,
  providerOptionsForAutomationModelSelection,
  scheduleFromForm,
  scheduleFromKind,
  scheduleKindFromSchedule,
  SCHEDULE_KIND_OPTIONS,
  TIME_OF_DAY_PATTERN,
  updateInputFromForm,
  updateWeeklyScheduleDay,
  updateWeeklyScheduleTime,
  weekdayLabel,
  type AutomationFormState,
  type IntervalUnit,
  type ScheduleKind,
};

/** The `automations` catalog group, threaded into the locale-free helpers below. */
export type AutomationsCopy = Messages["automations"];

export type AutomationTemplate = {
  readonly label: string;
  readonly name: string;
  readonly prompt: string;
};

/** Starter prompts surfaced behind the composer's "Use template" button. */
export function automationTemplates(copy: AutomationsCopy): readonly AutomationTemplate[] {
  return [
    copy.templates.triageCrashes,
    copy.templates.updateDependencies,
    copy.templates.dailySummary,
  ];
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function runStatusVariant(
  status: AutomationRun["status"],
): "success" | "warning" | "error" | "info" | "outline" {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
    case "cancelled":
    case "interrupted":
      return "error";
    case "waiting-for-approval":
    case "skipped":
      return "warning";
    case "running":
    case "claimed":
    case "pending":
      return "info";
  }
}

/** Status-colored dot/icon class for a single run, shared by the detail history and triage rows. */
export function runStatusDotClassName(status: AutomationRun["status"]): string {
  switch (runStatusVariant(status)) {
    case "success":
      return "text-emerald-500";
    case "error":
      return "text-destructive";
    case "warning":
      return "text-amber-500";
    case "info":
      return "text-blue-500";
    case "outline":
      return "text-muted-foreground/50";
  }
}

/**
 * True when a click/keydown originated from an interactive control nested inside a clickable
 * row (delete button, link, input, etc.) rather than the row surface itself. Row components use
 * it to let inner controls handle their own events without also triggering the row's action.
 */
export function isRowInteractiveEventTarget(
  target: EventTarget | null,
  currentTarget: HTMLElement,
): boolean {
  if (!(target instanceof HTMLElement) || target === currentTarget) {
    return false;
  }
  return Boolean(target.closest("button,a,input,textarea,select,[contenteditable='true']"));
}

/**
 * Leading status glyph for a single run row: a quiet check for success, otherwise a
 * status-colored dot. Shared by the detail history and the list triage rows so both
 * surfaces read identically.
 */
export function RunStatusIndicator({
  status,
  className,
}: {
  readonly status: AutomationRun["status"];
  readonly className?: string;
}) {
  if (runStatusVariant(status) === "success") {
    return (
      <CentralIcon
        name="circle-check"
        className={cn("size-3.5 shrink-0 text-muted-foreground/70", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center",
        runStatusDotClassName(status),
        className,
      )}
    >
      <span className="block size-1.5 rounded-full bg-current" />
    </span>
  );
}

export function isTriageRun(run: AutomationRun): boolean {
  if (run.status === "waiting-for-approval") {
    return true;
  }
  if (run.result) {
    return run.finishedAt !== null && isUnresolvedTriageResult(run.result);
  }
  return run.status === "failed" || run.status === "cancelled" || run.status === "interrupted";
}

export function isUnresolvedTriageResult(result: AutomationRunResult | null): boolean {
  return Boolean(result && result.unread && result.archivedAt === null);
}

export function unresolvedTriageRuns(runs: readonly AutomationRun[]): AutomationRun[] {
  return runs.filter((run) => isTriageRun(run));
}

export function allVisibleTriageRuns(runs: readonly AutomationRun[]): AutomationRun[] {
  return runs.filter((run) => {
    if (run.result) {
      return run.finishedAt !== null && run.result.archivedAt === null;
    }
    return isTriageRun(run);
  });
}

export function automationAttentionCount(runs: readonly AutomationRun[]): number {
  return unresolvedTriageRuns(runs).length;
}

export function runStatusLabel(
  status: AutomationRun["status"],
  copy: AutomationsCopy["runStatus"],
): string {
  return copy[status];
}

export function runResultSummary(run: AutomationRun, copy: AutomationsCopy): string {
  if (run.result?.summary) return run.result.summary;
  if (run.error) return run.error;
  switch (run.result?.outcome) {
    case "findings":
      return copy.runOutcome.findings;
    case "no-findings":
      return copy.runOutcome.noFindings;
    case "changed-files":
      return copy.runOutcome.changedFiles;
    case "needs-attention":
      return copy.runOutcome.needsAttention;
    case "unknown":
      return run.threadId ? copy.runOutcome.completedOpenThread : copy.runOutcome.completed;
    case undefined:
      return runStatusLabel(run.status, copy.runStatus);
  }
}

export function runResultTitle(run: AutomationRun): string | null {
  const title = run.result?.title?.trim();
  return title ? title : null;
}

export function canCancelAutomationRun(run: AutomationRun): boolean {
  return (
    run.status === "pending" ||
    run.status === "claimed" ||
    run.status === "running" ||
    run.status === "waiting-for-approval"
  );
}

/**
 * Plain-language warning for a latest run that needs the user's attention, or null when
 * the run ended normally (or is still progressing). Drives the amber glyph and the
 * subtitle warning segment on automation list rows.
 */
export function runNeedsAttention(run: AutomationRun): boolean {
  return (
    run.status === "waiting-for-approval" ||
    run.status === "failed" ||
    run.status === "cancelled" ||
    run.status === "interrupted"
  );
}

export function automationAttentionLabel(
  run: AutomationRun,
  copy: AutomationsCopy["attention"],
): string | null {
  switch (run.status) {
    case "waiting-for-approval":
      return copy.waitingForApproval;
    case "failed":
      return copy.failed;
    case "cancelled":
      return copy.cancelled;
    case "interrupted":
      return copy.interrupted;
    default:
      return null;
  }
}

type LiveAutomationRun = AutomationRun & {
  readonly status: "pending" | "claimed" | "running" | "waiting-for-approval";
};

export function isLiveRun(run: AutomationRun | null): run is LiveAutomationRun {
  return (
    run?.status === "pending" ||
    run?.status === "claimed" ||
    run?.status === "running" ||
    run?.status === "waiting-for-approval"
  );
}

/**
 * Icon + tint for an automation list row's leading status glyph.
 * - Live runs spin with a circular loading glyph.
 * - Completed successful runs show a checkmark circle.
 * - Failed/cancelled/interrupted runs keep the warning exclamation.
 * - Scheduled (enabled with a future next run) shows a clock.
 * - Paused automations show a pause glyph.
 */
export function automationListRowIcon(
  definition: AutomationDefinition,
  latestRun: AutomationRun | null,
): { readonly name: string; readonly className: string } {
  // Pausing prevents future dispatches but does not cancel an in-flight run, so the
  // active run state must take precedence over the definition's enabled flag.
  if (isLiveRun(latestRun)) {
    return {
      name: "loading-circle",
      className: "size-4 animate-spin text-blue-500 motion-reduce:animate-none",
    };
  }
  if (!definition.enabled) {
    return { name: "pause", className: "size-4 text-muted-foreground/40" };
  }
  if (latestRun?.status === "succeeded") {
    return { name: "circle-check", className: "size-4 text-green-500" };
  }
  if (latestRun && runNeedsAttention(latestRun)) {
    return { name: "exclamation-circle", className: "size-4 text-amber-500" };
  }
  if (definition.nextRunAt) {
    return { name: "clock", className: "size-4 text-foreground/70" };
  }
  return { name: "circle-placeholder-on", className: "size-4 text-foreground/70" };
}

/**
 * Tint for the list row's leading status glyph: dimmed when paused, blue while a run is
 * live, amber when the latest run needs attention, otherwise neutral.
 */
export function automationStatusDotClass(
  definition: AutomationDefinition,
  latestRun: AutomationRun | null,
): string {
  if (!definition.enabled) return "text-muted-foreground/40";
  if (
    latestRun?.status === "running" ||
    latestRun?.status === "pending" ||
    latestRun?.status === "claimed"
  ) {
    return "text-blue-500";
  }
  if (latestRun && runNeedsAttention(latestRun)) return "text-amber-500";
  return "text-foreground/70";
}

const deletedAutomationIdsInCache = new Set<string>();

function isNewerTimestamp(candidate: string, existing: string): boolean {
  return candidate.localeCompare(existing) > 0;
}

// Snapshots are reconciliation data, so equal timestamps keep the live cache winner.
function isSameOrNewerTimestamp(candidate: string, existing: string): boolean {
  return candidate.localeCompare(existing) >= 0;
}

function mergeDefinitionsByUpdatedAt(
  snapshotDefinitions: readonly AutomationDefinition[],
  previousDefinitions: readonly AutomationDefinition[],
): AutomationDefinition[] {
  const previousById = new Map(
    previousDefinitions.map((definition) => [definition.id, definition]),
  );
  const seen = new Set<string>();
  const definitions: AutomationDefinition[] = [];
  for (const snapshotDefinition of snapshotDefinitions) {
    if (deletedAutomationIdsInCache.has(snapshotDefinition.id)) {
      continue;
    }
    seen.add(snapshotDefinition.id);
    const previousDefinition = previousById.get(snapshotDefinition.id);
    definitions.push(
      previousDefinition &&
        isSameOrNewerTimestamp(previousDefinition.updatedAt, snapshotDefinition.updatedAt)
        ? previousDefinition
        : snapshotDefinition,
    );
  }
  return definitions;
}

function upsertDefinitionByUpdatedAt(
  definitions: readonly AutomationDefinition[],
  incoming: AutomationDefinition,
): AutomationDefinition[] {
  const existing = definitions.find((definition) => definition.id === incoming.id);
  if (existing && isNewerTimestamp(existing.updatedAt, incoming.updatedAt)) {
    return [...definitions];
  }
  return existing
    ? definitions.map((definition) => (definition.id === incoming.id ? incoming : definition))
    : [incoming, ...definitions];
}

function mergeRunsByUpdatedAt(
  snapshotRuns: readonly AutomationRun[],
  previousRuns: readonly AutomationRun[],
  visibleAutomationIds?: ReadonlySet<AutomationId>,
): AutomationRun[] {
  const previousById = new Map(previousRuns.map((run) => [run.id, run]));
  const runs: AutomationRun[] = [];
  for (const snapshotRun of snapshotRuns) {
    if (
      deletedAutomationIdsInCache.has(snapshotRun.automationId) ||
      (visibleAutomationIds && !visibleAutomationIds.has(snapshotRun.automationId))
    ) {
      continue;
    }
    const previousRun = previousById.get(snapshotRun.id);
    runs.push(
      previousRun && isSameOrNewerTimestamp(previousRun.updatedAt, snapshotRun.updatedAt)
        ? previousRun
        : snapshotRun,
    );
  }
  return runs;
}

function upsertRunByUpdatedAt(
  runs: readonly AutomationRun[],
  incoming: AutomationRun,
): AutomationRun[] {
  const existing = runs.find((run) => run.id === incoming.id);
  if (existing && isNewerTimestamp(existing.updatedAt, incoming.updatedAt)) {
    return [...runs];
  }
  return existing
    ? runs.map((run) => (run.id === incoming.id ? incoming : run))
    : [incoming, ...runs];
}

function mergeMemoriesByUpdatedAt(
  snapshotMemories: readonly AutomationMemory[],
  previousMemories: readonly AutomationMemory[],
  visibleAutomationIds: ReadonlySet<AutomationId>,
): AutomationMemory[] {
  const previousByAutomationId = new Map(
    previousMemories.map((memory) => [memory.automationId, memory]),
  );
  const seen = new Set<AutomationId>();
  const memories: AutomationMemory[] = [];
  for (const snapshotMemory of snapshotMemories) {
    if (!visibleAutomationIds.has(snapshotMemory.automationId)) {
      continue;
    }
    seen.add(snapshotMemory.automationId);
    const previousMemory = previousByAutomationId.get(snapshotMemory.automationId);
    memories.push(
      previousMemory && isSameOrNewerTimestamp(previousMemory.updatedAt, snapshotMemory.updatedAt)
        ? previousMemory
        : snapshotMemory,
    );
  }
  for (const previousMemory of previousMemories) {
    if (
      !seen.has(previousMemory.automationId) &&
      visibleAutomationIds.has(previousMemory.automationId)
    ) {
      memories.push(previousMemory);
    }
  }
  return memories;
}

function upsertMemoryByUpdatedAt(
  memories: readonly AutomationMemory[],
  incoming: AutomationMemory,
): AutomationMemory[] {
  const existing = memories.find((memory) => memory.automationId === incoming.automationId);
  if (existing && isNewerTimestamp(existing.updatedAt, incoming.updatedAt)) {
    return [...memories];
  }
  return existing
    ? memories.map((memory) => (memory.automationId === incoming.automationId ? incoming : memory))
    : [incoming, ...memories];
}

export function applyAutomationEvent(
  prev: AutomationListResult | undefined,
  event: AutomationStreamEvent,
): AutomationListResult {
  const base = prev ?? EMPTY_AUTOMATION_LIST;
  switch (event.type) {
    case "snapshot": {
      const definitions = mergeDefinitionsByUpdatedAt(event.definitions, base.definitions);
      const visibleAutomationIds = new Set(definitions.map((definition) => definition.id));
      return {
        definitions,
        runs: mergeRunsByUpdatedAt(event.runs, base.runs, visibleAutomationIds),
        memories: mergeMemoriesByUpdatedAt(
          event.memories ?? [],
          base.memories ?? [],
          visibleAutomationIds,
        ),
      };
    }
    case "definition-upserted": {
      if (deletedAutomationIdsInCache.has(event.definition.id)) {
        return base;
      }
      deletedAutomationIdsInCache.delete(event.definition.id);
      const definitions = upsertDefinitionByUpdatedAt(base.definitions, event.definition);
      return { definitions, runs: base.runs, memories: base.memories ?? [] };
    }
    case "definition-deleted":
      deletedAutomationIdsInCache.add(event.automationId);
      return {
        definitions: base.definitions.filter((definition) => definition.id !== event.automationId),
        runs: base.runs.filter((run) => run.automationId !== event.automationId),
        memories: (base.memories ?? []).filter(
          (memory) => memory.automationId !== event.automationId,
        ),
      };
    case "run-upserted": {
      if (deletedAutomationIdsInCache.has(event.run.automationId)) {
        return base;
      }
      const runs = upsertRunByUpdatedAt(base.runs, event.run);
      return { definitions: base.definitions, runs, memories: base.memories ?? [] };
    }
    case "memory-upserted": {
      const currentMemories = base.memories ?? [];
      const memories = upsertMemoryByUpdatedAt(currentMemories, event.memory);
      return { definitions: base.definitions, runs: base.runs, memories };
    }
  }
}

export function useAutomations(onRunStarted?: (threadId: ThreadId) => void) {
  const queryClient = useQueryClient();

  const automationsQuery = useQuery({
    queryKey: automationQueryKey,
    queryFn: () => ensureNativeApi().automation.list({}),
  });
  const data = automationsQuery.data ?? EMPTY_AUTOMATION_LIST;

  const createMutation = useMutation({
    mutationFn: (input: AutomationCreateInput) => ensureNativeApi().automation.create(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const updateMutation = useMutation({
    mutationFn: (input: AutomationUpdateInput) => ensureNativeApi().automation.update(input),
    // Optimistically merge the patch so inline edits on the detail page feel instant; the
    // server's authoritative definition (with recomputed nextRunAt) arrives via the stream.
    onMutate: (input) => {
      const previous = queryClient.getQueryData<AutomationListResult>(automationQueryKey);
      queryClient.setQueryData<AutomationListResult>(automationQueryKey, (prev) => {
        const base = prev ?? EMPTY_AUTOMATION_LIST;
        return {
          definitions: base.definitions.map((definition) =>
            definition.id === input.id
              ? ({ ...definition, ...input } as AutomationDefinition)
              : definition,
          ),
          runs: base.runs,
          memories: base.memories ?? [],
        };
      });
      return { previous };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error, _input, context) => {
      // A failed update would otherwise leave the incomplete optimistic merge in the cache
      // until the next stream tick; restore the pre-edit snapshot so the UI reflects reality.
      if (context?.previous) {
        queryClient.setQueryData<AutomationListResult>(automationQueryKey, context.previous);
      }
      toastManager.add({ type: "error", title: error.message });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (definition: AutomationDefinition) =>
      ensureNativeApi().automation.delete({ id: definition.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const runNowMutation = useMutation({
    mutationFn: (definition: AutomationDefinition) =>
      ensureNativeApi().automation.runNow({ automationId: definition.id }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: automationQueryKey });
      if (result.run.threadId) onRunStarted?.(result.run.threadId);
    },
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const cancelRunMutation = useMutation({
    mutationFn: (run: AutomationRun) => ensureNativeApi().automation.cancelRun({ runId: run.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const markRunReadMutation = useMutation({
    mutationFn: (input: { readonly run: AutomationRun; readonly unread: boolean }) =>
      ensureNativeApi().automation.markRunRead({ runId: input.run.id, unread: input.unread }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const archiveRunMutation = useMutation({
    mutationFn: (input: { readonly run: AutomationRun; readonly archived: boolean }) =>
      ensureNativeApi().automation.archiveRun({ runId: input.run.id, archived: input.archived }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });

  const runsByAutomationId = new Map<string, AutomationRun[]>();
  for (const run of data.runs) {
    const runs = runsByAutomationId.get(run.automationId) ?? [];
    runs.push(run);
    runsByAutomationId.set(run.automationId, runs);
  }
  for (const runs of runsByAutomationId.values()) {
    runs.sort((left, right) => right.scheduledFor.localeCompare(left.scheduledFor));
  }

  return {
    data,
    isLoading: automationsQuery.isLoading,
    refetch: automationsQuery.refetch,
    createMutation,
    updateMutation,
    deleteMutation,
    runNowMutation,
    cancelRunMutation,
    markRunReadMutation,
    archiveRunMutation,
    runsByAutomationId,
  };
}

/** Subtle labeled pill used in the automation composer toolbar. */
const CHIP_CLASS =
  "gap-1.5 rounded-lg px-2 font-normal text-[var(--color-text-foreground-secondary)]";
type CadenceOption = { readonly value: string; readonly label: string };
type IntervalCadenceOption = {
  readonly amount: string;
  readonly unit: IntervalUnit;
  readonly label: string;
};

/** Interval cadence presets shown by default; second-level intervals are preserved when present. */
function intervalPresets(copy: AutomationsCopy["interval"]): readonly IntervalCadenceOption[] {
  return (["15", "30", "120", "360", "720", "1440"] as const).map((amount) => ({
    amount,
    unit: "minutes" as const,
    label: copy.everyMinutes(amount),
  }));
}

function intervalOptionValue(option: Pick<IntervalCadenceOption, "amount" | "unit">): string {
  return `${option.unit}:${option.amount}`;
}

function intervalOptionLabel(
  amount: string,
  unit: IntervalUnit,
  copy: AutomationsCopy["interval"],
): string {
  return unit === "seconds" ? copy.everySeconds(amount) : copy.everyMinutes(amount);
}

/** Heartbeat run-count presets ("" = unlimited). */
function maxIterationPresets(
  copy: AutomationsCopy["maxIterationOption"],
): readonly CadenceOption[] {
  return [
    { value: "", label: copy.unlimited },
    ...["10", "25", "50", "100", "250"].map((value) => ({ value, label: copy.runs(value) })),
  ];
}

export function maxIterationOptions(
  currentValue: string | number | null | undefined,
  copy: AutomationsCopy["maxIterationOption"],
): readonly { readonly value: string; readonly label: string }[] {
  const presets = maxIterationPresets(copy);
  const value = currentValue == null ? "" : String(currentValue).trim();
  if (!/^\d+$/.test(value) || presets.some((preset) => preset.value === value)) {
    return presets;
  }
  return [{ value, label: copy.runs(value) }, ...presets];
}

// Shown at the top of an automation's detail panel when saving or manual run actions need
// one-time risk approval.
export function AutomationApprovalBanner({
  warnings,
  busy,
  onApprove,
  onApproveAndRun,
}: {
  readonly warnings: readonly AutomationDraftWarning[];
  readonly busy: boolean;
  readonly onApprove: () => void;
  readonly onApproveAndRun: () => void;
}) {
  const m = useMessages();
  if (warnings.length === 0) {
    return null;
  }
  return (
    <Alert variant="warning">
      <AlertTitle>{m.automations.approval.title}</AlertTitle>
      <AlertDescription>
        <span>{m.automations.approval.description}</span>
        <ul className="flex flex-col gap-1.5">
          {warnings.map((warning) => (
            <li key={warning.id} className="text-xs">
              <span className="font-medium text-foreground/90">{warning.title}</span>
              <span className="block">{warning.detail}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onApprove}>
            {m.automations.approval.approve}
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={onApproveAndRun}>
            {m.automations.approval.approveAndRun}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function AutomationModelPicker({
  value,
  projectCwd,
  onChange,
}: {
  readonly value: ModelSelection;
  readonly projectCwd: string | null;
  readonly onChange: (value: ModelSelection) => void;
}) {
  const { settings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerStatuses = useProviderStatusesForLocalConfig();
  const [open, setOpen] = useState(false);
  const modelHintByProvider: Partial<Record<ProviderKind, string | null>> = {
    [value.provider]: value.model,
  };
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: projectCwd,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  const { modelOptionsByProvider, loadingModelProviders } = useProviderModelCatalog({
    selectedProvider: value.provider,
    discoveryEnabled: open,
    cwd: providerModelDiscoveryCwd,
    modelHintByProvider,
  });

  return (
    <ProviderModelPicker
      compact
      provider={value.provider}
      model={value.model}
      lockedProvider={null}
      providers={providerStatuses}
      modelOptionsByProvider={modelOptionsByProvider}
      loadingModelProviders={loadingModelProviders}
      hiddenProviders={settings.hiddenProviders}
      providerOrder={settings.providerOrder}
      open={open}
      onOpenChange={setOpen}
      onProviderModelChange={(provider, model) => onChange(buildModelSelection(provider, model))}
    />
  );
}

export function AutomationDialog({
  open,
  editing,
  form,
  projects,
  threads,
  warnings = [],
  acknowledgedWarningIds = new Set(),
  onOpenChange,
  onFormChange,
  onToggleWarning,
  onSubmit,
  busy,
}: {
  readonly open: boolean;
  readonly editing: boolean;
  readonly form: AutomationFormState;
  readonly projects: ReturnType<typeof useStore.getState>["projects"];
  readonly threads: readonly Thread[];
  readonly warnings?: readonly AutomationDraftWarning[];
  readonly acknowledgedWarningIds?: ReadonlySet<AutomationDraftWarningId>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onFormChange: (form: AutomationFormState) => void;
  readonly onToggleWarning?: (id: AutomationDraftWarningId, checked: boolean) => void;
  readonly onSubmit: () => void;
  readonly busy: boolean;
}) {
  const m = useMessages();
  const copy = m.automations;
  const setField = <K extends keyof AutomationFormState>(key: K, value: AutomationFormState[K]) =>
    onFormChange({ ...form, [key]: value });
  const projectThreads = threads.filter((thread) => thread.projectId === form.projectId);
  const selectedProject = projects.find((project) => project.id === form.projectId);
  const schedule = scheduleFromForm(form);
  const fastIntervalLimitMessage = automationFastIntervalLimitMessage(form);
  const hasBlockingWarning = hasBlockingAutomationDraftWarnings(warnings, acknowledgedWarningIds);
  const submittable = isFormSubmittable(form) && !hasBlockingWarning;
  const intervalValue = intervalOptionValue({
    amount: form.intervalAmount,
    unit: form.intervalUnit,
  });
  const maxIterationChoices = maxIterationOptions(form.maxIterations, copy.maxIterationOption);
  const presets = intervalPresets(copy.interval);
  const intervalChoices = presets.some((preset) => intervalOptionValue(preset) === intervalValue)
    ? presets
    : [
        {
          amount: form.intervalAmount,
          unit: form.intervalUnit,
          label: intervalOptionLabel(form.intervalAmount, form.intervalUnit, copy.interval),
        },
        ...presets,
      ];

  const chooseProject = (projectId: string) => {
    const targetStillMatches =
      form.targetThreadId.length > 0 &&
      threads.some((thread) => thread.id === form.targetThreadId && thread.projectId === projectId);
    onFormChange({
      ...form,
      projectId,
      modelSelection: modelSelectionForProjectChange(
        projects,
        form.projectId,
        projectId,
        form.modelSelection,
      ),
      targetThreadId: targetStillMatches ? form.targetThreadId : "",
    });
  };

  const applyTemplate = (template: AutomationTemplate) =>
    onFormChange({
      ...form,
      name: form.name.trim() ? form.name : template.name,
      prompt: template.prompt,
    });

  const submit = () => {
    if (busy || !submittable) return;
    onSubmit();
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (busy && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup showCloseButton={false} className="max-w-3xl">
        <DialogTitle className="sr-only">
          {editing ? copy.editAutomation : copy.newAutomation}
        </DialogTitle>

        <div className="flex items-start gap-3 px-5 pt-5">
          <input
            value={form.name}
            onChange={(event) => setField("name", event.target.value)}
            placeholder={copy.dialog.namePlaceholder}
            aria-label={copy.dialog.nameLabel}
            autoFocus
            className="min-w-0 flex-1 bg-transparent py-1 font-system-ui text-lg font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={copy.dialog.aboutLabel}
              title={copy.dialog.aboutHint}
            >
              <CentralIcon name="info-simple" className="size-4" />
            </Button>
            <Menu>
              <MenuTrigger render={<Button variant="outline" size="sm" />}>
                {copy.actions.useTemplate}
              </MenuTrigger>
              <ComposerPickerMenuPopup align="end" className="w-52">
                {automationTemplates(copy).map((template) => (
                  <MenuItem key={template.label} onClick={() => applyTemplate(template)}>
                    {template.label}
                  </MenuItem>
                ))}
              </ComposerPickerMenuPopup>
            </Menu>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={copy.actions.close}
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              <CentralIcon name="cross-small" className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-3">
          <textarea
            value={form.prompt}
            onChange={(event) => setField("prompt", event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={copy.dialog.promptPlaceholder}
            aria-label={copy.dialog.promptLabel}
            className="min-h-[15rem] w-full flex-1 resize-none overflow-y-auto bg-transparent font-system-ui text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
          />

          {warnings.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-border/50 pt-3">
              {warnings.map((warning) => (
                <label
                  key={warning.id}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  {warning.requiresAcknowledgement ? (
                    <input
                      type="checkbox"
                      checked={acknowledgedWarningIds.has(warning.id)}
                      onChange={(event) => onToggleWarning?.(warning.id, event.target.checked)}
                      className="mt-0.5"
                    />
                  ) : (
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500" />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{warning.title}</span>
                    <span className="block">{warning.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {fastIntervalLimitMessage ? (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
              {fastIntervalLimitMessage}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-1">
          <div className="flex flex-1 flex-wrap items-center gap-0.5">
            {form.mode === "standalone" ? (
              <Menu>
                <MenuTrigger render={<Button variant="ghost" size="sm" className={CHIP_CLASS} />}>
                  <WorktreeIcon className="size-4" />
                  <span className="capitalize">{form.worktreeMode}</span>
                  <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
                </MenuTrigger>
                <ComposerPickerMenuPopup align="start" className="w-40">
                  <MenuRadioGroup
                    value={form.worktreeMode}
                    onValueChange={(value) =>
                      setField("worktreeMode", value as AutomationWorktreeMode)
                    }
                  >
                    {(["auto", "worktree", "local"] as const).map((value) => (
                      <MenuRadioItem key={value} value={value}>
                        <span className="capitalize">{value}</span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </ComposerPickerMenuPopup>
              </Menu>
            ) : null}

            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="sm" className={CHIP_CLASS} />}>
                <CentralIcon name="folder-2" className="size-4" />
                <span className="max-w-[10rem] truncate">
                  {selectedProject?.name ?? copy.dialog.selectProject}
                </span>
                <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-56">
                <MenuRadioGroup value={form.projectId} onValueChange={chooseProject}>
                  {projects.map((project) => (
                    <MenuRadioItem key={project.id} value={project.id}>
                      <span className="truncate">{project.name}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </ComposerPickerMenuPopup>
            </Menu>

            <AutomationModelPicker
              value={form.modelSelection}
              projectCwd={selectedProject?.cwd ?? null}
              onChange={(value) => setField("modelSelection", value)}
            />

            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="sm" className={CHIP_CLASS} />}>
                <CentralIcon name="clock" className="size-4" />
                <span>{formatCadence(schedule)}</span>
                <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-56">
                <MenuGroup>
                  <MenuGroupLabel>{copy.dialog.schedule}</MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.scheduleKind}
                    onValueChange={(value) => setField("scheduleKind", value as ScheduleKind)}
                  >
                    {SCHEDULE_KIND_OPTIONS.map((option) => (
                      <MenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                {form.scheduleKind === "custom" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>{copy.dialog.every}</MenuGroupLabel>
                      <MenuRadioGroup
                        value={intervalValue}
                        onValueChange={(value) => {
                          const [unit, amount] = value.split(":");
                          if (unit === "seconds" || unit === "minutes") {
                            onFormChange({
                              ...form,
                              intervalUnit: unit,
                              intervalAmount: amount ?? "1",
                            });
                          }
                        }}
                      >
                        {intervalChoices.map((preset) => (
                          <MenuRadioItem
                            key={intervalOptionValue(preset)}
                            value={intervalOptionValue(preset)}
                          >
                            {preset.label}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "once" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>{copy.dialog.runAt}</MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          type="datetime-local"
                          step={1}
                          value={form.onceRunAt}
                          onChange={(event) => setField("onceRunAt", event.target.value)}
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "cron" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>{copy.dialog.cron}</MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          value={form.cronExpression}
                          onChange={(event) => setField("cronExpression", event.target.value)}
                          placeholder="0 9 * * *"
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "weekly" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>{copy.dialog.day}</MenuGroupLabel>
                      <MenuRadioGroup
                        value={form.dayOfWeek}
                        onValueChange={(value) => setField("dayOfWeek", value)}
                      >
                        {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                          <MenuRadioItem key={value} value={String(value)}>
                            {weekdayLabel(value)}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "daily" ||
                form.scheduleKind === "weekdays" ||
                form.scheduleKind === "weekly" ? (
                  <>
                    <MenuSeparator />
                    <MenuSub>
                      <MenuSubTrigger>
                        {copy.dialog.time}
                        <span className="ml-auto pr-1 tabular-nums text-muted-foreground">
                          {form.timeOfDay}
                        </span>
                      </MenuSubTrigger>
                      <ComposerPickerMenuSubPopup>
                        <div className="p-1">
                          <TimePicker
                            className="w-44"
                            value={form.timeOfDay}
                            onChange={(value) => setField("timeOfDay", value)}
                          />
                        </div>
                      </ComposerPickerMenuSubPopup>
                    </MenuSub>
                  </>
                ) : null}
                {form.scheduleKind === "daily" ||
                form.scheduleKind === "weekdays" ||
                form.scheduleKind === "weekly" ||
                form.scheduleKind === "cron" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>{copy.dialog.timezone}</MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          value={form.timezone}
                          onChange={(event) => setField("timezone", event.target.value)}
                          placeholder={copy.dialog.timezonePlaceholder}
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                  </>
                ) : null}
              </ComposerPickerMenuPopup>
            </Menu>

            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={copy.dialog.runMode}
                    title={copy.dialog.runMode}
                    className="rounded-lg text-[var(--color-text-foreground-secondary)]"
                  />
                }
              >
                <SkillCubeIcon className="size-4" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-56">
                <MenuGroup>
                  <MenuGroupLabel>{copy.dialog.mode}</MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.mode}
                    onValueChange={(value) => setField("mode", value as AutomationMode)}
                  >
                    <MenuRadioItem value="standalone">{copy.mode.standalone}</MenuRadioItem>
                    <MenuRadioItem value="heartbeat">{copy.mode.heartbeat}</MenuRadioItem>
                  </MenuRadioGroup>
                </MenuGroup>
                {form.mode === "heartbeat" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>{copy.dialog.targetThread}</MenuGroupLabel>
                      {projectThreads.length === 0 ? (
                        <MenuItem disabled>{copy.dialog.noThreads}</MenuItem>
                      ) : (
                        <MenuRadioGroup
                          value={form.targetThreadId}
                          onValueChange={(value) => setField("targetThreadId", value)}
                        >
                          {projectThreads.map((thread) => (
                            <MenuRadioItem key={thread.id} value={thread.id}>
                              <span className="truncate">
                                {resolveThreadPickerTitle(thread.title)}
                              </span>
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      )}
                    </MenuGroup>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>{copy.dialog.stopWhen}</MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          value={form.stopWhen}
                          onChange={(event) => setField("stopWhen", event.target.value)}
                          placeholder={copy.dialog.stopWhenPlaceholder}
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                    <MenuSeparator />
                    <MenuCheckboxItem
                      checked={form.stopOnError}
                      onCheckedChange={(checked) => setField("stopOnError", checked)}
                    >
                      {copy.dialog.stopOnError}
                    </MenuCheckboxItem>
                  </>
                ) : null}
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>{copy.dialog.maxIterations}</MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.maxIterations}
                    onValueChange={(value) => setField("maxIterations", value)}
                  >
                    {maxIterationChoices.map((preset) => (
                      <MenuRadioItem key={preset.value || "unlimited"} value={preset.value}>
                        {preset.label}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>{copy.dialog.notify}</MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.notificationPolicy}
                    onValueChange={(value) =>
                      setField("notificationPolicy", value as AutomationNotificationPolicy)
                    }
                  >
                    <MenuRadioItem value="all">{copy.notifyPolicy.all}</MenuRadioItem>
                    <MenuRadioItem value="failed-runs-only">
                      {copy.notifyPolicy.failedRunsOnly}
                    </MenuRadioItem>
                  </MenuRadioGroup>
                </MenuGroup>
              </ComposerPickerMenuPopup>
            </Menu>

            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={copy.dialog.permissions}
                    title={copy.dialog.permissions}
                    className="rounded-lg text-[var(--color-text-foreground-secondary)]"
                  />
                }
              >
                <CentralIcon name="brain" className="size-4" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-48">
                <MenuRadioGroup
                  value={form.runtimeMode}
                  onValueChange={(value) => setField("runtimeMode", value as RuntimeMode)}
                >
                  <MenuRadioItem value="approval-required">
                    {copy.runtimeMode.approvalRequired}
                  </MenuRadioItem>
                  <MenuRadioItem value="full-access">{copy.runtimeMode.fullAccess}</MenuRadioItem>
                </MenuRadioGroup>
              </ComposerPickerMenuPopup>
            </Menu>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {copy.actions.cancel}
            </Button>
            <Button type="button" onClick={submit} disabled={busy || !submittable}>
              {editing ? copy.actions.save : copy.actions.create}
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

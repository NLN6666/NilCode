// FILE: useKanbanTaskSubmit.ts
// Purpose: Owns the kanban new-task dialog's draft/create/send lifecycle.
// Layer: Kanban UI hook
// Exports: useKanbanTaskSubmit

import type {
  AssistantDeliveryMode,
  ModelSlug,
  ProjectId,
  ProviderInteractionMode,
  ProviderInstanceId,
  ProviderKind,
  ProviderStartOptions,
  RuntimeMode,
  ServerProviderStatus,
  ThreadId,
} from "@synara/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import type { ProviderInstanceOption } from "~/appSettings";
import type { DraftThreadEnvMode } from "~/composerDraftStore";
import { providerInstanceModelSelectionKey, useComposerDraftStore } from "~/composerDraftStore";
import { useRefreshProviderStatusesNow } from "~/hooks/useProviderStatusRefresh";
import { createAndSendKanbanTask, createKanbanDraftTask } from "~/lib/kanbanTaskCreate";
import { resolveProviderSendAvailabilityWithRefresh } from "~/lib/providerAvailability";
import { buildModelSelection } from "~/providerModelOptions";
import type { DefaultModelRef } from "~/providerOrdering";
import { truncateKanbanTaskPreview } from "./KanbanNewTaskDialog.logic";
import { useTranslation } from "~/i18n";

interface UseKanbanTaskSubmitInput {
  readonly selectedProjectId: ProjectId | null;
  readonly hasSendableContent: boolean;
  readonly selectedProvider: ProviderKind;
  readonly selectedProviderInstanceId: ProviderInstanceId;
  readonly selectedModel: ModelSlug | null;
  readonly selectedModelSupportsAutoMode: boolean | undefined;
  readonly taskPreview: string;
  readonly trimmedPrompt: string;
  readonly scratchThreadId: ThreadId;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly envMode: DraftThreadEnvMode;
  readonly sendAsDraft: boolean;
  /** New-task dialog "send as goal" toggle (off by default; dialog-owned state). */
  readonly sendAsGoal?: boolean | undefined;
  readonly defaultProvider: ProviderKind;
  readonly defaultModelByProvider: ReadonlyArray<DefaultModelRef>;
  readonly assistantDeliveryMode: AssistantDeliveryMode;
  readonly providerOptionsForDispatch: ProviderStartOptions | undefined;
  readonly providerInstances: ReadonlyArray<
    Pick<ProviderInstanceOption, "instanceId" | "provider">
  >;
  readonly providerStatuses: readonly ServerProviderStatus[];
  readonly isPreparingImages: boolean;
  readonly waitForPendingImages: () => Promise<boolean>;
  readonly onOpenChange: (open: boolean) => void;
}

export function useKanbanTaskSubmit(input: UseKanbanTaskSubmitInput) {
  const {
    selectedProjectId,
    hasSendableContent,
    selectedProvider,
    selectedProviderInstanceId,
    selectedModel,
    selectedModelSupportsAutoMode,
    taskPreview,
    trimmedPrompt,
    scratchThreadId,
    runtimeMode,
    interactionMode,
    envMode,
    sendAsDraft,
    sendAsGoal = false,
    defaultProvider,
    defaultModelByProvider,
    assistantDeliveryMode,
    providerOptionsForDispatch,
    providerInstances,
    providerStatuses,
    isPreparingImages,
    waitForPendingImages,
    onOpenChange,
  } = input;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const refreshProviderStatuses = useRefreshProviderStatusesNow();
  // Synchronous re-entry guard: repeated Cmd+Enter can fire before React flushes
  // the loading state, and two passes here would create two tasks.
  const isCreatingRef = useRef(false);

  const canCreate =
    selectedProjectId !== null &&
    hasSendableContent &&
    selectedModel !== null &&
    !isCreating &&
    !isPreparingImages;

  const handleCreate = async () => {
    if (
      !selectedProjectId ||
      !hasSendableContent ||
      selectedModel === null ||
      isCreating ||
      isCreatingRef.current
    ) {
      return;
    }

    isCreatingRef.current = true;
    if (!(await waitForPendingImages())) {
      isCreatingRef.current = false;
      return;
    }
    const truncatedPrompt = truncateKanbanTaskPreview(taskPreview);
    // The scratch draft carries the full selection (model + reasoning effort +
    // speed) set through the picker; fall back to a bare selection otherwise.
    const scratchState = useComposerDraftStore.getState().draftsByThreadId[scratchThreadId];
    const storedModelSelection =
      scratchState?.modelSelectionByProvider[
        providerInstanceModelSelectionKey(selectedProvider, selectedProviderInstanceId)
      ];
    const storedModelSupportsAutoMode =
      storedModelSelection?.provider === "claudeAgent"
        ? storedModelSelection.supportsAutoMode
        : undefined;
    const modelSelection = buildModelSelection(
      selectedProvider,
      storedModelSelection?.model ?? selectedModel,
      storedModelSelection?.options,
      selectedProvider === "claudeAgent"
        ? (selectedModelSupportsAutoMode ?? storedModelSupportsAutoMode)
        : undefined,
      { instanceId: selectedProviderInstanceId },
    );
    const taskInput = {
      projectId: selectedProjectId,
      prompt: trimmedPrompt,
      sourceComposerThreadId: scratchThreadId,
      modelSelection,
      runtimeMode,
      interactionMode,
      envMode,
    };

    if (sendAsDraft) {
      createKanbanDraftTask(taskInput);
      toastManager.add({
        type: "success",
        title: t("workspace:taskAddedToDrafts"),
        description: truncatedPrompt,
      });
      onOpenChange(false);
      return;
    }

    // Send now: create + promote + dispatch straight to In Progress.
    const sendAvailability = await resolveProviderSendAvailabilityWithRefresh({
      provider: modelSelection.provider,
      instanceId: modelSelection.instanceId ?? selectedProviderInstanceId,
      statuses: providerStatuses,
      refreshStatuses: () => refreshProviderStatuses({ silent: true }),
    });
    if (!sendAvailability.usable) {
      toastManager.add({
        type: "error",
        title: sendAvailability.unavailableReason,
      });
      isCreatingRef.current = false;
      return;
    }

    setIsCreating(true);
    void createAndSendKanbanTask({
      ...taskInput,
      defaultProvider,
      defaultModelByProvider,
      assistantDeliveryMode,
      providerOptions: providerOptionsForDispatch,
      ...(sendAsGoal ? { sendAsGoal: true as const } : {}),
      providerInstances,
    })
      .then(({ threadId, result }) => {
        if (result.kind === "dispatched") {
          if (result.deferred) {
            toastManager.add({
              type: "info",
              title: t("workspace:chatSendInProgress"),
              description: t("workspace:theBoardStoodDownTheRunningChatSendOwns"),
            });
            onOpenChange(false);
            return;
          }
          toastManager.add({
            type: result.warning ? "warning" : "success",
            title: t("common:taskStarted"),
            description: result.warning ?? truncatedPrompt,
          });
          onOpenChange(false);
          return;
        }
        if (result.kind === "open-thread") {
          toastManager.add({
            type: "info",
            title: t("workspace:finishDraftInChat"),
            description:
              result.reason === "worktree-pending"
                ? t("workspace:worktreeSetupStaysOnNormalComposerSendPath")
                : t("workspace:taskSavedAsDraft"),
          });
          onOpenChange(false);
          void navigate({ to: "/$threadId", params: { threadId } });
          return;
        }
        // Promotion/dispatch could not complete faithfully; the draft still
        // exists on the board, so surface the failure and keep the dialog open.
        toastManager.add({
          type: "error",
          title: t("common:couldNotStartTheTask"),
          description:
            result.kind === "error"
              ? result.message
              : t("workspace:taskSavedToDraftsOpenToSendManually"),
        });
        isCreatingRef.current = false;
        setIsCreating(false);
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: t("common:couldNotStartTheTask"),
          description: error instanceof Error ? error.message : t("common:unknownError"),
        });
        isCreatingRef.current = false;
        setIsCreating(false);
      });
  };

  return {
    isCreating,
    canCreate,
    handleCreate,
  };
}

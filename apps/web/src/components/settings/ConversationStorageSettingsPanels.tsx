// FILE: ConversationStorageSettingsPanels.tsx
// Purpose: Own settings panels for managed worktrees and archived conversations.
// Layer: Settings UI components
// Exports: WorktreesSettingsPanel, ArchivedSettingsPanel

import type { ThreadId } from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { Button } from "~/components/ui/button";
import { useMessages } from "../../i18n/context";
import { gitRemoveWorktreeMutationOptions } from "~/lib/gitReactQuery";
import { ArchiveIcon } from "~/lib/icons";
import {
  deleteArchivedThreadFromClient,
  deleteArchivedThreadsFromClient,
} from "~/lib/archivedThreadDelete";
import { formatRelativeTime } from "~/lib/relativeTime";
import { serverQueryKeys, serverWorktreesQueryOptions } from "~/lib/serverReactQuery";
import { unarchiveThreadFromClient } from "~/lib/threadArchive";
import { cn } from "~/lib/utils";
import { ensureNativeApi, readNativeApi } from "~/nativeApi";
import { SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME } from "~/settingsPanelStyles";
import { useStore } from "~/store";
import { createThreadShellsSelector } from "~/storeSelectors";
import { formatWorktreePathForDisplay } from "~/worktreeCleanup";
import { toastManager } from "../ui/toast";
import { SettingsEmptyState, SettingsListRow, SettingsSection } from "./SettingsPanelPrimitives";

type WorktreeAssociation = {
  worktreePath?: string | null | undefined;
  associatedWorktreePath?: string | null | undefined;
};

type ArchivedSortableThread = {
  id: string;
  archivedAt?: string | null | undefined;
  updatedAt?: string | null | undefined;
  createdAt: string;
};

function isThreadAssociatedWithWorktree(
  thread: WorktreeAssociation,
  worktreePath: string,
): boolean {
  return [thread.worktreePath, thread.associatedWorktreePath].some((candidate) => {
    const normalized = candidate?.trim();
    return Boolean(normalized) && normalized === worktreePath;
  });
}

function compareArchivedThreads(left: ArchivedSortableThread, right: ArchivedSortableThread) {
  const leftKey = left.archivedAt ?? left.updatedAt ?? left.createdAt;
  const rightKey = right.archivedAt ?? right.updatedAt ?? right.createdAt;
  return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
}

function WorktreesStatus(props: { children: string; error?: boolean }) {
  return (
    <SettingsEmptyState layout="status" tone={props.error ? "destructive" : "muted"}>
      {props.children}
    </SettingsEmptyState>
  );
}

export function WorktreesSettingsPanel({ active }: { readonly active: boolean }) {
  const m = useMessages();
  const queryClient = useQueryClient();
  const worktreesQuery = useQuery(serverWorktreesQueryOptions());
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const removeDeletedThreadFromClientState = useStore(
    (store) => store.removeDeletedThreadFromClientState,
  );
  // Shell metadata is enough for association labels and avoids rerendering on transcript ticks.
  const threadShells = useStore(useMemo(() => createThreadShellsSelector(), []));

  const worktreesByWorkspaceRoot = useMemo(() => {
    type WorktreeGroup = {
      workspaceRoot: string;
      worktrees: Array<{
        path: string;
        linkedThreads: typeof threadShells;
      }>;
    };
    const groups: WorktreeGroup[] = [];
    const groupByRoot = new Map<string, WorktreeGroup>();
    for (const worktree of worktreesQuery.data?.worktrees ?? []) {
      const nextWorktree = {
        path: worktree.path,
        linkedThreads: threadShells.filter((thread) =>
          isThreadAssociatedWithWorktree(thread, worktree.path),
        ),
      };
      const existingGroup = groupByRoot.get(worktree.workspaceRoot);
      if (existingGroup) {
        existingGroup.worktrees.push(nextWorktree);
        continue;
      }
      const group: WorktreeGroup = {
        workspaceRoot: worktree.workspaceRoot,
        worktrees: [nextWorktree],
      };
      groups.push(group);
      groupByRoot.set(worktree.workspaceRoot, group);
    }
    return groups;
  }, [threadShells, worktreesQuery.data?.worktrees]);

  const deleteManagedWorktree = useCallback(
    async (input: { workspaceRoot: string; worktreePath: string }) => {
      const api = readNativeApi() ?? ensureNativeApi();
      const displayName = formatWorktreePathForDisplay(input.worktreePath);
      const snapshot = await api.orchestration.getShellSnapshot().catch(() => null);
      if (snapshot === null) {
        toastManager.add({
          type: "error",
          title: m.settings.worktrees.verifyFailedTitle,
          description: m.settings.worktrees.verifyFailedDescription,
        });
        return;
      }

      const linkedThreads = snapshot.threads.filter((thread) =>
        isThreadAssociatedWithWorktree(thread, input.worktreePath),
      );
      const linkedArchivedThreadIds = linkedThreads
        .filter((thread) => (thread.archivedAt ?? null) !== null)
        .map((thread) => thread.id);
      const linkedActiveThreadCount = linkedThreads.length - linkedArchivedThreadIds.length;
      const linkedConversationCount = linkedThreads.length;
      const confirmed = await api.dialogs.confirm(
        linkedConversationCount > 0
          ? m.settings.worktrees.deleteConfirm(
              displayName,
              linkedActiveThreadCount,
              linkedArchivedThreadIds.length,
            )
          : m.settings.worktrees.deleteConfirmUnlinked(displayName),
      );
      if (!confirmed) return;

      try {
        await deleteArchivedThreadsFromClient({
          api: api.orchestration,
          threadIds: linkedArchivedThreadIds,
          removeDeletedThreadFromClientState,
        });
        await removeWorktreeMutation.mutateAsync({
          cwd: input.workspaceRoot,
          path: input.worktreePath,
          force: true,
        });
        await queryClient.invalidateQueries({ queryKey: serverQueryKeys.worktrees() });
        toastManager.add({
          type: "success",
          title: m.settings.worktrees.deletedTitle,
          description:
            linkedArchivedThreadIds.length > 0
              ? m.settings.worktrees.deletedWithArchived(
                  displayName,
                  linkedArchivedThreadIds.length,
                )
              : m.settings.worktrees.deletedDescription(displayName),
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: m.settings.worktrees.deleteFailedTitle,
          description:
            error instanceof Error ? error.message : m.settings.worktrees.deleteFailedDescription,
        });
      }
    },
    [m, queryClient, removeDeletedThreadFromClientState, removeWorktreeMutation],
  );

  if (!active) return null;

  if (worktreesQuery.isLoading) {
    return <WorktreesStatus>{m.settings.worktrees.loading}</WorktreesStatus>;
  }
  if (worktreesQuery.isError) {
    return (
      <WorktreesStatus error>
        {worktreesQuery.error instanceof Error
          ? worktreesQuery.error.message
          : m.settings.worktrees.loadFailed}
      </WorktreesStatus>
    );
  }
  if (worktreesByWorkspaceRoot.length === 0) {
    return <WorktreesStatus>{m.settings.worktrees.empty}</WorktreesStatus>;
  }

  return (
    <div className="space-y-6">
      {worktreesByWorkspaceRoot.map((group) => (
        <SettingsSection key={group.workspaceRoot} title={group.workspaceRoot}>
          {group.worktrees.map((worktree) => (
            <SettingsListRow
              key={worktree.path}
              align="start"
              title={m.settings.worktrees.worktree}
              description={
                <div className="space-y-2">
                  <div
                    className={cn(SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME, "truncate font-mono")}
                  >
                    {worktree.path}
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {m.settings.worktrees.conversations}
                    </div>
                    {worktree.linkedThreads.length > 0 ? (
                      <div className="space-y-1">
                        {worktree.linkedThreads.map((thread) => (
                          <div
                            key={thread.id}
                            className={cn(
                              SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
                              "text-foreground",
                            )}
                          >
                            {thread.title}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
                        {m.settings.worktrees.noLinkedConversations}
                      </div>
                    )}
                  </div>
                </div>
              }
              actions={
                <div className="flex flex-col items-end gap-2">
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={removeWorktreeMutation.isPending}
                    onClick={() =>
                      void deleteManagedWorktree({
                        workspaceRoot: group.workspaceRoot,
                        worktreePath: worktree.path,
                      })
                    }
                  >
                    {m.settings.worktrees.delete}
                  </Button>
                  {worktree.linkedThreads.length > 0 ? (
                    <p
                      className={cn(
                        SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
                        "max-w-40 text-right",
                      )}
                    >
                      {m.settings.worktrees.linkedWarning}
                    </p>
                  ) : null}
                </div>
              }
            />
          ))}
        </SettingsSection>
      ))}
    </div>
  );
}

export function ArchivedSettingsPanel({ active }: { readonly active: boolean }) {
  const m = useMessages();
  const removeDeletedThreadFromClientState = useStore(
    (store) => store.removeDeletedThreadFromClientState,
  );
  const threadShells = useStore(useMemo(() => createThreadShellsSelector(), []));
  const projects = useStore((store) => store.projects);
  const archivedGroups = useMemo(() => {
    const archivedThreads = threadShells.filter((thread) => thread.archivedAt != null);
    const knownProjectIds = new Set(projects.map((project) => project.id));
    const groups: Array<{
      project: (typeof projects)[number] | null;
      threads: typeof archivedThreads;
    }> = projects.map((project) => ({
      project,
      threads: archivedThreads
        .filter((thread) => thread.projectId === project.id)
        .toSorted(compareArchivedThreads),
    }));
    const orphanedThreads = archivedThreads
      .filter((thread) => !knownProjectIds.has(thread.projectId))
      .toSorted(compareArchivedThreads);
    if (orphanedThreads.length > 0) {
      groups.push({ project: null, threads: orphanedThreads });
    }
    return groups.filter((group) => group.threads.length > 0);
  }, [projects, threadShells]);

  const unarchiveThread = useCallback(
    async (threadId: ThreadId) => {
      const api = readNativeApi();
      if (!api) return;
      try {
        await unarchiveThreadFromClient(api.orchestration, threadId);
        toastManager.add({
          type: "success",
          title: m.settings.archived.restoredTitle,
          description: m.settings.archived.restoredDescription,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: m.settings.archived.restoreFailedTitle,
          description:
            error instanceof Error ? error.message : m.settings.archived.restoreFailedDescription,
        });
      }
    },
    [m],
  );

  const deleteArchivedThread = useCallback(
    async (threadId: ThreadId, threadTitle: string) => {
      const api = readNativeApi();
      if (!api) return;
      const confirmed = await api.dialogs.confirm(m.settings.archived.deleteConfirm(threadTitle));
      if (!confirmed) return;
      try {
        await deleteArchivedThreadFromClient({
          api: api.orchestration,
          threadId,
          removeDeletedThreadFromClientState,
        });
        toastManager.add({
          type: "success",
          title: m.settings.archived.deletedTitle,
          description: m.settings.archived.deletedDescription,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: m.settings.archived.deleteFailedTitle,
          description:
            error instanceof Error ? error.message : m.settings.archived.deleteFailedDescription,
        });
      }
    },
    [m, removeDeletedThreadFromClientState],
  );

  const handleContextMenu = useCallback(
    async (threadId: ThreadId, threadTitle: string, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "restore", label: m.settings.archived.restore },
          { id: "delete", label: m.settings.archived.delete, destructive: true },
        ],
        position,
      );
      if (clicked === "restore") {
        await unarchiveThread(threadId);
      } else if (clicked === "delete") {
        await deleteArchivedThread(threadId, threadTitle);
      }
    },
    [deleteArchivedThread, m, unarchiveThread],
  );

  if (!active) return null;

  if (archivedGroups.length === 0) {
    return (
      <SettingsEmptyState>
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground">
          <ArchiveIcon className="size-5" />
        </div>
        <div className="text-sm font-medium text-foreground">{m.settings.archived.emptyTitle}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {m.settings.archived.emptyDescription}
        </div>
      </SettingsEmptyState>
    );
  }

  return (
    <div className="space-y-6">
      {archivedGroups.map(({ project, threads }) => (
        <SettingsSection
          key={project?.id ?? "unknown-project"}
          title={project?.name ?? m.settings.archived.unknownProject}
        >
          {threads.map((thread) => (
            <SettingsListRow
              key={thread.id}
              title={thread.title}
              description={m.settings.archived.archivedAt(
                formatRelativeTime(thread.archivedAt ?? thread.createdAt),
              )}
              onContextMenu={(event) => {
                event.preventDefault();
                void handleContextMenu(thread.id, thread.title, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              actions={
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void unarchiveThread(thread.id)}
                  >
                    {m.settings.archived.restore}
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    onClick={() => void deleteArchivedThread(thread.id, thread.title)}
                  >
                    {m.settings.archived.delete}
                  </Button>
                </>
              }
            />
          ))}
        </SettingsSection>
      ))}
    </div>
  );
}

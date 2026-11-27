import {
  ThreadId,
  type KeybindingCommand,
  type ProjectId,
  type ProjectScript,
} from "@synara/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useProjectScriptPreview } from "~/hooks/useProjectScriptPreview";
import { persistProjectLaunchConfig } from "~/lib/launchConfigReactQuery";
import { abortProjectPreview } from "~/lib/projectPreviewLauncher";
import { resolveProjectScriptTerminalScope } from "~/lib/projectServiceTerminalScope";
import { decodeProjectScriptKeybindingRule } from "~/lib/projectScriptKeybindings";
import { serverLocalServersQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import {
  commandForProjectScript,
  nextProjectScriptId,
  type ProjectScriptRunOptions,
  type ProjectScriptRunResult,
} from "~/projectScripts";
import { runProjectCommandInTerminal } from "~/projectTerminalRunner";
import { useRightDockStore } from "~/rightDockStore";
import { isElectron } from "../../env";
import {
  selectRunningProjectScriptIds,
  selectProjectScriptTerminalIds,
  selectThreadTerminalState,
  useTerminalStateStore,
} from "../../terminalStateStore";
import {
  findLocalServerForProjectScript,
  resolveRunningProjectScriptIds,
} from "../../projectScriptServiceState";
import type { Project, Thread } from "../../types";
import {
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
} from "../ChatView.logic";
import { type NewProjectScriptInput } from "./ProjectActionDialog";
import { closeProjectScriptTerminal } from "../terminal/terminalSession";
import { randomTerminalId } from "../terminal/terminalIds";
import { toastManager } from "../ui/toast";
const EMPTY_LAST_INVOKED_SCRIPT_BY_PROJECT: Record<string, string> = {};
// Several chats can launch the same project-wide service before its first activity event.
const pendingScriptLaunches = new Set<string>();
interface ChatProjectScriptsInput {
  activeThreadId: ThreadId | null;
  activeThread: Thread | undefined;
  activeProject: Project | undefined;
  gitCwd: string | null;
  isGroupContainer: boolean;
  openBrowserUrl: (url: string) => void;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
}

export function useChatProjectScripts({
  activeThreadId,
  activeThread,
  activeProject,
  gitCwd,
  isGroupContainer,
  openBrowserUrl,
  setThreadError,
}: ChatProjectScriptsInput) {
  const queryClient = useQueryClient();
  const { startPreview } = useProjectScriptPreview({
    projectId: activeProject?.id ?? null,
    openBrowserUrl,
  });
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    EMPTY_LAST_INVOKED_SCRIPT_BY_PROJECT,
    LastInvokedScriptByProjectSchema,
  );
  const activeProjectId = activeProject?.id ?? null;
  const actionScopeId = resolveProjectScriptTerminalScope({
    isService: false,
    projectId: activeProjectId,
    threadId: activeThreadId,
  });
  const serviceScopeId = resolveProjectScriptTerminalScope({
    isService: true,
    projectId: activeProjectId,
    threadId: activeThreadId,
  });

  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: ProjectScriptRunOptions,
    ): Promise<ProjectScriptRunResult | null> => {
      const api = readNativeApi();
      if (!api || !activeThreadId || !activeProject || !activeThread) return null;
      const terminalThreadId = script.port != null ? serviceScopeId : actionScopeId;
      if (terminalThreadId === null) return null;
      const terminalStore = useTerminalStateStore.getState();
      const terminalState = selectThreadTerminalState(
        terminalStore.terminalStateByThreadId,
        terminalThreadId,
      );
      const launchKey = `${terminalThreadId}\0${script.id}`;
      if (
        pendingScriptLaunches.has(launchKey) ||
        terminalState.runningTerminalIds.some(
          (id) => terminalState.projectScriptIdsByTerminalId[id] === script.id,
        )
      ) {
        return null;
      }
      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject.id] === script.id) return current;
          return { ...current, [activeProject.id]: script.id };
        });
      }
      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.cwd;
      const targetTerminalId = randomTerminalId();

      // React Compiler cannot lower value blocks directly inside `try`; keep
      // those expressions in the nested function while retaining error handling.
      const runScriptInTargetTerminal = async () => {
        const { metadata } = await runProjectCommandInTerminal({
          api,
          threadId: terminalThreadId,
          terminalId: targetTerminalId,
          project: {
            cwd: isGroupContainer ? targetCwd : activeProject.cwd,
          },
          cwd: targetCwd,
          command: script.command,
          worktreePath: options?.worktreePath ?? activeThread.worktreePath ?? null,
          ...(options?.env ? { env: options.env } : {}),
          onOpened: () => {
            // Register before sending input so activity is tracked while the row is collapsed.
            terminalStore.registerProjectScriptTerminal(
              terminalThreadId,
              targetTerminalId,
              script.id,
              script.name,
            );
            useRightDockStore.getState().setDockOpen(activeThreadId, true);
          },
        });
        if (metadata) {
          terminalStore.setTerminalMetadata(terminalThreadId, targetTerminalId, {
            cliKind: metadata.cliKind,
            label: metadata.label,
          });
        }
        const current = useTerminalStateStore.getState().terminalStateByThreadId[terminalThreadId];
        if (current?.projectScriptIdsByTerminalId[targetTerminalId] === script.id) {
          startPreview(script);
        }
      };

      pendingScriptLaunches.add(launchKey);
      try {
        await runScriptInTargetTerminal();
        return { threadId: terminalThreadId, terminalId: targetTerminalId };
      } catch (error) {
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
        if (options?.throwOnError) {
          throw error instanceof Error
            ? error
            : new Error(`Failed to run script "${script.name}".`);
        }
        return null;
      } finally {
        pendingScriptLaunches.delete(launchKey);
      }
    },
    [
      activeProject,
      activeThread,
      activeThreadId,
      actionScopeId,
      gitCwd,
      isGroupContainer,
      serviceScopeId,
      setThreadError,
      setLastInvokedScriptByProjectId,
      startPreview,
    ],
  );

  const activeProjectScripts = activeProject?.scripts;
  const serviceTerminalState = useTerminalStateStore((state) =>
    serviceScopeId === null ? undefined : state.terminalStateByThreadId[serviceScopeId],
  );
  const actionTerminalState = useTerminalStateStore((state) =>
    actionScopeId === null ? undefined : state.terminalStateByThreadId[actionScopeId],
  );
  const terminalRunningProjectScriptIds = useMemo(
    () => selectRunningProjectScriptIds(actionTerminalState, serviceTerminalState),
    [actionTerminalState, serviceTerminalState],
  );
  const launchedProjectScriptIds = useMemo(
    () =>
      new Set(
        serviceTerminalState === undefined
          ? []
          : Object.values(serviceTerminalState.projectScriptIdsByTerminalId),
      ),
    [serviceTerminalState],
  );
  const shouldDiscoverProjectServices =
    activeProjectScripts?.some((script) => script.port != null) ?? false;
  const projectLocalServersQuery = useQuery(
    serverLocalServersQueryOptions(shouldDiscoverProjectServices),
  );
  const projectLocalServers = projectLocalServersQuery.data?.servers;
  const runningProjectScriptIds = useMemo(
    () =>
      activeProjectScripts === undefined
        ? terminalRunningProjectScriptIds
        : resolveRunningProjectScriptIds({
            scripts: activeProjectScripts,
            terminalRunningScriptIds: terminalRunningProjectScriptIds,
            launchedScriptIds: launchedProjectScriptIds,
            localServers: projectLocalServers ?? [],
          }),
    [
      activeProjectScripts,
      launchedProjectScriptIds,
      projectLocalServers,
      terminalRunningProjectScriptIds,
    ],
  );
  const stopProjectScript = useCallback(
    async (script: ProjectScript) => {
      const api = readNativeApi();
      const port = script.port;
      const threadId = port != null ? serviceScopeId : actionScopeId;
      if (!api || !activeThreadId || threadId === null) return;
      if (port != null && activeProjectId) abortProjectPreview(activeProjectId);
      const state = selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadId,
        threadId,
      );
      const terminalIds = selectProjectScriptTerminalIds(state, script.id);
      const localServer =
        port != null && !terminalIds.some((id) => state.runningTerminalIds.includes(id))
          ? findLocalServerForProjectScript({
              script,
              localServers: projectLocalServers ?? [],
              launchedScriptIds: launchedProjectScriptIds,
            })
          : null;
      if (localServer && !localServer.isStoppable) {
        setThreadError(
          activeThreadId,
          localServer.stopDisabledReason ??
            `The process running "${script.name}" cannot be stopped.`,
        );
        return;
      }
      const stopFailure = `Failed to stop "${script.name}".`;
      try {
        // A detached service can outlive its shell. Keep its ownership if stopping it fails.
        if (localServer && port != null) {
          const result = await api.server.stopLocalServer({ pid: localServer.pid, port });
          if (!result.stopped) {
            setThreadError(activeThreadId, result.message || stopFailure);
            return;
          }
        }
        await Promise.all(terminalIds.map((id) => closeProjectScriptTerminal(api, threadId, id)));
      } catch (error) {
        setThreadError(activeThreadId, error instanceof Error ? error.message : stopFailure);
      } finally {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.localServers() });
      }
    },
    [
      actionScopeId,
      activeProjectId,
      activeThreadId,
      launchedProjectScriptIds,
      projectLocalServers,
      queryClient,
      serviceScopeId,
      setThreadError,
    ],
  );

  const persistProjectScripts = useCallback(
    async (input: {
      projectId: ProjectId;
      projectCwd: string;
      nextScripts: ProjectScript[];
      keybinding?: string | null;
      keybindingCommand: KeybindingCommand;
    }) => {
      const api = readNativeApi();
      if (!api) return;

      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: input.projectId,
        scripts: input.nextScripts,
      });
      await persistProjectLaunchConfig({
        api,
        queryClient,
        projectId: input.projectId,
        projectCwd: input.projectCwd,
        scripts: input.nextScripts,
      });

      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding: input.keybinding,
        command: input.keybindingCommand,
      });

      if (isElectron && keybindingRule) {
        await api.server.upsertKeybinding({ rule: keybindingRule });
        await queryClient.invalidateQueries({ queryKey: serverQueryKeys.all });
      }
    },
    [queryClient],
  );
  const saveProjectScript = useCallback(
    async (input: NewProjectScriptInput) => {
      if (!activeProject) return;
      const nextId = nextProjectScriptId(
        input.name,
        activeProject.scripts.map((script) => script.id),
      );
      const nextScript: ProjectScript = {
        id: nextId,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
        port: input.port,
      };
      const nextScripts = input.runOnWorktreeCreate
        ? [
            ...activeProject.scripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...activeProject.scripts, nextScript];

      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(nextId),
      });
    },
    [activeProject, persistProjectScripts],
  );
  const updateProjectScript = useCallback(
    async (scriptId: string, input: NewProjectScriptInput) => {
      if (!activeProject) return;
      const existingScript = activeProject.scripts.find((script) => script.id === scriptId);
      if (!existingScript) {
        throw new Error("Script not found.");
      }

      const updatedScript: ProjectScript = {
        ...existingScript,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
        port: input.port,
      };
      const nextScripts = activeProject.scripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );

      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(scriptId),
      });
    },
    [activeProject, persistProjectScripts],
  );
  const deleteProjectScript = useCallback(
    async (scriptId: string) => {
      if (!activeProject) return;
      const nextScripts = activeProject.scripts.filter((script) => script.id !== scriptId);

      const deletedName = activeProject.scripts.find((s) => s.id === scriptId)?.name;
      // Resolved before the `try`: a value block (`??`) inside a try body makes React
      // Compiler bail out on the whole component.
      const deletedScriptToastTitle = `Deleted action "${deletedName ?? "Unknown"}"`;

      try {
        await persistProjectScripts({
          projectId: activeProject.id,
          projectCwd: activeProject.cwd,
          nextScripts,
          keybinding: null,
          keybindingCommand: commandForProjectScript(scriptId),
        });
        toastManager.add({
          type: "success",
          title: deletedScriptToastTitle,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not delete action",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      }
    },
    [activeProject, persistProjectScripts],
  );
  return {
    runProjectScript,
    stopProjectScript,
    runningProjectScriptIds,
    saveProjectScript,
    updateProjectScript,
    deleteProjectScript,
    lastInvokedScriptByProjectId,
  };
}

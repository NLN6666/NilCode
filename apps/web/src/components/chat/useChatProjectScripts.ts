import {
  ThreadId,
  type KeybindingCommand,
  type ProjectId,
  type ProjectScript,
} from "@synara/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useProjectScriptPreview } from "~/hooks/useProjectScriptPreview";
import { dockTerminalThreadId } from "~/lib/dockTerminalScope";
import { persistProjectLaunchConfig } from "~/lib/launchConfigReactQuery";
import { abortProjectPreview } from "~/lib/projectPreviewLauncher";
import { resolveProjectScriptTerminalScope } from "~/lib/projectServiceTerminalScope";
import { decodeProjectScriptKeybindingRule } from "~/lib/projectScriptKeybindings";
import { serverLocalServersQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { newCommandId, randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import {
  commandForProjectScript,
  nextProjectScriptId,
  type ProjectScriptRunOptions,
  type ProjectScriptRunResult,
} from "~/projectScripts";
import { runProjectCommandInTerminal } from "~/projectTerminalRunner";
import { selectRightDockState, useRightDockStore } from "~/rightDockStore";
import { isElectron } from "../../env";
import {
  selectRunningServiceScriptIds,
  selectServiceTerminalIdsForScript,
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
import { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { disposeAndCloseTerminalSession } from "../terminal/terminalSession";
import { randomTerminalId } from "../terminal/terminalIds";
import { toastManager } from "../ui/toast";
const EMPTY_LAST_INVOKED_SCRIPT_BY_PROJECT: Record<string, string> = {};
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
  const pendingScriptThreads = useRef(new Set<ThreadId>());
  const storeEnsureDockTerminal = useTerminalStateStore((state) => state.ensureDockTerminal);
  const storeSetTerminalMetadata = useTerminalStateStore((state) => state.setTerminalMetadata);
  const { startPreview } = useProjectScriptPreview({
    projectId: activeProject?.id ?? null,
    openBrowserUrl,
  });
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    EMPTY_LAST_INVOKED_SCRIPT_BY_PROJECT,
    LastInvokedScriptByProjectSchema,
  );

  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: ProjectScriptRunOptions,
    ): Promise<ProjectScriptRunResult | null> => {
      const api = readNativeApi();
      if (!api || !activeThreadId || !activeProject || !activeThread) return null;
      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject.id] === script.id) return current;
          return { ...current, [activeProject.id]: script.id };
        });
      }
      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.cwd;
      const isService = script.port !== null && script.port !== undefined;
      const terminalThreadId = isService
        ? (resolveProjectScriptTerminalScope({
            isService,
            projectId: activeProject.id,
            threadId: activeThreadId,
          }) ?? activeThreadId)
        : dockTerminalThreadId(activeThreadId);
      const terminalState = selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadId,
        terminalThreadId,
      );
      const dock = isService
        ? null
        : selectRightDockState(activeThreadId)(useRightDockStore.getState());
      const terminalPane =
        dock?.panes.find((pane) => pane.id === dock.activePaneId && pane.kind === "terminal") ??
        dock?.panes.find(
          (pane) =>
            pane.kind === "terminal" &&
            terminalState?.dockTerminalIdsByPaneId?.[pane.id] === terminalState?.activeTerminalId,
        ) ??
        dock?.panes.find((pane) => pane.kind === "terminal");
      const targetPaneId = isService ? script.id : (terminalPane?.id ?? randomUUID());
      const baseTerminalId =
        terminalState.dockTerminalIdsByPaneId?.[targetPaneId] ??
        (isService ? selectServiceTerminalIdsForScript(terminalState, script.id)[0] : undefined);
      if (
        pendingScriptThreads.current.has(terminalThreadId) ||
        (baseTerminalId !== undefined && terminalState?.runningTerminalIds.includes(baseTerminalId))
      ) {
        const error = new Error(
          "The right-side terminal is busy. Stop its command before running another action.",
        );
        setThreadError(activeThreadId, error.message);
        if (options?.throwOnError) throw error;
        return null;
      }
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
            // Attach only after the requested cwd/env are set, but before writing
            // so the session stays accessible if command delivery fails.
            storeEnsureDockTerminal(terminalThreadId, targetPaneId, targetTerminalId);
            // Services stay below the browser; only their terminal ownership changes.
            if (isService) return;
            const dockStore = useRightDockStore.getState();
            if (
              selectRightDockState(activeThreadId)(dockStore).panes.some(
                (pane) => pane.id === targetPaneId,
              )
            ) {
              dockStore.setActivePane(activeThreadId, targetPaneId);
              dockStore.setDockOpen(activeThreadId, true);
            } else {
              dockStore.openPane(activeThreadId, { kind: "terminal", paneId: targetPaneId });
            }
          },
        });
        if (metadata) {
          storeSetTerminalMetadata(terminalThreadId, targetTerminalId, {
            cliKind: metadata.cliKind,
            label: metadata.label,
          });
        }
        if (isService) {
          useTerminalStateStore
            .getState()
            .markTerminalServiceScript(terminalThreadId, targetTerminalId, script.id);
        }
        startPreview(script);
      };

      pendingScriptThreads.current.add(terminalThreadId);
      try {
        // Hydration omits client activity, so the server must verify an owned
        // session is idle. An unmapped pane must never borrow a sibling's ID.
        if (baseTerminalId !== undefined) {
          await disposeAndCloseTerminalSession({
            api,
            threadId: terminalThreadId,
            terminalId: baseTerminalId,
            onlyIfIdle: true,
            deleteHistory: false,
          });
          useTerminalStateStore.getState().closeTerminal(terminalThreadId, baseTerminalId);
        }
        await runScriptInTargetTerminal();
        pendingScriptThreads.current.delete(terminalThreadId);
        return { threadId: terminalThreadId, terminalId: targetTerminalId };
      } catch (error) {
        pendingScriptThreads.current.delete(terminalThreadId);
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
      }
    },
    [
      activeProject,
      activeThread,
      activeThreadId,
      gitCwd,
      isGroupContainer,
      setThreadError,
      storeEnsureDockTerminal,
      storeSetTerminalMetadata,
      setLastInvokedScriptByProjectId,
      startPreview,
    ],
  );

  const activeProjectId = activeProject?.id ?? null;
  const activeProjectCwd = activeProject?.cwd ?? null;
  const activeProjectScripts = activeProject?.scripts;
  const serviceScopeId = resolveProjectScriptTerminalScope({
    isService: true,
    projectId: activeProjectId,
    threadId: activeThreadId,
  });
  const serviceTerminalState = useTerminalStateStore((state) =>
    serviceScopeId === null
      ? null
      : selectThreadTerminalState(state.terminalStateByThreadId, serviceScopeId),
  );
  const terminalRunningProjectScriptIds = useMemo(
    () =>
      serviceTerminalState === null
        ? new Set<string>()
        : selectRunningServiceScriptIds(serviceTerminalState),
    [serviceTerminalState],
  );
  const launchedProjectScriptIds = useMemo(
    () =>
      new Set(
        serviceTerminalState === null
          ? []
          : Object.values(serviceTerminalState.serviceScriptIdsByTerminalId),
      ),
    [serviceTerminalState],
  );
  const shouldDiscoverProjectServices =
    activeProjectCwd !== null &&
    (activeProjectScripts?.some((script) => script.port !== null && script.port !== undefined) ??
      false);
  const projectLocalServersQuery = useQuery(
    serverLocalServersQueryOptions(shouldDiscoverProjectServices),
  );
  const projectLocalServers = projectLocalServersQuery.data?.servers;
  const runningProjectScriptIds = useMemo(
    () =>
      activeProjectCwd === null || activeProjectScripts === undefined
        ? terminalRunningProjectScriptIds
        : resolveRunningProjectScriptIds({
            scripts: activeProjectScripts,
            terminalRunningScriptIds: terminalRunningProjectScriptIds,
            launchedScriptIds: launchedProjectScriptIds,
            localServers: projectLocalServers ?? [],
          }),
    [
      activeProjectCwd,
      activeProjectScripts,
      launchedProjectScriptIds,
      projectLocalServers,
      terminalRunningProjectScriptIds,
    ],
  );
  const stopProjectScript = useCallback(
    (script: ProjectScript) => {
      const api = readNativeApi();
      if (activeProjectId) abortProjectPreview(activeProjectId);
      if (!api || !activeThreadId || serviceScopeId === null || serviceTerminalState === null) {
        return;
      }
      const serviceTerminalIds = selectServiceTerminalIdsForScript(serviceTerminalState, script.id);
      // Interrupt rather than close so the service's diagnostic output remains readable.
      for (const terminalId of serviceTerminalIds) {
        void api.terminal
          .write({ threadId: serviceScopeId, terminalId, data: "\u0003" })
          .finally(() => {
            void queryClient.invalidateQueries({ queryKey: serverQueryKeys.localServers() });
          })
          .catch((error: unknown) => {
            setThreadError(
              activeThreadId,
              error instanceof Error ? error.message : `Failed to stop "${script.name}".`,
            );
          });
      }
      if (serviceTerminalIds.length > 0 || activeProjectCwd === null) return;
      const localServer = findLocalServerForProjectScript({
        script,
        localServers: projectLocalServers ?? [],
        launchedScriptIds: launchedProjectScriptIds,
      });
      const port = script.port;
      if (localServer === null || port === null || port === undefined) return;
      if (!localServer.isStoppable) {
        setThreadError(
          activeThreadId,
          localServer.stopDisabledReason ??
            `The process running "${script.name}" cannot be stopped.`,
        );
        return;
      }
      void api.server
        .stopLocalServer({ pid: localServer.pid, port })
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: serverQueryKeys.localServers() });
        })
        .catch((error: unknown) => {
          setThreadError(
            activeThreadId,
            error instanceof Error ? error.message : `Failed to stop "${script.name}".`,
          );
        });
    },
    [
      activeProjectCwd,
      activeProjectId,
      activeThreadId,
      launchedProjectScriptIds,
      projectLocalServers,
      queryClient,
      serviceScopeId,
      serviceTerminalState,
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

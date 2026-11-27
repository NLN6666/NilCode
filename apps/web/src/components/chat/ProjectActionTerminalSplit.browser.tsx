import "../../index.css";

import type {
  ProjectScript,
  ServerListLocalServersResult,
  ServerStopLocalServerInput,
  ServerStopLocalServerResult,
  TerminalCloseInput,
  TerminalOpenInput,
  TerminalWriteInput,
} from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { setLanguagePreference } from "~/i18n";
import { dockTerminalThreadId } from "~/lib/dockTerminalScope";
import { resolveProjectScriptTerminalScope } from "~/lib/projectServiceTerminalScope";
import { serverQueryKeys } from "~/lib/serverReactQuery";
import { selectRightDockState, useRightDockStore } from "~/rightDockStore";
import { useStore } from "~/store";
import { makeProject, makeThread } from "~/storeTestFixtures";
import { useTerminalStateStore } from "~/terminalStateStore";
import ProjectScriptsControl from "../ProjectScriptsControl";
import { terminalRuntimeRegistry } from "../terminal/terminalRuntimeRegistry";
import { EnvironmentActionsSection } from "./environment/EnvironmentActionsSection";
import { EnvironmentLocalServersSection } from "./environment/EnvironmentLocalServersSection";
import { ProjectActionTerminalSplit } from "./ProjectActionTerminalSplit";
import { RightDock } from "./RightDock";
import { useChatProjectScripts } from "./useChatProjectScripts";

const api = vi.hoisted(() => ({
  server: {
    listLocalServers: vi.fn<() => Promise<ServerListLocalServersResult>>(),
    stopLocalServer:
      vi.fn<(input: ServerStopLocalServerInput) => Promise<ServerStopLocalServerResult>>(),
  },
  terminal: {
    open: vi.fn(async (input: TerminalOpenInput) => ({
      ...input,
      status: "running",
      pid: 123,
      history: input.attachOnly ? "Action output\r\n" : "",
      exitCode: null,
      exitSignal: null,
      updatedAt: new Date().toISOString(),
    })),
    write: vi.fn<(input: TerminalWriteInput) => Promise<void>>(),
    close: vi.fn<(input: TerminalCloseInput) => Promise<void>>(),
    resize: vi.fn(async () => {}),
    ackOutput: vi.fn(async () => {}),
    onEvent: vi.fn(() => () => {}),
  },
}));
vi.mock("../../nativeApi", () => ({ readNativeApi: () => api, ensureNativeApi: () => api }));

beforeEach(() => {
  setLanguagePreference("en");
  api.server.listLocalServers
    .mockReset()
    .mockResolvedValue({ generatedAt: new Date().toISOString(), servers: [] });
  api.server.stopLocalServer.mockReset();
  api.terminal.write.mockReset();
  api.terminal.close.mockReset().mockImplementation(async (input) => {
    if (input.onlyIfIdle) {
      throw new Error("The terminal is busy. Stop its command before running this action.");
    }
  });
});

afterEach(() => {
  terminalRuntimeRegistry.disposeOrphanedThreads(new Set());
  useTerminalStateStore.setState(useTerminalStateStore.getInitialState(), true);
  useRightDockStore.setState(useRightDockStore.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  setLanguagePreference("system");
  vi.clearAllMocks();
});

it.each([
  { entryPoint: "header", port: null },
  { entryPoint: "environment", port: null },
  { entryPoint: "environment", port: 58135 },
  { entryPoint: "local servers", port: null },
] as const)(
  "keeps the busy dock terminal while starting and stopping through $entryPoint (port $port)",
  async ({ entryPoint, port }) => {
    await page.viewport(1280, 800);
    const script: ProjectScript = {
      id: "dev",
      name: "Dev",
      command: "node server.js",
      icon: "play",
      runOnWorktreeCreate: false,
      port,
    };
    const project = makeProject({ scripts: [script] });
    useStore.setState({ projects: [project] });
    const thread = makeThread({ projectId: project.id });
    const scopeId = resolveProjectScriptTerminalScope({
      isService: port !== null,
      projectId: project.id,
      threadId: thread.id,
    })!;
    const dockScopeId = dockTerminalThreadId(thread.id);
    const store = useTerminalStateStore.getState();
    store.ensureDockTerminal(dockScopeId, "manual-pane", "busy-shell");
    store.setTerminalActivity(dockScopeId, "busy-shell", {
      hasRunningSubprocess: true,
      agentState: null,
    });
    const dockStore = useRightDockStore.getState();
    dockStore.openPane(thread.id, { kind: "terminal", paneId: "manual-pane" });
    const before = selectRightDockState(thread.id)(useRightDockStore.getState());
    const setThreadError = vi.fn();
    api.terminal.write.mockImplementation(async ({ threadId, terminalId }) => {
      store.setTerminalActivity(scopeId, terminalId!, {
        hasRunningSubprocess: threadId === scopeId,
        agentState: null,
      });
    });
    function ChatActions() {
      const state = useRightDockStore(selectRightDockState(thread.id));
      const actions = useChatProjectScripts({
        activeThreadId: thread.id,
        activeThread: thread,
        activeProject: project,
        gitCwd: project.cwd,
        isGroupContainer: false,
        setThreadError,
        openBrowserUrl: vi.fn(),
      });
      const controls = {
        scripts: [script],
        keybindings: [],
        runningScriptIds: actions.runningProjectScriptIds,
        onRunScript: (script: ProjectScript) =>
          void actions.runProjectScript(script, { rememberAsLastInvoked: false }),
        onStopScript: actions.stopProjectScript,
        onAddScript: actions.saveProjectScript,
        onUpdateScript: actions.updateProjectScript,
        onDeleteScript: actions.deleteProjectScript,
      };
      return (
        <div className="flex h-[520px] w-full">
          <div className="flex-1">
            {entryPoint === "environment" ? (
              <EnvironmentActionsSection {...controls} />
            ) : (
              <ProjectScriptsControl {...controls} />
            )}
            {entryPoint === "local servers" ? <EnvironmentLocalServersSection enabled /> : null}
          </div>
          <RightDock
            state={state}
            minWidth={320}
            defaultWidth="360px"
            shouldAcceptWidth={() => true}
            addMenuKinds={[]}
            onCollapse={() => {}}
            onOpenChange={() => {}}
            onClosePane={() => {}}
            onAddPane={() => {}}
            renderPane={() => <textarea aria-label="Regular terminal input" />}
            renderBody={(panes) => (
              <ProjectActionTerminalSplit
                hostThreadId={thread.id}
                projectId={project.id}
                isVisible={state.open}
              >
                {panes}
              </ProjectActionTerminalSplit>
            )}
          />
        </div>
      );
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await render(
      <QueryClientProvider client={client}>
        <ChatActions />
      </QueryClientProvider>,
    );
    try {
      const regularTerminal = page.getByRole("textbox", { name: "Regular terminal input" });
      await regularTerminal.fill("keep this input");
      const originalInput = regularTerminal.element();
      if (entryPoint === "environment") {
        await page.getByRole("button", { name: "Actions", exact: true }).click();
      }
      const run = page.getByRole("button", { name: "Run Dev", exact: true });
      const stop = page.getByRole("button", { name: "Stop Dev", exact: true });
      const expand = page.getByRole("button", { name: "Expand terminal for Dev", exact: true });
      await run.click();
      await expect.element(stop).toBeVisible();
      await expect.element(expand).toHaveAttribute("aria-expanded", "false");
      expect(expand.element().getBoundingClientRect().top).toBeGreaterThan(
        originalInput.getBoundingClientRect().bottom,
      );
      expect(api.terminal.close).not.toHaveBeenCalled();
      expect(api.terminal.open).toHaveBeenCalledTimes(1);
      const started = api.terminal.open.mock.calls[0]![0];
      expect(started).toMatchObject({ threadId: scopeId, cwd: project.cwd });
      expect(api.terminal.write).toHaveBeenCalledExactlyOnceWith({
        threadId: scopeId,
        terminalId: started.terminalId,
        data: "node server.js\r",
      });

      await expand.click();
      await expect.element(page.getByRole("complementary", { name: "Terminal" })).toBeVisible();
      await expect
        .poll(() => api.terminal.open.mock.lastCall?.[0])
        .toMatchObject({
          threadId: scopeId,
          terminalId: started.terminalId,
          attachOnly: true,
        });
      await page.getByRole("button", { name: "Collapse terminal for Dev" }).click();
      await expect
        .element(page.getByRole("complementary", { name: "Terminal" }))
        .not.toBeInTheDocument();
      if (entryPoint === "local servers") {
        const pid = 4242;
        const listeningPort = 58135;
        const actionTerminal = { threadId: scopeId, terminalId: started.terminalId! };
        const listing = {
          generatedAt: new Date().toISOString(),
          servers: [
            {
              id: `local-server:${pid}:${listeningPort}`,
              pid,
              command: "node",
              displayName: "Dev listener",
              args: "server.js",
              ports: [listeningPort],
              addresses: [],
              isStoppable: true,
              actionTerminal,
            },
          ],
        };
        api.server.listLocalServers.mockResolvedValue(listing);
        client.setQueryData(serverQueryKeys.localServers(), listing);
        api.server.stopLocalServer.mockImplementationOnce(async () => {
          store.setTerminalActivity(scopeId, started.terminalId!, {
            hasRunningSubprocess: false,
            agentState: null,
          });
          api.server.listLocalServers.mockResolvedValue({ ...listing, servers: [] });
          return { pid, stopped: true, actionTerminal };
        });
        await page.getByRole("button", { name: /^Local Servers/ }).click();
        await page.getByRole("menuitem", { name: "Stop Dev listener" }).click();
        await userEvent.keyboard("{Escape}");
        expect(api.server.stopLocalServer).toHaveBeenCalledExactlyOnceWith({
          pid,
          port: listeningPort,
        });
      } else if (port !== null) {
        api.terminal.close.mockRejectedValueOnce(new Error("Stop failed"));
        await stop.click();
        await expect.poll(() => setThreadError.mock.lastCall?.[1]).toBe("Stop failed");
        await expect.element(expand).toBeVisible();
        api.terminal.close.mockClear();
        setThreadError.mockClear();

        const pid = 4242;
        const listing = {
          generatedAt: new Date().toISOString(),
          servers: [
            {
              id: `local-server:${pid}:${port}`,
              pid,
              command: "node",
              displayName: "node",
              args: "server.js",
              ports: [port],
              addresses: [],
              isStoppable: true,
            },
          ],
        };
        api.server.listLocalServers.mockResolvedValue(listing);
        client.setQueryData(serverQueryKeys.localServers(), listing);
        store.setTerminalActivity(scopeId, started.terminalId!, {
          hasRunningSubprocess: false,
          agentState: null,
        });
        api.server.stopLocalServer
          .mockResolvedValueOnce({ pid, stopped: false, message: "Process is still running" })
          .mockResolvedValueOnce({ pid, stopped: true });
        await stop.click();
        await expect.poll(() => setThreadError.mock.lastCall?.[1]).toBe("Process is still running");
        expect(api.server.stopLocalServer).toHaveBeenCalledExactlyOnceWith({ pid, port });
        expect(api.terminal.close).not.toHaveBeenCalled();
        await expect.element(expand).toBeVisible();
        await expect.element(stop).toBeVisible();
        setThreadError.mockClear();
      }
      if (entryPoint !== "local servers") await stop.click();
      await expect.element(expand).not.toBeInTheDocument();
      await expect.element(run).toBeVisible();
      expect(api.terminal.close).toHaveBeenCalledExactlyOnceWith({
        threadId: scopeId,
        terminalId: started.terminalId,
        deleteHistory: false,
      });
      expect(setThreadError).not.toHaveBeenCalled();
      expect(selectRightDockState(thread.id)(useRightDockStore.getState())).toEqual(before);
      expect(regularTerminal.element()).toBe(originalInput);
      await expect.element(regularTerminal).toHaveValue("keep this input");
      expect(
        useTerminalStateStore.getState().terminalStateByThreadId[dockScopeId]?.runningTerminalIds,
      ).toEqual(["busy-shell"]);
    } finally {
      await view.unmount();
      client.clear();
    }
  },
);

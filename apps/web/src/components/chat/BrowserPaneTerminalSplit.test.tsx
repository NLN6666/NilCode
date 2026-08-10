// FILE: BrowserPaneTerminalSplit.test.tsx
// Purpose: Covers browser service terminal forwarding of selected output to the active composer.
// Layer: Web chat component test

import type { TerminalContextSelection } from "~/lib/terminalContext";
import { SINGLE_CHAT_PANE_SCOPE_ID } from "~/lib/chatPaneScope";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const drawerHarness = vi.hoisted(() => ({
  props: undefined as
    | {
        onAddTerminalContext?: ((selection: TerminalContextSelection) => void) | undefined;
      }
    | undefined,
}));

vi.mock("@synara/shared/threadEnvironment", () => ({
  resolveThreadWorkspaceCwd: () => "D:/workspace",
}));

vi.mock("~/hooks/useTerminalSurfaceController", () => ({
  useTerminalSurfaceController: () => ({
    activeTerminalGroupId: "group-1",
    closeTerminal: () => {},
    closeTerminalGroup: () => {},
    createTerminalTab: () => {},
    focusRequestId: 0,
    handleTerminalSessionExited: () => {},
    moveTerminalToNewGroup: () => {},
    newTerminalGroup: () => {},
    resizeTerminalSplit: () => {},
    setTerminalActivity: () => {},
    setTerminalHeight: () => {},
    setTerminalMetadata: () => {},
    splitDown: () => {},
    splitRight: () => {},
    terminalState: {
      activeTerminalId: "terminal-1",
      runningTerminalIds: [],
      terminalAttentionStatesById: {},
      terminalCliKindsById: {},
      terminalGroups: [],
      terminalHeight: 240,
      terminalIds: ["terminal-1"],
      terminalLabelsById: {},
      terminalOpen: true,
      terminalTitleOverridesById: {},
    },
  }),
}));

vi.mock("~/i18n/context", () => ({
  useMessages: () => ({
    chat: {
      panes: {
        serviceTerminal: {
          collapse: "Collapse terminal",
          expand: "Expand terminal",
          resize: "Resize terminal",
          running: (name: string) => `Running ${name}`,
          runningCount: (count: number) => `Running ${count} services`,
          title: "Service terminal",
        },
      },
    },
  }),
}));

vi.mock("~/lib/icons", () => ({
  TerminalIcon: () => <span />,
}));

vi.mock("~/lib/projectServiceTerminalScope", () => ({
  resolveProjectScriptTerminalScope: () => "service-terminal-scope",
}));

vi.mock("~/lib/utils", () => ({
  cn: (...values: string[]) => values.filter(Boolean).join(" "),
}));

vi.mock("~/projectScripts", () => ({
  projectScriptRuntimeEnv: () => ({}),
}));

vi.mock("~/store", () => ({
  useStore: <T,>(selector: () => T) => selector(),
}));

vi.mock("~/storeSelectors", () => ({
  createProjectSelector: () => () => ({ kind: "project", cwd: "D:/project", scripts: [] }),
  createThreadWorkspaceMetadataSelector: () => () => ({
    envMode: "project",
    workingDirectory: null,
    worktreePath: null,
  }),
}));

vi.mock("~/terminalStateStore", () => ({
  selectRunningServiceScriptIds: () => new Set(),
  useTerminalStateStore: <T,>(selector: (store: { setTerminalOpen: () => void }) => T) =>
    selector({ setTerminalOpen: () => {} }),
}));

vi.mock("./browserTerminalSplit.logic", () => ({
  BROWSER_TERMINAL_DEFAULT_HEIGHT: 240,
  browserTerminalHeightFromDrag: () => 240,
  clampBrowserTerminalHeight: ({ desiredHeight }: { desiredHeight: number }) => desiredHeight,
}));

vi.mock("../ThreadTerminalDrawer", () => ({
  default: (props: typeof drawerHarness.props) => {
    drawerHarness.props = props;
    return <div data-testid="thread-terminal-drawer" />;
  },
}));

vi.mock("../ui/DisclosureChevron", () => ({
  DisclosureChevron: () => <span />,
}));

const { BrowserPaneTerminalSplit } = await import("./BrowserPaneTerminalSplit");
const { registerTerminalContextComposerTarget } = await import(
  "~/lib/terminalContextComposerRegistry"
);

function renderSplit(): void {
  drawerHarness.props = undefined;
  renderToStaticMarkup(
    <BrowserPaneTerminalSplit hostThreadId={"host-thread"} projectId={"project-1"}>
      <div>Browser preview</div>
    </BrowserPaneTerminalSplit>,
  );
}

afterEach(() => {
  drawerHarness.props = undefined;
});

describe("BrowserPaneTerminalSplit", () => {
  it("forwards a service terminal selection through the registered composer target", () => {
    const target = vi.fn();
    const selection: TerminalContextSelection = {
      lineEnd: 3,
      lineStart: 2,
      terminalId: "terminal-1",
      terminalLabel: "Service terminal",
      text: "first\nsecond",
    };
    const cleanup = registerTerminalContextComposerTarget(SINGLE_CHAT_PANE_SCOPE_ID, target);

    renderSplit();
    drawerHarness.props?.onAddTerminalContext?.(selection);

    expect(drawerHarness.props?.onAddTerminalContext).toBe(target);
    expect(target).toHaveBeenCalledExactlyOnceWith(selection);

    cleanup();
  });

  it("does not expose an add-to-chat callback when no composer target is available", () => {
    renderSplit();

    expect(drawerHarness.props?.onAddTerminalContext).toBeUndefined();
  });
});

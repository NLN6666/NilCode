// FILE: BrowserDockPane.browser.tsx
// Purpose: Regressions for project browser sharing — which surface a pane drives, and which
//          pane is allowed to drive it when a project shares one browser.
// Layer: Web browser tests
// Depends on: BrowserDockPane, the surface claim store, and a real React event loop.

import { ProjectId, ThreadId } from "@synara/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useBrowserSurfaceClaimStore } from "~/browserSurfaceClaimStore";
import type { DockPaneRuntimeMode } from "~/lib/dockPaneActivation";
// `vi.mock` calls below are hoisted above this import, so the mocks are in place when it loads.
import { BrowserDockPane } from "./BrowserDockPane";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const PROJECT = ProjectId.makeUnsafe("project-1");

// Records what BrowserPanel was asked to drive. The real panel pulls in the whole chat surface,
// and the contract under test is entirely in the props it receives.
const panelRenders: { surfaceId: string; runtimeMode: DockPaneRuntimeMode }[] = [];
let requestLiveByThreadId: Record<string, (() => void) | undefined> = {};

vi.mock("./ChatThreadSurfacePrimitives", () => ({
  LazyBrowserPanel: (props: {
    threadId: string;
    browserSurfaceId: string;
    runtimeMode: DockPaneRuntimeMode;
    onRequestLive?: () => void;
  }) => {
    panelRenders.push({ surfaceId: props.browserSurfaceId, runtimeMode: props.runtimeMode });
    requestLiveByThreadId[props.threadId] = props.onRequestLive;
    return (
      <div
        data-testid={`panel-${props.threadId}`}
        data-surface={props.browserSurfaceId}
        data-runtime={props.runtimeMode}
      />
    );
  },
}));

let sharing: "shared" | "isolated" = "isolated";

vi.mock("~/store", () => ({
  useStore: (selector: (state: unknown) => unknown) => selector(undefined),
}));

vi.mock("~/storeSelectors", () => ({
  createThreadSelector: (threadId: ThreadId) => () => ({ id: threadId, projectId: PROJECT }),
  createProjectSelector: () => () => ({ id: PROJECT, browserSharing: sharing }),
}));

function TwoPanes() {
  return (
    <>
      <BrowserDockPane threadId={THREAD_A} paneId="pane-a" onClosePanel={() => {}} />
      <BrowserDockPane threadId={THREAD_B} paneId="pane-b" onClosePanel={() => {}} />
    </>
  );
}

describe("BrowserDockPane", () => {
  beforeEach(() => {
    panelRenders.length = 0;
    requestLiveByThreadId = {};
    useBrowserSurfaceClaimStore.setState({ ownerBySurfaceId: {} });
    sharing = "isolated";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives each thread its own surface when the project isolates browsers", async () => {
    const screen = await render(<TwoPanes />);

    await expect
      .element(screen.getByTestId(`panel-${THREAD_A}`))
      .toHaveAttribute("data-surface", THREAD_A);
    await expect
      .element(screen.getByTestId(`panel-${THREAD_B}`))
      .toHaveAttribute("data-surface", THREAD_B);
    // Different surfaces never contend, so both panes stay live.
    await expect
      .element(screen.getByTestId(`panel-${THREAD_A}`))
      .toHaveAttribute("data-runtime", "live");
    await expect
      .element(screen.getByTestId(`panel-${THREAD_B}`))
      .toHaveAttribute("data-runtime", "live");
  });

  it("points both threads at one surface when the project shares its browser", async () => {
    sharing = "shared";
    const screen = await render(<TwoPanes />);

    const sharedSurface = `project-browser:${PROJECT}`;
    await expect
      .element(screen.getByTestId(`panel-${THREAD_A}`))
      .toHaveAttribute("data-surface", sharedSurface);
    await expect
      .element(screen.getByTestId(`panel-${THREAD_B}`))
      .toHaveAttribute("data-surface", sharedSurface);
  });

  // One surface is one native view; two live panes would fight over it.
  it("keeps only one pane live on a shared surface and transfers on request", async () => {
    sharing = "shared";
    const screen = await render(<TwoPanes />);

    await expect
      .element(screen.getByTestId(`panel-${THREAD_A}`))
      .toHaveAttribute("data-runtime", "live");
    await expect
      .element(screen.getByTestId(`panel-${THREAD_B}`))
      .toHaveAttribute("data-runtime", "preview");

    requestLiveByThreadId[THREAD_B]?.();

    await expect
      .element(screen.getByTestId(`panel-${THREAD_B}`))
      .toHaveAttribute("data-runtime", "live");
    await expect
      .element(screen.getByTestId(`panel-${THREAD_A}`))
      .toHaveAttribute("data-runtime", "preview");
  });
});

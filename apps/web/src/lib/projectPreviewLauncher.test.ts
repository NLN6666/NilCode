import { ProjectId, type ProjectScript } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastAdd = vi.fn();
vi.mock("~/components/ui/toast", () => ({
  toastManager: { add: (...args: unknown[]) => toastAdd(...args) },
}));
vi.mock("~/nativeApi", () => ({ readNativeApi: () => null }));

import {
  abortProjectPreview,
  registerProjectPreviewOpener,
  resetProjectPreviewLauncherForTest,
  startProjectPreview,
} from "./projectPreviewLauncher";

const PROJECT_ERP = ProjectId.makeUnsafe("project-erp");
const SERVICE: ProjectScript = {
  id: "erp-seed",
  name: "erp-seed",
  command: "npm run seed",
  icon: "play",
  runOnWorktreeCreate: false,
  port: 5399,
};

/** Readiness overrides: answer on the second probe, with a clock that never really waits. */
function readyOnSecondProbe() {
  let current = 0;
  const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  return {
    probe,
    now: () => current,
    delay: async (ms: number) => {
      current += ms;
    },
    pollIntervalMs: 10,
    timeoutMs: 5_000,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  resetProjectPreviewLauncherForTest();
  toastAdd.mockClear();
});

describe("startProjectPreview", () => {
  // The point of the module: the chat that pressed Run is usually gone by the time the dev
  // server answers, because the user switched to a sibling chat of the same project.
  it("opens in whichever chat of the project is mounted when the port answers", async () => {
    const startingChat = vi.fn();
    const disposeStartingChat = registerProjectPreviewOpener(PROJECT_ERP, startingChat);

    startProjectPreview({
      projectId: PROJECT_ERP,
      script: SERVICE,
      canOpenInApp: true,
      readiness: readyOnSecondProbe(),
    });

    // Thread switch: the starting chat unmounts, a sibling mounts.
    disposeStartingChat();
    const siblingChat = vi.fn();
    registerProjectPreviewOpener(PROJECT_ERP, siblingChat);

    await settle();

    expect(startingChat).not.toHaveBeenCalled();
    expect(siblingChat).toHaveBeenCalledWith("http://localhost:5399");
  });

  it("offers the URL as a toast when no chat of the project is mounted", async () => {
    startProjectPreview({
      projectId: PROJECT_ERP,
      script: SERVICE,
      canOpenInApp: true,
      readiness: readyOnSecondProbe(),
    });

    await settle();

    expect(toastAdd).toHaveBeenCalledTimes(1);
    expect(toastAdd.mock.calls[0]?.[0]).toMatchObject({
      type: "success",
      description: "http://localhost:5399",
    });
  });

  // The in-app browser is an Electron WebContentsView; the web build has nothing to open.
  it("never drives the in-app browser on the web build", async () => {
    const opener = vi.fn();
    registerProjectPreviewOpener(PROJECT_ERP, opener);

    startProjectPreview({
      projectId: PROJECT_ERP,
      script: SERVICE,
      canOpenInApp: false,
      readiness: readyOnSecondProbe(),
    });

    await settle();

    expect(opener).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledTimes(1);
  });

  it("reports an action that never starts serving", async () => {
    const opener = vi.fn();
    registerProjectPreviewOpener(PROJECT_ERP, opener);

    startProjectPreview({
      projectId: PROJECT_ERP,
      script: SERVICE,
      canOpenInApp: true,
      readiness: {
        probe: async () => false,
        now: () => 0,
        delay: async () => {},
        pollIntervalMs: 10,
        timeoutMs: 0,
      },
    });

    await settle();

    expect(opener).not.toHaveBeenCalled();
    expect(toastAdd.mock.calls[0]?.[0]).toMatchObject({ type: "error" });
  });

  it("ignores actions that declare no port", async () => {
    const opener = vi.fn();
    registerProjectPreviewOpener(PROJECT_ERP, opener);

    startProjectPreview({
      projectId: PROJECT_ERP,
      script: { ...SERVICE, port: null },
      canOpenInApp: true,
      readiness: readyOnSecondProbe(),
    });

    await settle();

    expect(opener).not.toHaveBeenCalled();
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it("drops a pending wait once the service is stopped", async () => {
    const opener = vi.fn();
    registerProjectPreviewOpener(PROJECT_ERP, opener);

    startProjectPreview({
      projectId: PROJECT_ERP,
      script: SERVICE,
      canOpenInApp: true,
      readiness: readyOnSecondProbe(),
    });
    abortProjectPreview(PROJECT_ERP);

    await settle();

    expect(opener).not.toHaveBeenCalled();
    expect(toastAdd).not.toHaveBeenCalled();
  });
});

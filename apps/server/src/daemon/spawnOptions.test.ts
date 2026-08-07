import { describe, expect, it } from "vitest";

import { daemonSpawnOptions } from "./spawnOptions";

describe("daemonSpawnOptions", () => {
  it("detaches on Windows — the source implementation does not, and that is a bug here", () => {
    // Regression guard for findings.md #1: oh-my-pi sets `detached: false` on Windows,
    // which under node:child_process kills the child the moment the parent exits.
    const options = daemonSpawnOptions({ detached: true, platform: "win32", logFd: 7 });

    expect(options.detached).toBe(true);
    expect(options.windowsHide).toBe(true);
  });

  it("detaches on POSIX", () => {
    const options = daemonSpawnOptions({ detached: true, platform: "linux", logFd: 7 });

    expect(options.detached).toBe(true);
  });

  it("does not detach a supervised daemon", () => {
    expect(daemonSpawnOptions({ detached: false, platform: "win32", logFd: 7 }).detached).toBe(
      false,
    );
    expect(daemonSpawnOptions({ detached: false, platform: "linux", logFd: 7 }).detached).toBe(
      false,
    );
  });

  it("routes stdout and stderr to the log fd and discards stdin", () => {
    const options = daemonSpawnOptions({ detached: true, platform: "linux", logFd: 7 });

    expect(options.stdio).toEqual(["ignore", 7, 7]);
  });

  it("hides the console window on Windows even when supervised", () => {
    expect(daemonSpawnOptions({ detached: false, platform: "win32", logFd: 3 }).windowsHide).toBe(
      true,
    );
  });
});

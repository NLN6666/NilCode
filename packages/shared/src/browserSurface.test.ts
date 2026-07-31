import { ProjectId, ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  PROJECT_BROWSER_SURFACE_PREFIX,
  projectBrowserSurfaceId,
  resolveBrowserSurfaceId,
} from "./browserSurface";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const PROJECT = ProjectId.makeUnsafe("project-1");
const OTHER_PROJECT = ProjectId.makeUnsafe("project-2");

describe("resolveBrowserSurfaceId", () => {
  it("gives every thread its own surface when the project is isolated", () => {
    expect(
      resolveBrowserSurfaceId({ threadId: THREAD_A, projectId: PROJECT, sharing: "isolated" }),
    ).toBe(THREAD_A);
    expect(
      resolveBrowserSurfaceId({ threadId: THREAD_B, projectId: PROJECT, sharing: "isolated" }),
    ).toBe(THREAD_B);
  });

  it("collapses every thread of a shared project onto one surface", () => {
    const first = resolveBrowserSurfaceId({
      threadId: THREAD_A,
      projectId: PROJECT,
      sharing: "shared",
    });
    const second = resolveBrowserSurfaceId({
      threadId: THREAD_B,
      projectId: PROJECT,
      sharing: "shared",
    });

    expect(first).toBe(second);
    expect(first).toBe(projectBrowserSurfaceId(PROJECT));
  });

  it("keeps shared projects from bleeding into each other", () => {
    expect(
      resolveBrowserSurfaceId({ threadId: THREAD_A, projectId: PROJECT, sharing: "shared" }),
    ).not.toBe(
      resolveBrowserSurfaceId({ threadId: THREAD_A, projectId: OTHER_PROJECT, sharing: "shared" }),
    );
  });

  // A shared surface reaches the same IPC slot as a thread id, so a collision would hand one
  // thread another thread's browser.
  it("namespaces project surfaces away from thread ids", () => {
    expect(projectBrowserSurfaceId(PROJECT)).toBe(
      `${PROJECT_BROWSER_SURFACE_PREFIX}${PROJECT}` as ThreadId,
    );
    expect(projectBrowserSurfaceId(PROJECT)).not.toBe(THREAD_A);
  });

  it("falls back to the thread surface when sharing cannot apply", () => {
    for (const sharing of ["shared", "isolated", null, undefined] as const) {
      expect(resolveBrowserSurfaceId({ threadId: THREAD_A, projectId: null, sharing })).toBe(
        THREAD_A,
      );
    }
    for (const sharing of [null, undefined] as const) {
      expect(resolveBrowserSurfaceId({ threadId: THREAD_A, projectId: PROJECT, sharing })).toBe(
        THREAD_A,
      );
    }
  });
});

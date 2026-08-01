import { ProjectId, ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveProjectScriptTerminalScope } from "./projectServiceTerminalScope";

const PROJECT_ERP = ProjectId.makeUnsafe("project-erp");
const PROJECT_OTHER = ProjectId.makeUnsafe("project-other");
const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");

describe("resolveProjectScriptTerminalScope", () => {
  // The whole point: start erp-seed in one chat, see it from every other chat of that project.
  it("gives every thread of a project the same service scope", () => {
    const fromA = resolveProjectScriptTerminalScope({
      isService: true,
      projectId: PROJECT_ERP,
      threadId: THREAD_A,
    });
    const fromB = resolveProjectScriptTerminalScope({
      isService: true,
      projectId: PROJECT_ERP,
      threadId: THREAD_B,
    });

    expect(fromA).toBe(fromB);
    expect(fromA).not.toBe(THREAD_A);
  });

  it("keeps projects apart so one dev server never answers for another", () => {
    expect(
      resolveProjectScriptTerminalScope({
        isService: true,
        projectId: PROJECT_ERP,
        threadId: THREAD_A,
      }),
    ).not.toBe(
      resolveProjectScriptTerminalScope({
        isService: true,
        projectId: PROJECT_OTHER,
        threadId: THREAD_A,
      }),
    );
  });

  // A test or build run has no port to collide on and belongs to whoever asked for it.
  it("leaves non-service runs in the calling chat", () => {
    expect(
      resolveProjectScriptTerminalScope({
        isService: false,
        projectId: PROJECT_ERP,
        threadId: THREAD_A,
      }),
    ).toBe(THREAD_A);
  });

  it("falls back to the chat's own scope when there is no project to share with", () => {
    expect(
      resolveProjectScriptTerminalScope({
        isService: true,
        projectId: null,
        threadId: THREAD_A,
      }),
    ).toBe(THREAD_A);
  });
});

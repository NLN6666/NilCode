// FILE: userMessageCollapse.test.ts
// Purpose: Covers shared user-message collapse and overflow-measurement policy.
// Layer: Web chat utility tests

import { describe, expect, it } from "vitest";

import {
  COLLAPSED_USER_MESSAGE_DIRECT_FIT_MAX_CHARS,
  userMessageDefinitelyFitsCollapsedView,
} from "./userMessageCollapse";

describe("userMessageDefinitelyFitsCollapsedView", () => {
  it("skips measurement only for short plain text without inline decorations", () => {
    expect(
      userMessageDefinitelyFitsCollapsedView("Inspect the renderer and summarize the result.", {
        hasMentionReferences: false,
        hasTerminalContexts: false,
      }),
    ).toBe(true);
  });

  it("keeps measuring content that can change rendered height", () => {
    const options = { hasMentionReferences: false, hasTerminalContexts: false };

    expect(
      userMessageDefinitelyFitsCollapsedView(
        "x".repeat(COLLAPSED_USER_MESSAGE_DIRECT_FIT_MAX_CHARS + 1),
        options,
      ),
    ).toBe(false);
    expect(userMessageDefinitelyFitsCollapsedView("line one\nline two", options)).toBe(false);
    expect(userMessageDefinitelyFitsCollapsedView("**formatted**", options)).toBe(false);
    expect(
      userMessageDefinitelyFitsCollapsedView("short text", {
        ...options,
        hasMentionReferences: true,
      }),
    ).toBe(false);
    expect(
      userMessageDefinitelyFitsCollapsedView("short text", {
        ...options,
        hasTerminalContexts: true,
      }),
    ).toBe(false);
  });
});

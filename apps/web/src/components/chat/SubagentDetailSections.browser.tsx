// FILE: SubagentDetailSections.browser.tsx
// Purpose: Browser characterization for the subagent conversation preview's lazy
//          subscription — effects only run in a real DOM, so the "no retain while
//          collapsed" guarantee cannot be asserted from an SSR markup test.
// Layer: Browser UI test

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const harness = vi.hoisted(() => {
  const release = vi.fn();
  return {
    release,
    retain: vi.fn(() => release),
    messages: [
      {
        id: "message-1",
        role: "user",
        text: "Find the changelog",
        createdAt: "",
        streaming: false,
      },
      {
        id: "message-2",
        role: "assistant",
        text: "Found it in CHANGELOG.md",
        createdAt: "",
        streaming: false,
      },
    ] as unknown[],
  };
});

vi.mock("../../threadDetailSubscriptionRetention", () => ({
  retainThreadDetailSubscription: harness.retain,
}));

vi.mock("../../store", () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock("../../threadDerivation", () => ({
  getThreadFromState: () => ({ messages: harness.messages }),
}));

import { SubagentDetailSections } from "./SubagentDetailSections";

function renderStrip() {
  return render(
    <SubagentDetailSections
      subagents={[
        {
          threadId: "subagent:parent:a",
          resolvedThreadId: "thread-a",
          nickname: "Scout",
          model: "claude-opus-4-6",
        },
        {
          threadId: "subagent:parent:b",
          resolvedThreadId: "thread-b",
          nickname: "Digger",
        },
      ]}
      chatTypographyStyle={{ fontSize: "14px" }}
      footerTextStyle={{ fontSize: "11px" }}
      onOpenThread={() => {}}
    />,
  );
}

afterEach(() => {
  harness.retain.mockClear();
  harness.release.mockClear();
  document.body.innerHTML = "";
});

describe("SubagentDetailSections conversation preview", () => {
  it("retains no thread detail while every preview stays collapsed", async () => {
    await renderStrip();

    expect(page.getByRole("button", { name: "Show conversation" }).elements()).toHaveLength(2);
    expect(harness.retain).not.toHaveBeenCalled();
  });

  it("retains exactly once when a preview is expanded, and releases on collapse", async () => {
    await renderStrip();

    const toggle = page.getByRole("button", { name: "Show conversation" }).first();
    await toggle.click();

    await vi.waitFor(() => expect(harness.retain).toHaveBeenCalledTimes(1));
    expect(harness.retain).toHaveBeenCalledWith("thread-a");
    // Only the expanded child subscribes; its sibling stays cold.
    expect(harness.retain).not.toHaveBeenCalledWith("thread-b");
    expect(document.body.textContent).toContain("Found it in CHANGELOG.md");
    expect(harness.release).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Hide conversation" }).click();
    await vi.waitFor(() => expect(harness.release).toHaveBeenCalledTimes(1));
  });

  it("does not accumulate subscriptions across repeated expand/collapse cycles", async () => {
    await renderStrip();

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.getByRole("button", { name: "Show conversation" }).first().click();
      await vi.waitFor(() => expect(harness.retain).toHaveBeenCalledTimes(cycle + 1));
      await page.getByRole("button", { name: "Hide conversation" }).click();
      await vi.waitFor(() => expect(harness.release).toHaveBeenCalledTimes(cycle + 1));
    }

    // Every retain was matched by a release: no lease outlives its disclosure.
    expect(harness.retain).toHaveBeenCalledTimes(3);
    expect(harness.release).toHaveBeenCalledTimes(3);
  });

  it("keeps the preview mounted while collapsed so the shell can animate closed", async () => {
    await renderStrip();

    // The collapsed region is inert but still holds its content; unmounting it
    // would strip the height the grid shell animates from.
    const inertShell = document.querySelector("div[inert]");
    expect(inertShell?.className).toContain("duration-220");
    expect(inertShell?.textContent ?? "").not.toBe("");
  });
});

describe("SubagentDetailSections open-full-conversation routing", () => {
  it("prefers the subagent opener so the child docks beside its parent", async () => {
    const onOpenThread = vi.fn();
    const onOpenSubagentThread = vi.fn();
    await render(
      <SubagentDetailSections
        subagents={[
          { threadId: "subagent:parent:a", resolvedThreadId: "thread-a", nickname: "Scout" },
        ]}
        chatTypographyStyle={{ fontSize: "14px" }}
        footerTextStyle={{ fontSize: "11px" }}
        onOpenThread={onOpenThread}
        onOpenSubagentThread={onOpenSubagentThread}
      />,
    );

    await page.getByRole("button", { name: "Open full conversation" }).click();

    expect(onOpenSubagentThread).toHaveBeenCalledWith("thread-a");
    // Falling through to plain navigation would replace the parent view instead.
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it("falls back to plain navigation for hosts that pass no subagent opener", async () => {
    const onOpenThread = vi.fn();
    await render(
      <SubagentDetailSections
        subagents={[
          { threadId: "subagent:parent:a", resolvedThreadId: "thread-a", nickname: "Scout" },
        ]}
        chatTypographyStyle={{ fontSize: "14px" }}
        footerTextStyle={{ fontSize: "11px" }}
        onOpenThread={onOpenThread}
      />,
    );

    await page.getByRole("button", { name: "Open full conversation" }).click();

    expect(onOpenThread).toHaveBeenCalledWith("thread-a");
  });
});

// FILE: MessageTrail.browser.tsx
// Purpose: Browser regressions for the message-navigation rail's scroll hot path.
// Layer: Chat transcript browser tests

import "../../index.css";

import { MessageId } from "@synara/contracts";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { MessageTrail } from "./MessageTrail";
import { createActiveTrailStore, type MessageTrailItem } from "./messageTrail.logic";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settleLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

function trailItems(count: number): MessageTrailItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: MessageId.makeUnsafe(`user-${index}`),
    ordinal: index + 1,
    preview: `Message ${index + 1}`,
    responsePreview: `Response ${index + 1}`,
    attachmentCount: 0,
  }));
}

describe("MessageTrail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("updates scroll highlights without rerendering or rewriting every tick", async () => {
    const items = trailItems(100);
    const activeStore = createActiveTrailStore();
    activeStore.set({ currentId: items[0]!.id, visibleIds: [items[0]!.id] });
    let commitCount = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      commitCount += 1;
    };

    const host = document.createElement("div");
    host.style.cssText = "position:relative;width:1000px;height:600px;";
    document.body.append(host);
    const screen = await render(
      <Profiler id="message-trail" onRender={onRender}>
        <MessageTrail items={items} activeStore={activeStore} onSelect={() => {}} />
      </Profiler>,
      { container: host },
    );

    try {
      await settleLayout();
      const ticks = Array.from(screen.container.querySelectorAll<HTMLButtonElement>("button"));
      expect(ticks).toHaveLength(100);
      const baselineCommitCount = commitCount;
      let tickAttributeMutations = 0;
      const observer = new MutationObserver((records) => {
        tickAttributeMutations += records.length;
      });
      for (const tick of ticks) {
        observer.observe(tick, {
          attributes: true,
          attributeFilter: ["style", "aria-current"],
        });
      }

      activeStore.set({ currentId: items[50]!.id, visibleIds: [items[50]!.id] });
      await settleLayout();
      observer.disconnect();

      expect(commitCount).toBe(baselineCommitCount);
      expect(ticks[0]!.style.opacity).toBe("0.2");
      expect(ticks[0]!.getAttribute("aria-current")).toBeNull();
      expect(ticks[50]!.style.opacity).toBe("0.9");
      expect(ticks[50]!.getAttribute("aria-current")).toBe("location");
      expect(tickAttributeMutations).toBeLessThanOrEqual(8);
    } finally {
      await screen.unmount();
    }
  });
});

// FILE: ReasoningStreamRegion.browser.tsx
// Purpose: Browser regressions for the streaming reasoning region's height
//          contract - fit the trace, cap the growth, scroll past the cap - and
//          for the panel chrome that makes it readable as a scrollable box.
// Layer: Vitest browser tests

import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ReasoningStreamRegion } from "./ReasoningStreamRegion";

const FONT_SIZE_PX = 13;

async function mount(text: string) {
  render(<ReasoningStreamRegion text={text} fontSizePx={FONT_SIZE_PX} />);
  return await vi.waitFor(() => {
    const region = document.querySelector<HTMLElement>('[data-reasoning-stream-region="true"]');
    const scroller = document.querySelector<HTMLElement>('[data-reasoning-stream-scroller="true"]');
    if (!region || !scroller || scroller.scrollHeight === 0) {
      throw new Error("reasoning stream region did not render");
    }
    return { region, scroller };
  });
}

const LONG_TRACE = Array.from(
  { length: 24 },
  (_, index) => `Line ${index} of a reasoning trace that runs well past the visible cap.`,
).join("\n\n");

describe("ReasoningStreamRegion", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // The regression: a fixed height reserved the cap outright, so a one-line trace
  // sat pinned to the top of a mostly empty box.
  it("fits a short trace instead of reserving the full cap", async () => {
    const short = await mount("Checking the migration path.");
    const shortHeight = short.region.getBoundingClientRect().height;
    expect(shortHeight).toBeGreaterThan(0);
    // Nothing to scroll, so no top fade washing out the only line.
    expect(short.scroller.scrollHeight).toBeLessThanOrEqual(short.scroller.clientHeight + 1);
    expect(short.region.querySelector("[aria-hidden='true']")).toBeNull();

    document.body.innerHTML = "";

    const long = await mount(LONG_TRACE);
    expect(long.region.getBoundingClientRect().height).toBeGreaterThan(shortHeight);
    expect(long.scroller.scrollHeight).toBeGreaterThan(long.scroller.clientHeight);
    expect(long.region.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("caps growth so a longer trace scrolls rather than pushing the transcript down", async () => {
    const long = await mount(LONG_TRACE);
    const cappedHeight = long.region.getBoundingClientRect().height;
    const longScrollHeight = long.scroller.scrollHeight;

    document.body.innerHTML = "";

    const longer = await mount(`${LONG_TRACE}\n\n${LONG_TRACE}`);
    expect(longer.region.getBoundingClientRect().height).toBe(cappedHeight);
    expect(longer.scroller.scrollHeight).toBeGreaterThan(longScrollHeight);
  });

  // The trace has to read as its own surface, not as loose gray text sitting in the
  // transcript, so the panel must actually paint a fill and a border.
  it("paints a bounded panel distinct from the transcript background", async () => {
    const { region } = await mount("Checking the migration path.");
    const style = getComputedStyle(region);
    const bodyBackground = getComputedStyle(document.body).backgroundColor;

    expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.backgroundColor).not.toBe(bodyBackground);
    expect(Number.parseFloat(style.borderTopWidth)).toBeGreaterThan(0);
    expect(Number.parseFloat(style.borderTopLeftRadius)).toBeGreaterThan(0);
  });

  // Auto-follow pins the newest line, but the reader must still be able to go back
  // up through the clipped trace without leaving the panel.
  it("lets the reader scroll back through a clipped trace", async () => {
    const { scroller } = await mount(LONG_TRACE);
    // Auto-follow parked the view at the live tail.
    expect(scroller.scrollTop).toBeGreaterThan(0);

    scroller.scrollTop = 0;
    expect(scroller.scrollTop).toBe(0);

    scroller.scrollTop = scroller.scrollHeight;
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });
});

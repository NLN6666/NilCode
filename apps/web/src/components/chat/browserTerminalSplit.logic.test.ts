// FILE: browserTerminalSplit.logic.test.ts
// Purpose: Lock the sizing rules for the browser/terminal vertical split.
// Layer: Web chat right-dock tests

import { describe, expect, it } from "vitest";

import {
  BROWSER_TERMINAL_MIN_HEIGHT,
  BROWSER_TERMINAL_MIN_PREVIEW_HEIGHT,
  browserTerminalHeightFromDrag,
  clampBrowserTerminalHeight,
} from "./browserTerminalSplit.logic";

describe("clampBrowserTerminalHeight", () => {
  it("keeps a comfortable height untouched", () => {
    expect(clampBrowserTerminalHeight({ desiredHeight: 240, containerHeight: 800 })).toBe(240);
  });

  it("holds the terminal minimum", () => {
    expect(clampBrowserTerminalHeight({ desiredHeight: 10, containerHeight: 800 })).toBe(
      BROWSER_TERMINAL_MIN_HEIGHT,
    );
  });

  it("leaves the preview its minimum when the terminal is dragged tall", () => {
    expect(clampBrowserTerminalHeight({ desiredHeight: 9_000, containerHeight: 800 })).toBe(
      800 - BROWSER_TERMINAL_MIN_PREVIEW_HEIGHT,
    );
  });

  it("splits evenly when the pane cannot satisfy both minimums", () => {
    // 200px cannot host a 120px terminal plus a 160px preview.
    expect(clampBrowserTerminalHeight({ desiredHeight: 180, containerHeight: 200 })).toBe(100);
  });

  it("falls back to the terminal minimum before the pane has been measured", () => {
    expect(clampBrowserTerminalHeight({ desiredHeight: 40, containerHeight: 0 })).toBe(
      BROWSER_TERMINAL_MIN_HEIGHT,
    );
  });
});

describe("browserTerminalHeightFromDrag", () => {
  it("grows the terminal when the handle is dragged up", () => {
    expect(
      browserTerminalHeightFromDrag({
        startHeight: 200,
        startPointerY: 500,
        pointerY: 440,
        containerHeight: 800,
      }),
    ).toBe(260);
  });

  it("shrinks the terminal when the handle is dragged down, still clamped", () => {
    expect(
      browserTerminalHeightFromDrag({
        startHeight: 200,
        startPointerY: 500,
        pointerY: 700,
        containerHeight: 800,
      }),
    ).toBe(BROWSER_TERMINAL_MIN_HEIGHT);
  });
});

import { describe, expect, it } from "vitest";

import {
  resolveTerminalSelectionActionPosition,
  resolveTerminalSelectionAnchorRect,
  resolveTerminalSelectionContextMenuItems,
  shouldHandleTerminalSelectionMouseUp,
  terminalSelectionActionDelayForClickCount,
} from "./terminal/terminalSelectionActions";

describe("resolveTerminalSelectionActionPosition", () => {
  it("labels Add to chat with the caller's localized copy", () => {
    expect(resolveTerminalSelectionContextMenuItems(false, "添加到对话")).toEqual([]);
    expect(resolveTerminalSelectionContextMenuItems(true, "添加到对话")).toEqual([
      { id: "add-to-chat", label: "添加到对话" },
    ]);
  });

  it("prefers the selection rect over the last pointer position", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: { right: 260, bottom: 140 },
        pointer: { x: 520, y: 200 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 260,
      y: 144,
    });
  });

  it("falls back to the pointer position when no selection rect is available", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 180, y: 130 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 180,
      y: 130,
    });
  });

  it("clamps the pointer fallback into the terminal drawer bounds", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 720, y: 340 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 600,
      y: 270,
    });

    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 40, y: 20 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 100,
      y: 50,
    });
  });

  it("delays multi-click selection actions so triple-click selection can complete", () => {
    expect(terminalSelectionActionDelayForClickCount(1)).toBe(0);
    expect(terminalSelectionActionDelayForClickCount(2)).toBe(260);
    expect(terminalSelectionActionDelayForClickCount(3)).toBe(260);
  });

  it("only handles mouseup when the selection gesture started in the terminal", () => {
    expect(shouldHandleTerminalSelectionMouseUp(true, 0)).toBe(true);
    expect(shouldHandleTerminalSelectionMouseUp(false, 0)).toBe(false);
    expect(shouldHandleTerminalSelectionMouseUp(true, 1)).toBe(false);
  });
});

// The terminal renders through the WebGL addon, so its text has no DOM nodes and
// window.getSelection() cannot describe the selection. These anchors come from
// xterm's own cell coordinates instead.
describe("resolveTerminalSelectionAnchorRect", () => {
  const screenRect = { left: 100, top: 50, width: 800, height: 400 };

  it("anchors to the bottom-right of the last selected cell", () => {
    // 80 cols over 800px -> 10px cells; 20 rows over 400px -> 20px cells.
    expect(
      resolveTerminalSelectionAnchorRect({
        screenRect,
        cols: 80,
        rows: 20,
        endColumn: 12,
        endRow: 3,
      }),
    ).toEqual({ right: 220, bottom: 130 });
  });

  it("returns null when the selection scrolled out of the viewport", () => {
    expect(
      resolveTerminalSelectionAnchorRect({
        screenRect,
        cols: 80,
        rows: 20,
        endColumn: 12,
        endRow: -1,
      }),
    ).toBeNull();
    expect(
      resolveTerminalSelectionAnchorRect({
        screenRect,
        cols: 80,
        rows: 20,
        endColumn: 12,
        endRow: 20,
      }),
    ).toBeNull();
  });

  it("clamps a column past the last cell back onto the row", () => {
    expect(
      resolveTerminalSelectionAnchorRect({
        screenRect,
        cols: 80,
        rows: 20,
        endColumn: 999,
        endRow: 0,
      }),
    ).toEqual({ right: 900, bottom: 70 });
  });

  it("returns null for a terminal that has not been measured yet", () => {
    expect(
      resolveTerminalSelectionAnchorRect({
        screenRect: { left: 0, top: 0, width: 0, height: 0 },
        cols: 80,
        rows: 20,
        endColumn: 4,
        endRow: 1,
      }),
    ).toBeNull();
    expect(
      resolveTerminalSelectionAnchorRect({ screenRect, cols: 0, rows: 0, endColumn: 4, endRow: 1 }),
    ).toBeNull();
  });
});

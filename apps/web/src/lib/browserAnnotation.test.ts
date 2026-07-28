import { describe, expect, it, vi } from "vitest";

import {
  ANNOTATION_DEFAULT_COLOR,
  ANNOTATION_DEFAULT_FONT_SIZE,
  ANNOTATION_DEFAULT_LINE_WIDTH,
  ANNOTATION_HISTORY_MAX_DEPTH,
  ANNOTATION_MOSAIC_BLOCK_SIZE,
  ANNOTATION_PEN_MIN_POINT_DISTANCE_PX,
  ANNOTATION_TEXT_MAX_CHARS,
  appendPenPoint,
  canRedoAnnotation,
  canUndoAnnotation,
  clearAnnotations,
  commitAnnotationItem,
  createAnnotationHistory,
  createDragItem,
  createPenItem,
  createTextItem,
  hasVisibleItems,
  normalizeRect,
  redoAnnotation,
  renderAnnotationScene,
  setDragItemEnd,
  toBitmapPoint,
  undoAnnotation,
  type AnnotationItem,
  type AnnotationPenItem,
} from "./browserAnnotation";

const BASE_IMAGE = { width: 100, height: 50 } as unknown as CanvasImageSource;

function penItem(points: Array<{ x: number; y: number }>): AnnotationPenItem {
  return {
    id: "pen-1",
    tool: "pen",
    color: ANNOTATION_DEFAULT_COLOR,
    lineWidth: ANNOTATION_DEFAULT_LINE_WIDTH,
    points,
  };
}

function mockContext() {
  // imageSmoothingEnabled is tracked through an accessor so a test can prove it was turned
  // off for the mosaic pass, not merely that it ended up restored.
  const smoothingWrites: boolean[] = [];
  let smoothing = true;
  return {
    canvas: { width: 200, height: 100 },
    smoothingWrites,
    get imageSmoothingEnabled() {
      return smoothing;
    },
    set imageSmoothingEnabled(value: boolean) {
      smoothing = value;
      smoothingWrites.push(value);
    },
    strokeStyle: "",
    fillStyle: "",
    font: "",
    textBaseline: "alphabetic",
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter",
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    strokeRect: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    stroke: vi.fn(),
  };
}

function render(context: ReturnType<typeof mockContext>, items: AnnotationItem[]) {
  renderAnnotationScene(context as unknown as CanvasRenderingContext2D, BASE_IMAGE, items);
}

describe("item factories", () => {
  it("creates a pen item with one point", () => {
    const item = createPenItem({
      color: "#ff0000",
      lineWidth: 3,
      point: { x: 1, y: 2 },
    });

    expect(item.tool).toBe("pen");
    expect(item.points).toEqual([{ x: 1, y: 2 }]);
    expect(item.id.length).toBeGreaterThan(0);
  });

  it("creates drag items that start collapsed on the press point", () => {
    for (const tool of ["rect", "arrow", "mosaic"] as const) {
      const item = createDragItem({
        tool,
        color: "#ff0000",
        lineWidth: 3,
        start: { x: 5, y: 6 },
      });

      expect(item.tool).toBe(tool);
      expect(item.start).toEqual({ x: 5, y: 6 });
      expect(item.end).toEqual({ x: 5, y: 6 });
    }
  });

  it("gives mosaic items a block size and no color field", () => {
    const item = createDragItem({
      tool: "mosaic",
      color: "#ff0000",
      lineWidth: 3,
      start: { x: 0, y: 0 },
    });

    expect(item).toEqual({
      id: expect.any(String),
      tool: "mosaic",
      blockSize: ANNOTATION_MOSAIC_BLOCK_SIZE,
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
    });
  });

  it("truncates over-long text", () => {
    const item = createTextItem({
      color: ANNOTATION_DEFAULT_COLOR,
      fontSize: ANNOTATION_DEFAULT_FONT_SIZE,
      text: "x".repeat(ANNOTATION_TEXT_MAX_CHARS + 40),
      at: { x: 0, y: 0 },
    });

    expect(item?.text).toHaveLength(ANNOTATION_TEXT_MAX_CHARS);
  });

  it("drops blank text instead of creating an empty item", () => {
    expect(
      createTextItem({
        color: ANNOTATION_DEFAULT_COLOR,
        fontSize: ANNOTATION_DEFAULT_FONT_SIZE,
        text: "   \n  ",
        at: { x: 0, y: 0 },
      }),
    ).toBeNull();
  });
});

describe("appendPenPoint", () => {
  it("appends without mutating the source item", () => {
    const original = penItem([{ x: 0, y: 0 }]);
    const next = appendPenPoint(original, { x: 0, y: 20 });

    expect(next).not.toBe(original);
    expect(original.points).toHaveLength(1);
    expect(next.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 20 },
    ]);
  });

  it("drops points inside the jitter threshold", () => {
    const original = penItem([{ x: 0, y: 0 }]);

    expect(appendPenPoint(original, { x: ANNOTATION_PEN_MIN_POINT_DISTANCE_PX / 2, y: 0 })).toBe(
      original,
    );
  });
});

describe("setDragItemEnd", () => {
  it("moves only the end point and returns a new item", () => {
    const original = createDragItem({
      tool: "rect",
      color: ANNOTATION_DEFAULT_COLOR,
      lineWidth: 2,
      start: { x: 10, y: 10 },
    });
    const dragged = setDragItemEnd(original, { x: 40, y: 60 });

    expect(dragged).not.toBe(original);
    expect(original.end).toEqual({ x: 10, y: 10 });
    expect(dragged.end).toEqual({ x: 40, y: 60 });
  });
});

describe("normalizeRect", () => {
  it("handles a forward drag", () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it("handles a reverse drag from bottom-right to top-left", () => {
    expect(normalizeRect({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });
});

describe("annotation history", () => {
  const visiblePen = penItem([
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ]);

  it("starts empty", () => {
    const history = createAnnotationHistory();

    expect(history).toEqual({ past: [], present: [], future: [] });
    expect(canUndoAnnotation(history)).toBe(false);
    expect(canRedoAnnotation(history)).toBe(false);
    expect(hasVisibleItems(history)).toBe(false);
  });

  it("ignores items that paint nothing", () => {
    const history = createAnnotationHistory();

    expect(commitAnnotationItem(history, penItem([{ x: 1, y: 1 }]))).toBe(history);
  });

  it("commits an item and clears the redo branch", () => {
    const committed = commitAnnotationItem(createAnnotationHistory(), visiblePen);

    expect(committed.present).toEqual([visiblePen]);
    expect(committed.past).toEqual([[]]);
    expect(committed.future).toEqual([]);
    expect(hasVisibleItems(committed)).toBe(true);
  });

  it("round-trips through undo and redo", () => {
    const committed = commitAnnotationItem(createAnnotationHistory(), visiblePen);
    const undone = undoAnnotation(committed);

    expect(undone.present).toEqual([]);
    expect(canRedoAnnotation(undone)).toBe(true);
    expect(redoAnnotation(undone).present).toEqual([visiblePen]);
  });

  it("adds and removes every tool through the same history", () => {
    const items: AnnotationItem[] = [
      visiblePen,
      {
        id: "rect-1",
        tool: "rect",
        color: ANNOTATION_DEFAULT_COLOR,
        lineWidth: 2,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
      },
      {
        id: "arrow-1",
        tool: "arrow",
        color: ANNOTATION_DEFAULT_COLOR,
        lineWidth: 2,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
      },
      {
        id: "text-1",
        tool: "text",
        color: ANNOTATION_DEFAULT_COLOR,
        fontSize: ANNOTATION_DEFAULT_FONT_SIZE,
        text: "note",
        at: { x: 4, y: 4 },
      },
      {
        id: "mosaic-1",
        tool: "mosaic",
        blockSize: ANNOTATION_MOSAIC_BLOCK_SIZE,
        start: { x: 0, y: 0 },
        end: { x: 20, y: 20 },
      },
    ];

    let history = createAnnotationHistory();
    for (const item of items) {
      history = commitAnnotationItem(history, item);
    }
    expect(history.present).toEqual(items);

    for (let index = items.length - 1; index >= 0; index -= 1) {
      history = undoAnnotation(history);
      expect(history.present).toEqual(items.slice(0, index));
    }
    expect(canUndoAnnotation(history)).toBe(false);
  });

  it("reports no more undo once the timeline is rewound to the start", () => {
    const committed = commitAnnotationItem(createAnnotationHistory(), visiblePen);
    const rewound = undoAnnotation(undoAnnotation(committed));

    expect(canUndoAnnotation(rewound)).toBe(false);
    expect(rewound.present).toEqual([]);
  });

  it("makes clear undoable", () => {
    const committed = commitAnnotationItem(createAnnotationHistory(), visiblePen);
    const cleared = clearAnnotations(committed);

    expect(cleared.present).toEqual([]);
    expect(undoAnnotation(cleared).present).toEqual([visiblePen]);
  });

  it("is a no-op at the ends of the timeline", () => {
    const history = createAnnotationHistory();

    expect(undoAnnotation(history)).toBe(history);
    expect(redoAnnotation(history)).toBe(history);
    expect(clearAnnotations(history)).toBe(history);
  });

  it("caps the undo depth by dropping the oldest snapshots", () => {
    const overflow = 10;
    let history = createAnnotationHistory();
    for (let index = 0; index < ANNOTATION_HISTORY_MAX_DEPTH + overflow; index += 1) {
      history = commitAnnotationItem(history, { ...visiblePen, id: `pen-${index}` });
    }

    expect(history.past).toHaveLength(ANNOTATION_HISTORY_MAX_DEPTH);
    // Present is never truncated — only the undo trail is.
    expect(history.present).toHaveLength(ANNOTATION_HISTORY_MAX_DEPTH + overflow);
    // The retained oldest snapshot is the one taken after `overflow` commits, so the
    // empty-canvas snapshot and the next nine are gone.
    expect(history.past[0]).toHaveLength(overflow);
    expect(history.past[0]?.[0]?.id).toBe("pen-0");
  });

  it("drops the redo branch once a new item is committed", () => {
    const committed = commitAnnotationItem(createAnnotationHistory(), visiblePen);
    const undone = undoAnnotation(committed);
    const rewritten = commitAnnotationItem(undone, { ...visiblePen, id: "pen-2" });

    expect(canRedoAnnotation(rewritten)).toBe(false);
  });
});

describe("renderAnnotationScene", () => {
  it("clears and repaints the base image before any item", () => {
    const context = mockContext();

    render(context, []);

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(context.drawImage).toHaveBeenCalledWith(BASE_IMAGE, 0, 0);
  });

  it("skips items that paint nothing", () => {
    const context = mockContext();

    render(context, [penItem([{ x: 1, y: 1 }])]);

    expect(context.save).not.toHaveBeenCalled();
    expect(context.stroke).not.toHaveBeenCalled();
  });

  it("smooths a pen path through segment midpoints", () => {
    const context = mockContext();

    render(context, [
      penItem([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ]),
    ]);

    expect(context.moveTo).toHaveBeenCalledWith(0, 0);
    expect(context.quadraticCurveTo).toHaveBeenCalledWith(10, 10, 15, 5);
    expect(context.lineTo).toHaveBeenCalledWith(20, 0);
    expect(context.stroke).toHaveBeenCalledTimes(1);
  });

  it("strokes a normalized rectangle for a reverse drag", () => {
    const context = mockContext();

    render(context, [
      {
        id: "rect-1",
        tool: "rect",
        color: ANNOTATION_DEFAULT_COLOR,
        lineWidth: 2,
        start: { x: 40, y: 60 },
        end: { x: 10, y: 20 },
      },
    ]);

    expect(context.strokeRect).toHaveBeenCalledWith(10, 20, 30, 40);
  });

  it("draws an arrow shaft plus a head scaled by the line width", () => {
    const context = mockContext();

    render(context, [
      {
        id: "arrow-1",
        tool: "arrow",
        color: ANNOTATION_DEFAULT_COLOR,
        lineWidth: 4,
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
      },
    ]);

    expect(context.stroke).toHaveBeenCalledTimes(2);
    expect(context.lineTo).toHaveBeenCalledWith(100, 0);
  });

  it("halos text before filling it", () => {
    const context = mockContext();

    render(context, [
      {
        id: "text-1",
        tool: "text",
        color: "#00ff00",
        fontSize: 24,
        text: "Fix this",
        at: { x: 5, y: 6 },
      },
    ]);

    expect(context.strokeText).toHaveBeenCalledWith("Fix this", 5, 6);
    expect(context.fillText).toHaveBeenCalledWith("Fix this", 5, 6);
    expect(context.fillStyle).toBe("#00ff00");
    expect(context.font).toContain("24px");
  });

  it("pixelates a mosaic region from the canvas itself and restores smoothing", () => {
    const context = mockContext();

    render(context, [
      {
        id: "mosaic-1",
        tool: "mosaic",
        blockSize: 10,
        start: { x: 0, y: 0 },
        end: { x: 100, y: 50 },
      },
    ]);

    // drawImage(base) first, then shrink into the corner, then blow it back up.
    expect(context.drawImage).toHaveBeenNthCalledWith(
      2,
      context.canvas,
      0,
      0,
      100,
      50,
      0,
      0,
      10,
      5,
    );
    expect(context.drawImage).toHaveBeenNthCalledWith(
      3,
      context.canvas,
      0,
      0,
      10,
      5,
      0,
      0,
      100,
      50,
    );
    // Turned off for the pixelation pass, then put back the way it was found.
    expect(context.smoothingWrites).toEqual([false, true]);
    expect(context.imageSmoothingEnabled).toBe(true);
  });

  it("leaves image smoothing untouched when there is no mosaic", () => {
    const context = mockContext();

    render(context, [
      penItem([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ]);

    expect(context.smoothingWrites).toEqual([]);
  });

  it("paints items in insertion order so a mosaic can cover earlier marks", () => {
    const context = mockContext();

    render(context, [
      penItem([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
      {
        id: "mosaic-1",
        tool: "mosaic",
        blockSize: 10,
        start: { x: 0, y: 0 },
        end: { x: 100, y: 50 },
      },
    ]);

    const strokeOrder = context.stroke.mock.invocationCallOrder[0]!;
    const mosaicOrder = context.drawImage.mock.invocationCallOrder[1]!;
    expect(strokeOrder).toBeLessThan(mosaicOrder);
  });
});

describe("toBitmapPoint", () => {
  it("scales client coordinates into bitmap space", () => {
    expect(
      toBitmapPoint({
        clientX: 150,
        clientY: 100,
        rect: { left: 100, top: 50, width: 200, height: 100 },
        bitmapWidth: 800,
        bitmapHeight: 400,
      }),
    ).toEqual({ x: 200, y: 200 });
  });

  it("returns the origin for a zero-sized canvas", () => {
    expect(
      toBitmapPoint({
        clientX: 10,
        clientY: 10,
        rect: { left: 0, top: 0, width: 0, height: 0 },
        bitmapWidth: 100,
        bitmapHeight: 100,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});

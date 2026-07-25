// FILE: browserAnnotation.ts
// Purpose: Annotation item model, undo/redo history, and canvas painting for marking up a
//          frozen browser screenshot before attaching it to the composer.
// Layer: Browser panel logic helper
// Exports: item factories, history operations, renderAnnotationScene, renderAnnotatedImage
//
// Two structural rules this module exists to enforce:
//  1. Items are a discriminated union. Text has no points and mosaic has no color, so one
//     permissive "stroke" shape would carry fields that are permanently empty.
//  2. Everything is immutable — history snapshots share item references, so mutating an
//     item in place would silently rewrite the past.

import { randomUUID } from "./utils";

export type AnnotationTool = "pen" | "rect" | "arrow" | "text" | "mosaic";

export interface AnnotationPoint {
  x: number;
  y: number;
}

export interface AnnotationRectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnnotationItemBase {
  id: string;
}

export interface AnnotationPenItem extends AnnotationItemBase {
  tool: "pen";
  color: string;
  lineWidth: number;
  points: AnnotationPoint[];
}

export interface AnnotationRectItem extends AnnotationItemBase {
  tool: "rect";
  color: string;
  lineWidth: number;
  start: AnnotationPoint;
  end: AnnotationPoint;
}

export interface AnnotationArrowItem extends AnnotationItemBase {
  tool: "arrow";
  color: string;
  lineWidth: number;
  start: AnnotationPoint;
  end: AnnotationPoint;
}

export interface AnnotationTextItem extends AnnotationItemBase {
  tool: "text";
  color: string;
  fontSize: number;
  text: string;
  at: AnnotationPoint;
}

export interface AnnotationMosaicItem extends AnnotationItemBase {
  tool: "mosaic";
  blockSize: number;
  start: AnnotationPoint;
  end: AnnotationPoint;
}

export type AnnotationItem =
  | AnnotationPenItem
  | AnnotationRectItem
  | AnnotationArrowItem
  | AnnotationTextItem
  | AnnotationMosaicItem;

/** Items whose geometry is a dragged box/segment rather than a path or a caret. */
export type AnnotationDragItem = AnnotationRectItem | AnnotationArrowItem | AnnotationMosaicItem;

export const ANNOTATION_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"] as const;
export const ANNOTATION_DEFAULT_COLOR: string = ANNOTATION_COLORS[0];
export const ANNOTATION_DEFAULT_LINE_WIDTH = 4;
export const ANNOTATION_DEFAULT_FONT_SIZE = 20;
export const ANNOTATION_TEXT_MAX_CHARS = 120;
export const ANNOTATION_MOSAIC_BLOCK_SIZE = 12;
export const ANNOTATION_HISTORY_MAX_DEPTH = 50;
// Pen paths sample on every pointermove; dropping sub-pixel jitter keeps a single stroke
// from ballooning into thousands of points.
export const ANNOTATION_PEN_MIN_POINT_DISTANCE_PX = 2;

const ARROW_HEAD_LENGTH_FACTOR = 3.5;
const ARROW_HEAD_ANGLE_RAD = Math.PI / 7;
const TEXT_HALO_COLOR = "rgba(0, 0, 0, 0.6)";
const TEXT_HALO_WIDTH_FACTOR = 1 / 6;
const TEXT_FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const ANNOTATION_PNG_MIME_TYPE = "image/png";

// ── Item factories ────────────────────────────────────────────────────

export function createPenItem(input: {
  color: string;
  lineWidth: number;
  point: AnnotationPoint;
}): AnnotationPenItem {
  return {
    id: randomUUID(),
    tool: "pen",
    color: input.color,
    lineWidth: input.lineWidth,
    points: [input.point],
  };
}

export function createDragItem(input: {
  tool: AnnotationDragItem["tool"];
  color: string;
  lineWidth: number;
  blockSize?: number;
  start: AnnotationPoint;
}): AnnotationDragItem {
  if (input.tool === "mosaic") {
    return {
      id: randomUUID(),
      tool: "mosaic",
      blockSize: input.blockSize ?? ANNOTATION_MOSAIC_BLOCK_SIZE,
      start: input.start,
      end: input.start,
    };
  }
  return {
    id: randomUUID(),
    tool: input.tool,
    color: input.color,
    lineWidth: input.lineWidth,
    start: input.start,
    end: input.start,
  };
}

/** Returns null for empty text so a cancelled/blank text entry never becomes an item. */
export function createTextItem(input: {
  color: string;
  fontSize: number;
  text: string;
  at: AnnotationPoint;
}): AnnotationTextItem | null {
  const text = normalizeAnnotationText(input.text);
  if (text.length === 0) {
    return null;
  }
  return {
    id: randomUUID(),
    tool: "text",
    color: input.color,
    fontSize: input.fontSize,
    text,
    at: input.at,
  };
}

export function normalizeAnnotationText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > ANNOTATION_TEXT_MAX_CHARS
    ? collapsed.slice(0, ANNOTATION_TEXT_MAX_CHARS)
    : collapsed;
}

export function appendPenPoint(item: AnnotationPenItem, point: AnnotationPoint): AnnotationPenItem {
  const last = item.points[item.points.length - 1];
  if (last && distanceBetween(last, point) < ANNOTATION_PEN_MIN_POINT_DISTANCE_PX) {
    return item;
  }
  return { ...item, points: [...item.points, point] };
}

export function setDragItemEnd<T extends AnnotationDragItem>(item: T, point: AnnotationPoint): T {
  return { ...item, end: point };
}

// Supports dragging in any direction, so a box pulled from bottom-right to top-left still
// produces a positive-size rect.
export function normalizeRect(a: AnnotationPoint, b: AnnotationPoint): AnnotationRectBox {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function distanceBetween(left: AnnotationPoint, right: AnnotationPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

// A pointerdown with no drag leaves a degenerate item that paints nothing; it must not
// enable "add to chat" and it is not worth a history entry.
export function isVisibleAnnotationItem(item: AnnotationItem): boolean {
  switch (item.tool) {
    case "pen":
      return item.points.length >= 2;
    case "text":
      return item.text.length > 0;
    case "arrow":
      return distanceBetween(item.start, item.end) > 0;
    case "rect":
    case "mosaic": {
      const box = normalizeRect(item.start, item.end);
      return box.width > 0 && box.height > 0;
    }
  }
}

// ── History (past / present / future snapshots) ───────────────────────

export interface AnnotationHistory {
  past: ReadonlyArray<ReadonlyArray<AnnotationItem>>;
  present: ReadonlyArray<AnnotationItem>;
  future: ReadonlyArray<ReadonlyArray<AnnotationItem>>;
}

export function createAnnotationHistory(): AnnotationHistory {
  return { past: [], present: [], future: [] };
}

function pushPast(
  past: AnnotationHistory["past"],
  present: AnnotationHistory["present"],
): AnnotationHistory["past"] {
  const next = [...past, present];
  return next.length > ANNOTATION_HISTORY_MAX_DEPTH
    ? next.slice(next.length - ANNOTATION_HISTORY_MAX_DEPTH)
    : next;
}

export function commitAnnotationItem(
  history: AnnotationHistory,
  item: AnnotationItem,
): AnnotationHistory {
  if (!isVisibleAnnotationItem(item)) {
    return history;
  }
  return {
    past: pushPast(history.past, history.present),
    present: [...history.present, item],
    future: [],
  };
}

// Clearing goes through the same history, so it is undoable like any other edit.
export function clearAnnotations(history: AnnotationHistory): AnnotationHistory {
  if (history.present.length === 0) {
    return history;
  }
  return {
    past: pushPast(history.past, history.present),
    present: [],
    future: [],
  };
}

export function undoAnnotation(history: AnnotationHistory): AnnotationHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) {
    return history;
  }
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoAnnotation(history: AnnotationHistory): AnnotationHistory {
  const next = history.future[0];
  if (!next) {
    return history;
  }
  return {
    past: pushPast(history.past, history.present),
    present: next,
    future: history.future.slice(1),
  };
}

export function canUndoAnnotation(history: AnnotationHistory): boolean {
  return history.past.length > 0;
}

export function canRedoAnnotation(history: AnnotationHistory): boolean {
  return history.future.length > 0;
}

export function hasVisibleItems(history: AnnotationHistory): boolean {
  return history.present.some((item) => isVisibleAnnotationItem(item));
}

// ── Rendering ─────────────────────────────────────────────────────────

/**
 * The single painting path: base image first, then every item in insertion order.
 *
 * Live preview and the exported PNG both go through this function, so what the user sees
 * is exactly what gets attached. It also has to be the only path because mosaic samples
 * the canvas it is drawing into — a separate `<img>` backdrop would be unreadable to it.
 */
export function renderAnnotationScene(
  context: CanvasRenderingContext2D,
  base: CanvasImageSource,
  items: ReadonlyArray<AnnotationItem>,
): void {
  const canvas = context.canvas;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(base, 0, 0);
  for (const item of items) {
    if (!isVisibleAnnotationItem(item)) {
      continue;
    }
    drawAnnotationItem(context, item);
  }
}

function drawAnnotationItem(context: CanvasRenderingContext2D, item: AnnotationItem): void {
  context.save();
  switch (item.tool) {
    case "pen":
      drawPen(context, item);
      break;
    case "rect":
      drawRect(context, item);
      break;
    case "arrow":
      drawArrow(context, item);
      break;
    case "text":
      drawText(context, item);
      break;
    case "mosaic":
      drawMosaic(context, item);
      break;
  }
  context.restore();
}

function applyStrokeStyle(
  context: CanvasRenderingContext2D,
  item: { color: string; lineWidth: number },
): void {
  context.strokeStyle = item.color;
  context.lineWidth = item.lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
}

// Midpoint-quadratic smoothing: each segment curves through the midpoint between samples,
// which removes the polyline faceting a raw lineTo path shows at typical sampling rates.
function drawPen(context: CanvasRenderingContext2D, item: AnnotationPenItem): void {
  applyStrokeStyle(context, item);
  const points = item.points;
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]!;
    const next = points[index + 1]!;
    context.quadraticCurveTo(
      current.x,
      current.y,
      (current.x + next.x) / 2,
      (current.y + next.y) / 2,
    );
  }
  const last = points[points.length - 1]!;
  context.lineTo(last.x, last.y);
  context.stroke();
}

function drawRect(context: CanvasRenderingContext2D, item: AnnotationRectItem): void {
  applyStrokeStyle(context, item);
  const box = normalizeRect(item.start, item.end);
  context.strokeRect(box.x, box.y, box.width, box.height);
}

function drawArrow(context: CanvasRenderingContext2D, item: AnnotationArrowItem): void {
  applyStrokeStyle(context, item);
  const { start, end } = item;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = item.lineWidth * ARROW_HEAD_LENGTH_FACTOR;

  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();

  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - headLength * Math.cos(angle - ARROW_HEAD_ANGLE_RAD),
    end.y - headLength * Math.sin(angle - ARROW_HEAD_ANGLE_RAD),
  );
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - headLength * Math.cos(angle + ARROW_HEAD_ANGLE_RAD),
    end.y - headLength * Math.sin(angle + ARROW_HEAD_ANGLE_RAD),
  );
  context.stroke();
}

// Dark halo under the glyphs so the label stays legible on both light and dark pages.
function drawText(context: CanvasRenderingContext2D, item: AnnotationTextItem): void {
  context.font = `600 ${item.fontSize}px ${TEXT_FONT_FAMILY}`;
  context.textBaseline = "top";
  context.lineJoin = "round";
  context.lineWidth = Math.max(1, item.fontSize * TEXT_HALO_WIDTH_FACTOR);
  context.strokeStyle = TEXT_HALO_COLOR;
  context.strokeText(item.text, item.at.x, item.at.y);
  context.fillStyle = item.color;
  context.fillText(item.text, item.at.x, item.at.y);
}

/**
 * Pixelates a region by shrinking it into its own top-left corner and blowing it straight
 * back up with smoothing off.
 *
 * The source is the canvas being drawn into (not the pristine screenshot), so anything
 * already annotated inside the region gets redacted along with the page pixels — which is
 * what a user covering sensitive data expects.
 */
function drawMosaic(context: CanvasRenderingContext2D, item: AnnotationMosaicItem): void {
  const box = normalizeRect(item.start, item.end);
  const blockSize = Math.max(1, item.blockSize);
  const columns = Math.max(1, Math.round(box.width / blockSize));
  const rows = Math.max(1, Math.round(box.height / blockSize));

  const previousSmoothing = context.imageSmoothingEnabled;
  context.imageSmoothingEnabled = false;
  context.drawImage(
    context.canvas,
    box.x,
    box.y,
    box.width,
    box.height,
    box.x,
    box.y,
    columns,
    rows,
  );
  context.drawImage(
    context.canvas,
    box.x,
    box.y,
    columns,
    rows,
    box.x,
    box.y,
    box.width,
    box.height,
  );
  context.imageSmoothingEnabled = previousSmoothing;
}

// Maps a pointer position on the displayed canvas into bitmap coordinates. The canvas is
// laid out with `object-contain`, so on high-DPI screens (and any non-1:1 fit) the CSS box
// and the bitmap differ and raw client coordinates would land in the wrong place.
export function toBitmapPoint(input: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number; height: number };
  bitmapWidth: number;
  bitmapHeight: number;
}): AnnotationPoint {
  if (input.rect.width <= 0 || input.rect.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((input.clientX - input.rect.left) / input.rect.width) * input.bitmapWidth,
    y: ((input.clientY - input.rect.top) / input.rect.height) * input.bitmapHeight,
  };
}

/**
 * Flattens the screenshot and every annotation into one PNG.
 *
 * This blob is the only artifact allowed to leave the overlay: mosaic is a redaction tool,
 * so the un-redacted screenshot must never be attached separately. Callers release the
 * source bitmap once this resolves.
 */
export async function renderAnnotatedImage(
  base: ImageBitmap,
  items: ReadonlyArray<AnnotationItem>,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = base.width;
  canvas.height = base.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Couldn't prepare the annotation canvas.");
  }
  renderAnnotationScene(context, base, items);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, ANNOTATION_PNG_MIME_TYPE);
  });
  if (!blob || blob.size === 0) {
    throw new Error("Couldn't render the annotated screenshot.");
  }
  return blob;
}

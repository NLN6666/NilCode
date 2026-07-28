// FILE: BrowserAnnotationOverlay.tsx
// Purpose: Marks up a frozen browser screenshot (pen / rect / arrow / text / mosaic) and
//   hands the flattened PNG back to the panel.
// Layer: Browser panel presentation
// Depends on: browserAnnotation item model + history, shared Button chrome
//
// Two deliberate deviations from the usual overlay conventions:
//  - Esc does NOT close this overlay. A long annotation session is easy to lose to a stray
//    keypress, so only the toolbar's Cancel/Add buttons can dismiss it. Esc only cancels an
//    in-progress text entry.
//  - The page is frozen up front (the caller captures a screenshot), so nothing here touches
//    the live page and scrolling can never desync a mark from what it points at.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { useMessages } from "~/i18n/context";
import {
  ANNOTATION_COLORS,
  ANNOTATION_DEFAULT_COLOR,
  ANNOTATION_DEFAULT_FONT_SIZE,
  ANNOTATION_DEFAULT_LINE_WIDTH,
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
  redoAnnotation,
  renderAnnotatedImage,
  renderAnnotationScene,
  setDragItemEnd,
  toBitmapPoint,
  undoAnnotation,
  type AnnotationDragItem,
  type AnnotationItem,
  type AnnotationPenItem,
  type AnnotationPoint,
  type AnnotationTool,
} from "~/lib/browserAnnotation";
import {
  ArrowUpRightIcon,
  EraserIcon,
  PencilIcon,
  RotateCcwIcon,
  SquareOutlineIcon,
  TextLabelIcon,
  Undo2Icon,
  type LucideIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

interface BrowserAnnotationOverlayProps {
  imageBitmap: ImageBitmap;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

interface PendingTextEntry {
  at: AnnotationPoint;
  value: string;
}

/** Tool order and glyphs are locale-free; the labels come from the active catalog. */
const ANNOTATION_TOOLS: ReadonlyArray<{
  tool: AnnotationTool;
  icon: LucideIcon;
}> = [
  { tool: "pen", icon: PencilIcon },
  { tool: "rect", icon: SquareOutlineIcon },
  { tool: "arrow", icon: ArrowUpRightIcon },
  { tool: "text", icon: TextLabelIcon },
  { tool: "mosaic", icon: EraserIcon },
];

function isDragTool(tool: AnnotationTool): tool is AnnotationDragItem["tool"] {
  return tool === "rect" || tool === "arrow" || tool === "mosaic";
}

export function BrowserAnnotationOverlay({
  imageBitmap,
  errorMessage = null,
  onCancel,
  onConfirm,
}: BrowserAnnotationOverlayProps) {
  const copy = useMessages().browser.annotation;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const draftItemRef = useRef<AnnotationItem | null>(null);
  const [history, setHistory] = useState(createAnnotationHistory);
  // The in-progress drag lives outside history: committing on every pointermove would turn
  // one stroke into hundreds of undo steps.
  const [draftItem, setDraftItem] = useState<AnnotationItem | null>(null);
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState<string>(ANNOTATION_DEFAULT_COLOR);
  const [pendingText, setPendingText] = useState<PendingTextEntry | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [rendering, setRendering] = useState(false);

  const scene = useMemo<AnnotationItem[]>(
    () => (draftItem ? [...history.present, draftItem] : [...history.present]),
    [draftItem, history.present],
  );
  const hasMarks = hasVisibleItems(history);
  const canConfirm = hasMarks && !rendering;
  const colorsDisabled = tool === "mosaic";

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) {
      return;
    }
    renderAnnotationScene(context, imageBitmap, scene);
  }, [imageBitmap, scene]);

  useEffect(() => {
    if (pendingText) {
      textInputRef.current?.focus();
    }
  }, [pendingText]);

  // "Discard marks?" must not stay armed. Without this, a stray first click on Cancel leaves
  // the button primed indefinitely, and a Cancel clicked minutes later — after more drawing —
  // would wipe everything with no confirmation at all. Any other interaction disarms it, so
  // only two Cancel clicks in a row discard.
  useEffect(() => {
    setConfirmingCancel(false);
  }, [history, tool, color, draftItem, pendingText]);

  const pointFromEvent = useCallback(
    (event: { clientX: number; clientY: number }): AnnotationPoint => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return { x: 0, y: 0 };
      }
      return toBitmapPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        rect: canvas.getBoundingClientRect(),
        bitmapWidth: imageBitmap.width,
        bitmapHeight: imageBitmap.height,
      });
    },
    [imageBitmap.height, imageBitmap.width],
  );

  const commitPendingText = useCallback(() => {
    if (!pendingText) {
      return;
    }
    setPendingText(null);
    const item = createTextItem({
      color,
      fontSize: ANNOTATION_DEFAULT_FONT_SIZE,
      text: pendingText.value,
      at: pendingText.at,
    });
    if (item) {
      setHistory((current) => commitAnnotationItem(current, item));
    }
  }, [color, pendingText]);

  // Mirrored into a ref so pointerup can commit the finished drag without running side
  // effects inside a state updater (React may invoke updaters more than once).
  const setDraft = useCallback((item: AnnotationItem | null) => {
    draftItemRef.current = item;
    setDraftItem(item);
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) {
        return;
      }
      const point = pointFromEvent(event);
      if (tool === "text") {
        commitPendingText();
        setPendingText({ at: point, value: "" });
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraft(
        tool === "pen"
          ? createPenItem({ color, lineWidth: ANNOTATION_DEFAULT_LINE_WIDTH, point })
          : createDragItem({
              tool,
              color,
              lineWidth: ANNOTATION_DEFAULT_LINE_WIDTH,
              start: point,
            }),
      );
    },
    [color, commitPendingText, pointFromEvent, setDraft, tool],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const current = draftItemRef.current;
      if (!current) {
        return;
      }
      const point = pointFromEvent(event);
      if (current.tool === "pen") {
        setDraft(appendPenPoint(current as AnnotationPenItem, point));
        return;
      }
      if (isDragTool(current.tool)) {
        setDraft(setDragItemEnd(current as AnnotationDragItem, point));
      }
    },
    [pointFromEvent, setDraft],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const finished = draftItemRef.current;
      setDraft(null);
      if (finished) {
        setHistory((current) => commitAnnotationItem(current, finished));
      }
    },
    [setDraft],
  );

  const undo = useCallback(() => {
    setHistory((current) => undoAnnotation(current));
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => redoAnnotation(current));
  }, []);

  const clear = useCallback(() => {
    setHistory((current) => clearAnnotations(current));
  }, []);

  const confirm = useCallback(() => {
    if (!canConfirm) {
      return;
    }
    setRendering(true);
    void renderAnnotatedImage(imageBitmap, history.present)
      .then((blob) => {
        onConfirm(blob);
      })
      .finally(() => {
        setRendering(false);
      });
  }, [canConfirm, history.present, imageBitmap, onConfirm]);

  // Cancelling with marks on the canvas asks once: the screenshot and every mark are gone
  // for good, and there is no draft to come back to.
  const requestCancel = useCallback(() => {
    if (!hasMarks || confirmingCancel) {
      onCancel();
      return;
    }
    setConfirmingCancel(true);
  }, [confirmingCancel, hasMarks, onCancel]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // While a label is being typed, Ctrl/Cmd+Z belongs to the input's own text undo.
      if (pendingText) {
        return;
      }
      const chord = event.metaKey || event.ctrlKey;
      if (chord && event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        redo();
        return;
      }
      if (chord && event.key.toLowerCase() === "u") {
        event.preventDefault();
        redo();
        return;
      }
      if (chord && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pendingText, redo, undo]);

  const textInputStyle = pendingText
    ? textEntryStyle(pendingText.at, canvasRef.current, imageBitmap)
    : undefined;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#0d0d0d]">
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          width={imageBitmap.width}
          height={imageBitmap.height}
          className="absolute inset-0 size-full touch-none object-contain"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {pendingText ? (
          <input
            ref={textInputRef}
            value={pendingText.value}
            maxLength={ANNOTATION_TEXT_MAX_CHARS}
            aria-label={copy.textLabel}
            placeholder={copy.textPlaceholder}
            className="absolute z-10 rounded-md border border-border bg-background/95 px-2 py-1 text-xs text-foreground shadow-lg outline-none"
            style={textInputStyle}
            onChange={(event) => {
              const value = event.target.value;
              setPendingText((current) => (current ? { ...current, value } : current));
            }}
            onBlur={commitPendingText}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitPendingText();
                return;
              }
              // Esc abandons this label only; it must never dismiss the overlay.
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setPendingText(null);
              }
            }}
          />
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background/95 px-3 py-2">
        <div className="flex shrink-0 items-center gap-1">
          {ANNOTATION_TOOLS.map((entry) => (
            <Button
              key={entry.tool}
              type="button"
              variant={tool === entry.tool ? "secondary" : "ghost"}
              size="icon-sm"
              className="size-7"
              aria-label={copy.tools[entry.tool]}
              aria-pressed={tool === entry.tool}
              title={copy.tools[entry.tool]}
              onClick={() => setTool(entry.tool)}
            >
              <entry.icon className="size-3.5" />
              <span className="sr-only">{copy.tools[entry.tool]}</span>
            </Button>
          ))}
        </div>
        <div className={cn("flex shrink-0 items-center gap-1", colorsDisabled && "opacity-40")}>
          {ANNOTATION_COLORS.map((entry) => (
            <button
              key={entry}
              type="button"
              disabled={colorsDisabled}
              className={cn(
                "size-5 rounded-full border transition-transform disabled:cursor-not-allowed",
                color === entry
                  ? "scale-110 border-foreground"
                  : "border-border/60 hover:scale-105",
              )}
              style={{ backgroundColor: entry }}
              aria-label={copy.useInk(entry)}
              aria-pressed={color === entry}
              title={copy.useInk(entry)}
              onClick={() => setColor(entry)}
            >
              <span className="sr-only">{copy.useInk(entry)}</span>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7"
            disabled={!canUndoAnnotation(history)}
            aria-label={copy.undo}
            title={copy.undoHint}
            onClick={undo}
          >
            <Undo2Icon className="size-3.5" />
            <span className="sr-only">{copy.undo}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7"
            disabled={!canRedoAnnotation(history)}
            aria-label={copy.redo}
            title={copy.redoHint}
            onClick={redo}
          >
            <RotateCcwIcon className="size-3.5 scale-x-[-1]" />
            <span className="sr-only">{copy.redo}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={history.present.length === 0}
            aria-label={copy.clearAll}
            title={copy.clearAllHint}
            onClick={clear}
          >
            {copy.clear}
          </Button>
        </div>
        {errorMessage ? (
          <p className="min-w-0 flex-1 truncate text-[11px] text-destructive" title={errorMessage}>
            {errorMessage}
          </p>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant={confirmingCancel ? "destructive" : "ghost"}
            size="sm"
            onClick={requestCancel}
          >
            {confirmingCancel ? copy.confirmDiscard : copy.cancel}
          </Button>
          <Button type="button" size="sm" disabled={!canConfirm} onClick={confirm}>
            {copy.addToChat}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Positions the floating text input over the click point, converting bitmap coordinates
// back into the canvas's displayed CSS box.
function textEntryStyle(
  at: AnnotationPoint,
  canvas: HTMLCanvasElement | null,
  bitmap: ImageBitmap,
): { left: number; top: number } {
  if (!canvas || bitmap.width === 0 || bitmap.height === 0) {
    return { left: 0, top: 0 };
  }
  const rect = canvas.getBoundingClientRect();
  return {
    left: (at.x / bitmap.width) * rect.width,
    top: (at.y / bitmap.height) * rect.height,
  };
}

export default BrowserAnnotationOverlay;

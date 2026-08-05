// FILE: ReasoningStreamRegion.tsx
// Purpose: Height-capped, auto-following panel holding a reasoning trace while it streams.
// Layer: Web chat presentation component
// Exports: ReasoningStreamRegion

import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { THIN_SCROLLBAR_CLASS_NAME } from "~/surfaceStyles";

import ChatMarkdown from "../ChatMarkdown";

// The panel fits its content up to a cap rather than reserving the cap outright:
// a short trace - the common case - would otherwise sit pinned to the top of a
// mostly empty box. Growth up to the cap is bounded, monotonic (streamed detail is
// always the full text so far) and happens at the live tail of the transcript, so
// it cannot churn transcript height the way an uncapped region would.
const REASONING_STREAM_REGION_MAX_TEXT_HEIGHT_PX = 84;
const REASONING_STREAM_REGION_COMPACT_MAX_TEXT_HEIGHT_PX = 68;
// The panel's own padding lives inside the cap (border-box), so adding the surface
// did not cost the trace any visible lines.
const REASONING_STREAM_REGION_PADDING_Y_PX = 6;
const REASONING_STREAM_REGION_COMPACT_PADDING_Y_PX = 4;

// One expression for the panel material, reused by the fill and the top fade. The
// fade has to resolve to the exact panel color - a translucent token would paint a
// lighter band over the first line instead of dissolving it - so this composites
// the tint against the background itself and stays opaque.
const REASONING_STREAM_REGION_SURFACE =
  "color-mix(in srgb, var(--foreground) 6%, var(--background))";
const REASONING_STREAM_REGION_BORDER = "color-mix(in srgb, var(--foreground) 10%, transparent)";

interface ReasoningStreamRegionProps {
  readonly text: string;
  readonly fontSizePx: number;
  readonly compact?: boolean;
  readonly cwd?: string | undefined;
}

export function ReasoningStreamRegion({
  text,
  fontSizePx,
  compact = false,
  cwd,
}: ReasoningStreamRegionProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Only true once the trace outgrows the cap; gates the top fade so a short trace
  // does not get its first line washed out.
  const [clipped, setClipped] = useState(false);

  // Always pin to the newest text. The region is not a reading surface while it
  // streams - the reader can still scroll back inside the panel, and the full trace
  // stays available in the expanded detail view.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
    setClipped(node.scrollHeight > node.clientHeight);
  }, [text, compact]);

  const maxHeightPx = compact
    ? REASONING_STREAM_REGION_COMPACT_MAX_TEXT_HEIGHT_PX +
      2 * REASONING_STREAM_REGION_COMPACT_PADDING_Y_PX
    : REASONING_STREAM_REGION_MAX_TEXT_HEIGHT_PX + 2 * REASONING_STREAM_REGION_PADDING_Y_PX;

  return (
    <div
      data-reasoning-stream-region="true"
      className="relative overflow-hidden rounded-md border"
      style={{
        backgroundColor: REASONING_STREAM_REGION_SURFACE,
        borderColor: REASONING_STREAM_REGION_BORDER,
      }}
    >
      <div
        ref={scrollRef}
        data-reasoning-stream-scroller="true"
        className={cn(
          "overflow-y-auto overscroll-contain",
          THIN_SCROLLBAR_CLASS_NAME,
          compact ? "px-2 py-1" : "px-2.5 py-1.5",
        )}
        style={{ maxHeight: `${maxHeightPx}px` }}
      >
        <ChatMarkdown
          text={text}
          cwd={cwd}
          isStreaming
          className="leading-relaxed"
          style={{
            color: "color-mix(in srgb, var(--muted-foreground) 72%, transparent)",
            fontSize: `${Math.max(11, fontSizePx - 1)}px`,
            lineHeight: compact ? "18px" : "19px",
          }}
        />
      </div>
      {/* Older lines fade out at the top instead of being cut mid-glyph. */}
      {clipped ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-4"
          style={{
            backgroundImage: `linear-gradient(to bottom, ${REASONING_STREAM_REGION_SURFACE}, transparent)`,
          }}
        />
      ) : null}
    </div>
  );
}

// FILE: ReasoningStreamRegion.tsx
// Purpose: Height-capped, auto-following view of a reasoning trace while it streams.
// Layer: Web chat presentation component
// Exports: ReasoningStreamRegion

import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import ChatMarkdown from "../ChatMarkdown";

// The region fits its content up to a cap rather than reserving the cap outright:
// a short trace - the common case - would otherwise sit pinned to the top of a
// mostly empty box. Growth up to the cap is bounded, monotonic (streamed detail is
// always the full text so far) and happens at the live tail of the transcript, so
// it cannot churn transcript height the way an uncapped region would.
const REASONING_STREAM_REGION_MAX_HEIGHT_PX = 84;
const REASONING_STREAM_REGION_COMPACT_MAX_HEIGHT_PX = 68;

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
  // streams - the full trace stays available in the expanded detail view.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
    setClipped(node.scrollHeight > node.clientHeight);
  }, [text, compact]);

  return (
    <div data-reasoning-stream-region="true" className="relative">
      <div
        ref={scrollRef}
        data-reasoning-stream-scroller="true"
        className={cn(
          "overflow-y-auto overscroll-contain",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        style={{
          maxHeight: `${compact ? REASONING_STREAM_REGION_COMPACT_MAX_HEIGHT_PX : REASONING_STREAM_REGION_MAX_HEIGHT_PX}px`,
        }}
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
          className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-[var(--background)] to-transparent"
        />
      ) : null}
    </div>
  );
}

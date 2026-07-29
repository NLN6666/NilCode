// FILE: ReasoningStreamRegion.tsx
// Purpose: Fixed-height, auto-following view of a reasoning trace while it streams.
// Layer: Web chat presentation component
// Exports: ReasoningStreamRegion, REASONING_STREAM_REGION_HEIGHT_PX

import { useEffect, useRef } from "react";

import { cn } from "~/lib/utils";

import ChatMarkdown from "../ChatMarkdown";

// The region is deliberately a fixed height: a trace that grew with its content
// would push the rest of the transcript down on every streamed update.
export const REASONING_STREAM_REGION_HEIGHT_PX = 84;
const REASONING_STREAM_REGION_COMPACT_HEIGHT_PX = 68;

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

  // Always pin to the newest text. The region is not a reading surface while it
  // streams - the full trace stays available in the expanded detail view.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [text]);

  return (
    <div
      data-reasoning-stream-region="true"
      className="relative overflow-hidden"
      style={{
        height: `${compact ? REASONING_STREAM_REGION_COMPACT_HEIGHT_PX : REASONING_STREAM_REGION_HEIGHT_PX}px`,
      }}
    >
      <div
        ref={scrollRef}
        data-reasoning-stream-scroller="true"
        className={cn(
          "h-full overflow-y-auto overscroll-contain",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
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
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-[var(--background)] to-transparent"
      />
    </div>
  );
}

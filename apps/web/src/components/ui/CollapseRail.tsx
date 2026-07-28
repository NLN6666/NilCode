// FILE: CollapseRail.tsx
// Purpose: Subordinate vertical rail beside an expanded region; clicking it collapses.
// Layer: UI primitive
// Exports: CollapseRail, COLLAPSE_RAIL_WIDTH_CLASS
// Why: A long expansion pushes its disclosure trigger off-screen, leaving no way to
//      collapse from further down. The rail hangs the full height of the expansion so
//      the affordance is always in reach, and reads as an indent tying the content to
//      the row above it.

import { cn } from "~/lib/utils";
import { useMessages } from "~/i18n/context";

/** Rail widths, matched to the indent each caller previously carried as a margin. */
export const COLLAPSE_RAIL_WIDTH_CLASS = {
  compact: "w-5",
  regular: "w-7",
} as const;

export type CollapseRailWidth = keyof typeof COLLAPSE_RAIL_WIDTH_CLASS;

/**
 * Place as the first child of a `flex` container whose remaining child holds the
 * expanded content; the rail stretches to that container's height.
 */
export function CollapseRail(props: {
  onCollapse: () => void;
  width?: CollapseRailWidth;
  /** Overrides the default "collapse details" label for non-detail regions. */
  label?: string;
}) {
  const copy = useMessages().chat.work;
  const width = props.width ?? "compact";

  return (
    <button
      type="button"
      aria-label={props.label ?? copy.collapseDetails}
      data-collapse-rail="true"
      // Opt out of the transcript's click anchoring: collapsing from down here should
      // leave the viewport exactly where it is.
      data-scroll-anchor-ignore="true"
      className={cn(
        "group/collapse-rail relative flex-none cursor-pointer self-stretch focus-visible:outline-none",
        COLLAPSE_RAIL_WIDTH_CLASS[width],
      )}
      onClick={props.onCollapse}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 rounded-full transition-colors",
          // Wide enough to read as a deliberate rail rather than a hairline artifact,
          // and it thickens on hover so the whole strip announces itself as a control.
          "left-2 w-0.5 bg-border group-hover/collapse-rail:bg-foreground/45",
          "group-focus-visible/collapse-rail:bg-foreground/45",
        )}
      />
    </button>
  );
}

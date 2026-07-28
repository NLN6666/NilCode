// FILE: CollapseRail.tsx
// Purpose: Subordinate vertical rail beside an expanded region; clicking it collapses.
// Layer: UI primitive
// Exports: CollapseRail, COLLAPSE_RAIL_WIDTH_CLASS
// Why: A long expansion pushes its disclosure trigger off-screen, leaving no way to
//      collapse from further down. The rail hangs the full height of the expansion and
//      carries a sticky glyph that stays in view while scrolling through it, so the
//      affordance is always in reach. It doubles as an indent tying the content to the
//      row above it.
// Note: The sticky glyph needs an unclipped scroll ancestor — pair with
//       <DisclosureRegion allowOverflowWhenOpen>.

import { ChevronUpIcon } from "~/lib/icons";
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
        "group/collapse-rail relative flex-none cursor-pointer focus-visible:outline-none",
        // Stretch to the expansion's height so the rail is clickable all the way down.
        "self-stretch",
        COLLAPSE_RAIL_WIDTH_CLASS[width],
      )}
      onClick={props.onCollapse}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-2 w-0.5 rounded-full bg-border transition-colors",
          "group-hover/collapse-rail:bg-foreground/45 group-focus-visible/collapse-rail:bg-foreground/45",
        )}
      />
      {/* Rides along the rail as the expansion scrolls past, so the collapse action stays
          on screen long after the disclosure trigger above has scrolled away. */}
      <span
        aria-hidden="true"
        className={cn(
          "sticky top-2 z-10 flex size-4 items-center justify-center rounded-full",
          // Sits on the rail like a node on the line. Always visible — the whole point is
          // to be findable after the trigger has scrolled away — and brightens on hover.
          "border border-border bg-background text-muted-foreground/70 shadow-xs transition-colors",
          "group-hover/collapse-rail:border-foreground/45 group-hover/collapse-rail:text-foreground",
          "group-focus-visible/collapse-rail:border-foreground/45",
        )}
        data-collapse-rail-glyph="true"
      >
        <ChevronUpIcon className="size-3" />
      </span>
    </button>
  );
}

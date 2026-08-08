"use client";

// FILE: switch.tsx
// Purpose: Shared accent-colored on/off switch primitive used by settings, menus, and dialogs.
// Layer: Base UI component
// Exports: Switch (with an optional indeterminate rendering) plus track/thumb class names
//          for compact switch-shaped controls

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "~/lib/utils";

const SWITCH_TRACK_CLASS_NAME =
  "inline-flex h-[calc(var(--thumb-size)+4px)] w-[calc(var(--thumb-size)*2)] shrink-0 cursor-pointer items-center rounded-full border p-px outline-none transition-[background-color,box-shadow,border-color] duration-200 [--thumb-size:--spacing(5)] focus-visible:ring-2 focus-visible:ring-[color:var(--color-border-focus)]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:border-[color:var(--color-text-accent)] data-checked:bg-[var(--color-text-accent)] data-unchecked:border-[color:color-mix(in_srgb,var(--color-text-foreground)_14%,transparent)] data-unchecked:bg-[color-mix(in_srgb,var(--color-text-foreground)_20%,var(--color-background-control-opaque))] data-disabled:cursor-not-allowed data-disabled:opacity-64 sm:[--thumb-size:--spacing(4)]";

const SWITCH_THUMB_CLASS_NAME =
  "pointer-events-none block aspect-square h-full origin-left translate-x-0 rounded-full bg-white shadow-sm ring-1 ring-black/5 will-change-transform [transition:translate_.2s_ease-out,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s]";

// Mixed state for switches that stand in for a batch of rows (Settings -> Skills). Applied as
// plain `cn` overrides rather than a `data-indeterminate:` variant so tailwind-merge resolves
// them against the base/unchecked classes they replace, instead of racing them on specificity.
const SWITCH_TRACK_INDETERMINATE_CLASS_NAME =
  "data-unchecked:border-[color:color-mix(in_srgb,var(--color-text-accent)_55%,transparent)] data-unchecked:bg-[color-mix(in_srgb,var(--color-text-accent)_45%,var(--color-background-control-opaque))]";

const SWITCH_THUMB_INDETERMINATE_CLASS_NAME =
  "translate-x-[calc((var(--thumb-size)-4px)/2)] origin-[calc(var(--thumb-size)/2)_50%]";

/**
 * `indeterminate` renders the thumb mid-track for a "some on, some off" batch. ARIA has no
 * mixed state for `role="switch"`, so the control still reports unchecked — pass an
 * `aria-label` that names the batch, and clicking it turns the whole batch on.
 */
function Switch({
  className,
  indeterminate,
  ...props
}: SwitchPrimitive.Root.Props & { indeterminate?: boolean }) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        SWITCH_TRACK_CLASS_NAME,
        indeterminate && SWITCH_TRACK_INDETERMINATE_CLASS_NAME,
        className,
      )}
      data-slot="switch"
      data-indeterminate={indeterminate ? "" : undefined}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          SWITCH_THUMB_CLASS_NAME,
          "in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:not-data-disabled:scale-x-110 in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.1)] data-checked:origin-[var(--thumb-size)_50%] data-checked:translate-x-[calc(var(--thumb-size)-4px)]",
          indeterminate && SWITCH_THUMB_INDETERMINATE_CLASS_NAME,
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch, SWITCH_THUMB_CLASS_NAME, SWITCH_TRACK_CLASS_NAME };

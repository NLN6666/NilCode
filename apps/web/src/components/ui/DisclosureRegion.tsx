// FILE: DisclosureRegion.tsx
// Purpose: Controlled expand/collapse region with the shared sidebar-style grid animation.
// Layer: UI primitive
// Exports: DisclosureRegion
// Depends on: disclosureMotion helpers

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  DISCLOSURE_CLEANUP_BUFFER_MS,
  DISCLOSURE_INNER_CLASS,
  DISCLOSURE_TRANSITION_MS,
  disclosureContentClassName,
  disclosureShellClassName,
} from "~/lib/disclosureMotion";

export function DisclosureRegion(props: {
  open: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  /**
   * Releases the inner clip once the open animation has settled. The clip is what makes
   * the height animation look right, but it also acts as a scroll container — which
   * silently breaks any `position: sticky` inside the region. Opt in only when the
   * content needs sticky; the clip still applies for the whole transition.
   */
  allowOverflowWhenOpen?: boolean;
}) {
  const { open, children, className, contentClassName, allowOverflowWhenOpen } = props;
  const [settledOpen, setSettledOpen] = useState(open && Boolean(allowOverflowWhenOpen));

  useEffect(() => {
    if (!allowOverflowWhenOpen) return;
    if (!open) {
      setSettledOpen(false);
      return;
    }
    const settle = window.setTimeout(
      () => setSettledOpen(true),
      DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
    );
    return () => window.clearTimeout(settle);
  }, [allowOverflowWhenOpen, open]);

  return (
    <div
      className={disclosureShellClassName(open, className)}
      aria-hidden={open ? undefined : true}
      inert={!open}
    >
      <div className={cn(DISCLOSURE_INNER_CLASS, settledOpen && "overflow-visible")}>
        <div className={disclosureContentClassName(open, contentClassName)}>{children}</div>
      </div>
    </div>
  );
}

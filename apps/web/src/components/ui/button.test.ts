import { describe, expect, it } from "vitest";

import { INTERACTIVE_PRESS_MOTION_CLASS_NAME } from "~/lib/interactionMotion";
import { cn } from "~/lib/utils";
import { buttonVariants } from "./button";

describe("buttonVariants", () => {
  it("provides immediate compositor-only press feedback", () => {
    const className = buttonVariants();

    expect(className).toContain(
      "transition-[transform,color,background-color,border-color,opacity]",
    );
    expect(className).toContain("duration-100");
    expect(className).toContain("active:scale-[0.98]");
    expect(className).toContain("motion-reduce:transition-none");
  });

  it("keeps the shared transition for variants and legacy color-transition callers", () => {
    const prominentClassName = cn(buttonVariants({ variant: "prominent" }));
    const legacyCallerClassName = cn("transition-colors", INTERACTIVE_PRESS_MOTION_CLASS_NAME);

    expect(prominentClassName).toContain(
      "transition-[transform,color,background-color,border-color,opacity]",
    );
    expect(legacyCallerClassName).toContain(
      "transition-[transform,color,background-color,border-color,opacity]",
    );
    expect(legacyCallerClassName).not.toContain("transition-colors");
  });
});

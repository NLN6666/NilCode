// FILE: AppNavigationButtons.tsx
// Purpose: Renders Electron-only browser-style route back/forward controls.
// Layer: Shared web shell chrome
// Depends on: appNavigation history helpers, header Button/Tooltip primitives

import { goBackInAppHistory, goForwardInAppHistory, useAppNavigationState } from "~/appNavigation";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { IoIosArrowRoundBack, IoIosArrowRoundForward } from "react-icons/io";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useMessages } from "~/i18n/context";

export function AppNavigationButtons({ className }: { className?: string }) {
  const copy = useMessages().app.nav;
  const { canGoBack, canGoForward } = useAppNavigationState();
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
  const backShortcutLabel = isMac ? "⌘[" : "Alt+Left";
  const forwardShortcutLabel = isMac ? "⌘]" : "Alt+Right";

  if (!isElectron) {
    return null;
  }

  return (
    <div
      className={cn(
        "-ms-1 flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]",
        className,
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 rounded-lg"
              aria-label={copy.back}
              disabled={!canGoBack}
              onClick={() => goBackInAppHistory()}
            />
          }
        >
          <IoIosArrowRoundBack className="size-6" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{copy.backWithShortcut(backShortcutLabel)}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 rounded-lg"
              aria-label={copy.forward}
              disabled={!canGoForward}
              onClick={() => goForwardInAppHistory()}
            />
          }
        >
          <IoIosArrowRoundForward className="size-6" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{copy.forwardWithShortcut(forwardShortcutLabel)}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

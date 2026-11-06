import type { ComponentProps, CSSProperties } from "react";
import { CHAT_SURFACE_HEADER_HEIGHT_PX } from "@synara/shared/desktopChrome";
import { cn } from "~/lib/utils";
import { SidebarProvider } from "./ui/sidebar";

/** Local and remote content use the same shell surfaces and sidebar geometry. */
export function ChatShell({
  layout,
  ...props
}: ComponentProps<typeof SidebarProvider> & { readonly layout: "classic" | "rail" }) {
  const open = props.controls?.open ?? props.open ?? props.defaultOpen ?? true;
  return (
    <SidebarProvider
      {...props}
      className={cn(
        "h-svh overflow-hidden",
        layout === "rail" ? "bg-[var(--app-rail-shell-background)]" : "bg-background",
        props.className,
      )}
      style={
        {
          ...props.style,
          "--app-top-strip-height": `${CHAT_SURFACE_HEADER_HEIGHT_PX}px`,
        } as CSSProperties
      }
      data-sidebar-side="left"
      data-sidebar-layout={layout}
      data-shell-sidebar-state={open ? "expanded" : "collapsed"}
    />
  );
}

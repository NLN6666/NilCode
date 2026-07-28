import { Loader2Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useMessages } from "~/i18n/context";

function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2Icon>) {
  const copy = useMessages().app.ui;
  return (
    <Loader2Icon
      aria-label={copy.loading}
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };

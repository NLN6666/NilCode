// FILE: ThreadDetailHydrationState.tsx
// Purpose: Render the transcript placeholder while thread history syncs (or after it fails).
// Layer: Chat presentation
// Depends on: shared Spinner and Button primitives.

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useMessages } from "~/i18n/context";

export const ThreadDetailHydrationState = function ThreadDetailHydrationState({
  state,
  onRetry,
}: {
  state: "loading" | "failed";
  onRetry: () => void;
}) {
  const copy = useMessages().chat.hydration;
  if (state === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 select-none">
        <Spinner aria-label={copy.loading} className="size-5 text-muted-foreground/50" />
        <span className="text-sm text-muted-foreground/50">{copy.loading}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <span className="text-sm text-muted-foreground">{copy.failed}</span>
      <Button onClick={onRetry} size="sm" variant="outline">
        {copy.retry}
      </Button>
    </div>
  );
};

// FILE: ComposerBrowserElementChips.tsx
// Purpose: Renders elements picked in the in-app browser as composer attachment chips
//   and as their read-only transcript echo.
// Layer: Chat composer/transcript presentation
// Exports: ComposerBrowserElementChips, UserMessageBrowserElementChips

import {
  formatBrowserElementLabel,
  formatBrowserElementPreview,
  type BrowserElementDraft,
  type ParsedBrowserElementEntry,
} from "~/lib/browserElementContext";
import { CursorClickIcon } from "~/lib/icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AttachmentCard } from "./AttachmentCard";

// Minimal shape shared by composer drafts (BrowserElementDraft) and parsed transcript
// entries (ParsedBrowserElementEntry) so one chip renders both.
type BrowserElementChipEntry = Pick<
  BrowserElementDraft,
  "pageUrl" | "selector" | "tagName" | "elementId" | "classNames" | "textSnippet"
>;

function BrowserElementChip({
  element,
  onRemove,
}: {
  element: BrowserElementChipEntry;
  onRemove?: (() => void) | undefined;
}) {
  const label = formatBrowserElementLabel(element);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AttachmentCard
            size="sm"
            icon={<CursorClickIcon className="size-3" />}
            title={label}
            subtitle={<span className="truncate">{formatBrowserElementPreview(element)}</span>}
            onRemove={onRemove}
            removeLabel={`Remove ${label}`}
          />
        }
      />
      <TooltipPopup side="top" className="max-w-96 whitespace-pre-wrap leading-tight">
        <div className="space-y-0.5">
          <p className="text-[0.6875rem] font-medium text-muted-foreground">{element.pageUrl}</p>
          <p className="font-mono text-xs leading-relaxed">{element.selector}</p>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

interface ComposerBrowserElementChipsProps {
  elements: ReadonlyArray<BrowserElementDraft>;
  onRemove: (elementId: string) => void;
}

export function ComposerBrowserElementChips({
  elements,
  onRemove,
}: ComposerBrowserElementChipsProps) {
  if (elements.length === 0) {
    return null;
  }

  return (
    <>
      {elements.map((element) => (
        <BrowserElementChip
          key={element.id}
          element={element}
          onRemove={() => onRemove(element.id)}
        />
      ))}
    </>
  );
}

interface UserMessageBrowserElementChipsProps {
  elements: ReadonlyArray<ParsedBrowserElementEntry>;
}

// Transcript echo: the same chip without a dismiss affordance, so a sent message shows
// which page elements it carried instead of the raw <browser_elements> block.
export function UserMessageBrowserElementChips({ elements }: UserMessageBrowserElementChipsProps) {
  if (elements.length === 0) {
    return null;
  }

  return (
    <>
      {elements.map((element, index) => (
        <BrowserElementChip
          key={`${element.pageUrl}:${element.selector}:${index}`}
          element={element}
        />
      ))}
    </>
  );
}

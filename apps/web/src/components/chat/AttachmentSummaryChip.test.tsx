// FILE: AttachmentSummaryChip.test.tsx
// Purpose: Guards the shared count-pill chip (and its selection/comment wrappers)
//   against label, dismiss, and tooltip regressions after consolidation.
// Layer: Component rendering tests
// Depends on: the summary chip wrappers and React server rendering.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssistantSelectionsSummaryChip } from "./AssistantSelectionsSummaryChip";

describe("AssistantSelectionsSummaryChip", () => {
  it("renders a dismiss control when a handler is provided", () => {
    const markup = renderToStaticMarkup(
      <AssistantSelectionsSummaryChip
        selections={[
          { type: "assistant-selection", id: "a", assistantMessageId: "m1", text: "first" },
          { type: "assistant-selection", id: "b", assistantMessageId: "m1", text: "second" },
        ]}
        onRemove={() => {}}
      />,
    );

    expect(markup.match(/<span class="truncate">([^<]*)<\/span>/)?.[1]).toMatch(/\b2\b/u);
    expect(markup.match(/<button\b/g) ?? []).toHaveLength(1);
  });

  it("omits the dismiss control without an onRemove handler", () => {
    const markup = renderToStaticMarkup(
      <AssistantSelectionsSummaryChip
        selections={[
          { type: "assistant-selection", id: "a", assistantMessageId: "m1", text: "only" },
        ]}
      />,
    );

    expect(markup).not.toContain("<button");
    expect(markup.match(/<span class="truncate">([^<]*)<\/span>/)?.[1]).toMatch(/\b1\b/u);
  });

  it("renders nothing when empty", () => {
    expect(renderToStaticMarkup(<AssistantSelectionsSummaryChip selections={[]} />)).toBe("");
  });
});

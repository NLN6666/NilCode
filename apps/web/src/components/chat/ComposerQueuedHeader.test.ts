// FILE: ComposerQueuedHeader.test.ts
// Purpose: Locks the queued composer preview down to compact, inline markdown.
// Layer: Web chat composer tests
// Depends on: ComposerQueuedHeader preview sanitizer

import { describe, expect, it } from "vitest";

import { en } from "~/i18n/locales/en";
import { compactQueuedComposerPreviewMarkdown } from "./ComposerQueuedHeader";

const FALLBACKS = en.composer.queued;

describe("compactQueuedComposerPreviewMarkdown", () => {
  it("keeps inline markdown while dropping block-only heading/list syntax", () => {
    expect(compactQueuedComposerPreviewMarkdown("# **Ship** `src/app.ts`", FALLBACKS)).toBe(
      "**Ship** `src/app.ts`",
    );
    expect(compactQueuedComposerPreviewMarkdown("- [x] Review `src/app.ts`", FALLBACKS)).toBe(
      "Review `src/app.ts`",
    );
  });

  it("uses one representative line for multiline prompts and fenced code", () => {
    expect(compactQueuedComposerPreviewMarkdown("\n\nFirst line\nSecond line", FALLBACKS)).toBe(
      "First line",
    );
    expect(compactQueuedComposerPreviewMarkdown("```ts\nconsole.log('wide')\n```", FALLBACKS)).toBe(
      "Code block",
    );
  });

  it("falls back for empty block prefixes", () => {
    expect(compactQueuedComposerPreviewMarkdown("", FALLBACKS)).toBe("Queued follow-up");
    expect(compactQueuedComposerPreviewMarkdown(">", FALLBACKS)).toBe("Queued follow-up");
  });
});

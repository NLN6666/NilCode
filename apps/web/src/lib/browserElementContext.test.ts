import { describe, expect, it } from "vitest";
import type { BrowserElementSelection } from "@synara/contracts";

import {
  appendBrowserElementsToPrompt,
  browserElementDedupKey,
  buildBrowserElementsPromptBlock,
  createBrowserElementDraft,
  extractTrailingBrowserElements,
  formatBrowserElementLabel,
  formatBrowserElementPreview,
  normalizeBrowserElementSelection,
  stripTrailingBrowserElements,
} from "./browserElementContext";

function selection(overrides: Partial<BrowserElementSelection> = {}): BrowserElementSelection {
  return {
    tabId: "tab-1",
    pageUrl: "http://localhost:5173/dashboard",
    selector: "button.btn.btn-primary",
    tagName: "button",
    elementId: "submit-btn",
    classNames: ["btn", "btn-primary"],
    textSnippet: "Save changes",
    outerHtmlSnippet: '<button id="submit-btn" class="btn btn-primary">Save changes</button>',
    rect: { x: 240, y: 180, width: 320, height: 44 },
    computedStyles: {
      display: "inline-flex",
      "background-color": "rgb(37, 99, 235)",
      "font-size": "14px",
    },
    ...overrides,
  };
}

describe("normalizeBrowserElementSelection", () => {
  it("rejects a selection without a selector or tag name", () => {
    expect(normalizeBrowserElementSelection(selection({ selector: "  " }))).toBeNull();
    expect(normalizeBrowserElementSelection(selection({ tagName: "" }))).toBeNull();
  });

  it("collapses multi-line values so they cannot break the block shape", () => {
    const normalized = normalizeBrowserElementSelection(
      selection({ textSnippet: "Save\nchanges", outerHtmlSnippet: "<button>\n  hi\n</button>" }),
    );

    expect(normalized?.textSnippet).toBe("Save changes");
    expect(normalized?.outerHtmlSnippet).toBe("<button> hi </button>");
  });

  it("rounds rect values and clamps negative sizes", () => {
    const normalized = normalizeBrowserElementSelection(
      selection({ rect: { x: 12.4, y: -3.6, width: 100.5, height: -8 } }),
    );

    expect(normalized?.rect).toEqual({ x: 12, y: -4, width: 101, height: 0 });
  });
});

describe("createBrowserElementDraft", () => {
  it("adds an id and a timestamp", () => {
    const draft = createBrowserElementDraft(selection());

    expect(draft?.id).toBeTypeOf("string");
    expect(draft?.id.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(draft?.createdAt ?? ""))).toBe(false);
    expect(draft?.selector).toBe("button.btn.btn-primary");
  });

  it("returns null for an unusable selection", () => {
    expect(createBrowserElementDraft(selection({ selector: "" }))).toBeNull();
  });
});

describe("browserElementDedupKey", () => {
  it("matches the same selector on the same page", () => {
    expect(browserElementDedupKey(selection())).toBe(
      browserElementDedupKey(selection({ tabId: "tab-9" })),
    );
  });

  it("differs across pages", () => {
    expect(browserElementDedupKey(selection())).not.toBe(
      browserElementDedupKey(selection({ pageUrl: "http://localhost:5173/settings" })),
    );
  });
});

describe("formatBrowserElementLabel", () => {
  it("prefers the element id", () => {
    expect(formatBrowserElementLabel(selection())).toBe("button#submit-btn");
  });

  it("falls back to the first class names", () => {
    expect(
      formatBrowserElementLabel(
        selection({ elementId: null, classNames: ["btn", "btn-primary", "extra"] }),
      ),
    ).toBe("button.btn.btn-primary");
  });

  it("falls back to the tag name alone", () => {
    expect(formatBrowserElementLabel(selection({ elementId: null, classNames: [] }))).toBe(
      "button",
    );
  });
});

describe("formatBrowserElementPreview", () => {
  it("combines the host and the text snippet", () => {
    expect(formatBrowserElementPreview(selection())).toBe("localhost:5173 — Save changes");
  });

  it("uses the host alone when there is no text", () => {
    expect(formatBrowserElementPreview(selection({ textSnippet: null }))).toBe("localhost:5173");
  });

  it("truncates a long preview", () => {
    const preview = formatBrowserElementPreview(selection({ textSnippet: "x".repeat(200) }));

    expect(preview.length).toBe(52);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("buildBrowserElementsPromptBlock", () => {
  it("returns an empty string for no elements", () => {
    expect(buildBrowserElementsPromptBlock([])).toBe("");
    expect(buildBrowserElementsPromptBlock([selection({ selector: "" })])).toBe("");
  });

  it("serializes an element in the documented shape", () => {
    expect(buildBrowserElementsPromptBlock([selection()])).toBe(
      [
        "<browser_elements>",
        "- http://localhost:5173/dashboard — button.btn.btn-primary",
        "  tag: button   id: submit-btn   classes: btn, btn-primary",
        "  rect: 240,180 320x44",
        "  styles: display=inline-flex; background-color=rgb(37, 99, 235); font-size=14px",
        "  text: Save changes",
        '  html: <button id="submit-btn" class="btn btn-primary">Save changes</button>',
        "</browser_elements>",
      ].join("\n"),
    );
  });

  it("omits optional lines when the data is absent", () => {
    const block = buildBrowserElementsPromptBlock([
      selection({
        elementId: null,
        classNames: [],
        textSnippet: null,
        outerHtmlSnippet: "",
        computedStyles: {},
      }),
    ]);

    expect(block).toBe(
      [
        "<browser_elements>",
        "- http://localhost:5173/dashboard — button.btn.btn-primary",
        "  tag: button",
        "  rect: 240,180 320x44",
        "</browser_elements>",
      ].join("\n"),
    );
  });
});

describe("appendBrowserElementsToPrompt", () => {
  it("leaves the prompt untouched when there are no elements", () => {
    expect(appendBrowserElementsToPrompt("fix the button", [])).toBe("fix the button");
  });

  it("does not add a leading newline to an empty prompt", () => {
    const appended = appendBrowserElementsToPrompt("", [selection()]);

    expect(appended.startsWith("<browser_elements>")).toBe(true);
  });
});

describe("browser element prompt round trip", () => {
  it("survives build -> append -> extract -> strip", () => {
    const elements = [
      selection(),
      selection({
        pageUrl: "https://example.com/pricing",
        selector: 'div[data-role="card"] > h2:nth-of-type(2)',
        tagName: "h2",
        elementId: null,
        classNames: ["title"],
        textSnippet: "Pro plan",
        rect: { x: 0, y: 0, width: 10, height: 12 },
        computedStyles: { display: "block" },
      }),
    ];
    const prompt = appendBrowserElementsToPrompt("align these", elements);
    const extracted = extractTrailingBrowserElements(prompt);

    expect(extracted.promptText).toBe("align these");
    expect(stripTrailingBrowserElements(prompt)).toBe("align these");
    expect(extracted.elements).toHaveLength(2);
    expect(extracted.elements[0]).toEqual({
      pageUrl: "http://localhost:5173/dashboard",
      selector: "button.btn.btn-primary",
      tagName: "button",
      elementId: "submit-btn",
      classNames: ["btn", "btn-primary"],
      textSnippet: "Save changes",
      outerHtmlSnippet:
        '<button id="submit-btn" class="btn btn-primary">Save changes</button>',
      rect: { x: 240, y: 180, width: 320, height: 44 },
      computedStyles: {
        display: "inline-flex",
        "background-color": "rgb(37, 99, 235)",
        "font-size": "14px",
      },
    });
    expect(extracted.elements[1]?.selector).toBe('div[data-role="card"] > h2:nth-of-type(2)');
    expect(extracted.elements[1]?.elementId).toBeNull();
  });

  it("splits a style pair on the first '=' so the value keeps any later ones", () => {
    const prompt = appendBrowserElementsToPrompt("check", [
      selection({
        computedStyles: {
          "background-color": "color-mix(in srgb, var(--a) 50%, transparent)",
          "font-family": "ui-sans-serif",
        },
      }),
    ]);
    const extracted = extractTrailingBrowserElements(prompt);

    expect(extracted.elements[0]?.computedStyles).toEqual({
      "background-color": "color-mix(in srgb, var(--a) 50%, transparent)",
      "font-family": "ui-sans-serif",
    });
  });

  it("keeps an '=' inside a style value intact", () => {
    const prompt = appendBrowserElementsToPrompt("check", [
      selection({ computedStyles: { width: "calc(100% - 2px)", display: "a=b=c" } }),
    ]);
    const extracted = extractTrailingBrowserElements(prompt);

    expect(extracted.elements[0]?.computedStyles.display).toBe("a=b=c");
    expect(extracted.elements[0]?.computedStyles.width).toBe("calc(100% - 2px)");
  });

  it("does not treat an indented dash line inside an entry as a new entry", () => {
    const prompt = appendBrowserElementsToPrompt("check", [
      selection({ textSnippet: "- bullet — like a header" }),
    ]);
    const extracted = extractTrailingBrowserElements(prompt);

    expect(extracted.elements).toHaveLength(1);
    expect(extracted.elements[0]?.textSnippet).toBe("- bullet — like a header");
  });

  it("returns the prompt unchanged when there is no trailing block", () => {
    expect(extractTrailingBrowserElements("just a prompt")).toEqual({
      promptText: "just a prompt",
      elements: [],
    });
  });
});

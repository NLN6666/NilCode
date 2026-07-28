// FILE: themeFence.test.ts
// Purpose: Verifies theme-fence parsing/degradation, streaming closed-fence
//          detection, the sandboxed srcdoc contract, and the adoption messages.
// Layer: Web lib tests

import { describe, expect, it } from "vitest";
import {
  buildHtmlThemeAdoptionMessage,
  buildStructuredThemeAdoptionMessage,
  buildThemeFenceSrcdoc,
  isThemeFenceClosed,
  parseThemeFence,
} from "./themeFence";

const validPayloadJson = JSON.stringify({
  name: "Warm Dusk",
  colors: [
    { token: "background", hex: "#1B1412", note: "页面底色" },
    { token: "foreground", hex: "#F4E8E1" },
    { token: "accent", hex: "#E2725B" },
  ],
});

describe("parseThemeFence", () => {
  it("parses a complete payload", () => {
    const result = parseThemeFence(validPayloadJson);
    expect(result.kind).toBe("theme");
    if (result.kind !== "theme") return;
    expect(result.payload.name).toBe("Warm Dusk");
    expect(result.payload.colors).toHaveLength(3);
    expect(result.payload.colors[1]).toMatchObject({ token: "foreground", hex: "#F4E8E1" });
  });

  it("degrades truncated streaming JSON silently as invalid-json", () => {
    for (const frame of ["", "{", '{"name": "Warm Du', validPayloadJson.slice(0, -5)]) {
      expect(parseThemeFence(frame)).toEqual({ kind: "degrade", reason: "invalid-json" });
    }
  });

  it("flags valid JSON with missing fields as invalid-shape", () => {
    expect(parseThemeFence('{"name": "x"}')).toEqual({
      kind: "degrade",
      reason: "invalid-shape",
    });
    expect(parseThemeFence('{"name": "x", "colors": []}')).toEqual({
      kind: "degrade",
      reason: "invalid-shape",
    });
    expect(parseThemeFence('{"name": "x", "colors": [{"token": "bg"}]}')).toEqual({
      kind: "degrade",
      reason: "invalid-shape",
    });
    expect(parseThemeFence('{"name": "x", "colors": [{"token": "bg", "hex": "red"}]}')).toEqual({
      kind: "degrade",
      reason: "invalid-shape",
    });
  });
});

describe("isThemeFenceClosed", () => {
  const closedSource = "before\n```html theme\n<div></div>\n```\nafter";
  const openSource = "before\n```html theme\n<div></div>\n<p>still stream";

  it("treats completed messages as closed regardless of the source", () => {
    expect(
      isThemeFenceClosed({
        source: openSource,
        nodeEndOffset: openSource.length,
        isStreaming: false,
      }),
    ).toBe(true);
  });

  it("detects the closing fence while streaming", () => {
    const endOffset = closedSource.indexOf("\nafter");
    expect(
      isThemeFenceClosed({ source: closedSource, nodeEndOffset: endOffset, isStreaming: true }),
    ).toBe(true);
  });

  it("stays closed=false while the fence is still streaming in", () => {
    expect(
      isThemeFenceClosed({
        source: openSource,
        nodeEndOffset: openSource.length,
        isStreaming: true,
      }),
    ).toBe(false);
    expect(
      isThemeFenceClosed({ source: openSource, nodeEndOffset: undefined, isStreaming: true }),
    ).toBe(false);
  });
});

describe("buildThemeFenceSrcdoc", () => {
  it("keeps the sandbox CSP meta as the first head element", () => {
    const srcdoc = buildThemeFenceSrcdoc("<div>x</div>");
    expect(srcdoc).toContain(
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\">",
    );
    // The CSP must precede the agent markup so every fetch it could make is
    // already governed by the policy.
    expect(srcdoc.indexOf("Content-Security-Policy")).toBeLessThan(srcdoc.indexOf("<div>x</div>"));
  });
});

describe("adoption messages", () => {
  // The zh-CN wording, so the assertions read as the exact strings the design
  // spec (section 5) fixes for the shape of the message.
  const copy = {
    namedHeading: (name: string) => `已确认配色方案「${name}」：`,
    heading: "已确认配色方案：",
    request: "请应用到项目。",
  };

  it("formats the structured path with token names (design spec section 5)", () => {
    const result = parseThemeFence(validPayloadJson);
    if (result.kind !== "theme") throw new Error("expected a parsed theme");
    expect(buildStructuredThemeAdoptionMessage(result.payload, copy)).toBe(
      "已确认配色方案「Warm Dusk」：\nbackground #1B1412\nforeground #F4E8E1\naccent #E2725B\n请应用到项目。",
    );
  });

  it("formats the HTML path from deduplicated source colors", () => {
    const html =
      '<div style="background:#1B1412;color:#F4E8E1"><i style="color:#1b1412">x</i>#E2725B</div>';
    expect(buildHtmlThemeAdoptionMessage(html, copy)).toBe(
      "已确认配色方案：\n#1b1412 #f4e8e1 #e2725b\n请应用到项目。",
    );
  });

  it("carries the caller's locale wording through both paths", () => {
    const englishCopy = {
      namedHeading: (name: string) => `Confirmed color theme "${name}":`,
      heading: "Confirmed color theme:",
      request: "Please apply it to the project.",
    };
    const result = parseThemeFence(validPayloadJson);
    if (result.kind !== "theme") throw new Error("expected a parsed theme");
    expect(buildStructuredThemeAdoptionMessage(result.payload, englishCopy)).toBe(
      'Confirmed color theme "Warm Dusk":\nbackground #1B1412\nforeground #F4E8E1\naccent #E2725B\nPlease apply it to the project.',
    );
    expect(buildHtmlThemeAdoptionMessage('<i style="color:#1b1412"></i>', englishCopy)).toBe(
      "Confirmed color theme:\n#1b1412\nPlease apply it to the project.",
    );
  });

  it("returns null for HTML without any hex colors", () => {
    expect(buildHtmlThemeAdoptionMessage("<div>plain</div>", copy)).toBeNull();
  });
});

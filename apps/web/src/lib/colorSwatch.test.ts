// FILE: colorSwatch.test.ts
// Purpose: Exhausts the hex-matching boundaries the inline swatches depend on:
//          per-position accepted lengths and non-word boundary rules.
// Layer: Web lib tests

import { describe, expect, it } from "vitest";
import { extractHexColorsFromSource, findHexColorMatches } from "./colorSwatch";

describe("findHexColorMatches", () => {
  it("matches 6- and 8-digit hex in prose", () => {
    const text = "Use #1B1412 on #E2725BFF surfaces.";
    expect(findHexColorMatches(text, "prose").map((match) => match.hex)).toEqual([
      "#1B1412",
      "#E2725BFF",
    ]);
  });

  it("rejects 3- and 4-digit hex in prose (issue refs and anchors)", () => {
    expect(findHexColorMatches("see #123 and #abc and #abcd", "prose")).toEqual([]);
  });

  it("accepts 3-, 4-, 6-, and 8-digit hex in inline code", () => {
    expect(
      findHexColorMatches("#abc #abcd #aabbcc #aabbccdd", "inlineCode").map((m) => m.hex),
    ).toEqual(["#abc", "#abcd", "#aabbcc", "#aabbccdd"]);
  });

  it("never matches a prefix of a longer hex-like run", () => {
    // 10 hex digits: neither the 6- nor the 8-digit prefix may match.
    expect(findHexColorMatches("#deadbeef00", "prose")).toEqual([]);
    expect(findHexColorMatches("#deadbeef00", "inlineCode")).toEqual([]);
    // 7 digits: the 6-digit prefix is followed by a word char.
    expect(findHexColorMatches("#aabbccd", "prose")).toEqual([]);
  });

  it("requires a non-word boundary before the hash", () => {
    expect(findHexColorMatches("x#ffffff", "prose")).toEqual([]);
    expect(findHexColorMatches("1#ffffff", "prose")).toEqual([]);
    expect(findHexColorMatches("_#ffffff", "prose")).toEqual([]);
    expect(findHexColorMatches("##ffffff", "prose")).toEqual([]);
    expect(findHexColorMatches("(#ffffff)", "prose").map((m) => m.hex)).toEqual(["#ffffff"]);
  });

  it("requires a non-word boundary after the digits", () => {
    expect(findHexColorMatches("#ffffffg", "prose")).toEqual([]);
    expect(findHexColorMatches("#ffffff_", "prose")).toEqual([]);
    expect(findHexColorMatches("#ffffff.", "prose").map((m) => m.hex)).toEqual(["#ffffff"]);
    expect(findHexColorMatches("#ffffff", "prose").map((m) => m.hex)).toEqual(["#ffffff"]);
  });

  it("reports exact offsets for swatch insertion", () => {
    const text = "bg #1B1412 fg";
    expect(findHexColorMatches(text, "prose")).toEqual([{ start: 3, end: 10, hex: "#1B1412" }]);
  });

  it("short-circuits on text without a hash", () => {
    expect(findHexColorMatches("no colors here", "prose")).toEqual([]);
  });
});

describe("extractHexColorsFromSource", () => {
  it("dedupes case-insensitively in order of first appearance, lowercased", () => {
    const html =
      '<div style="color: #F4E8E1; background: #1b1412"><b style="color:#f4e8e1">x</b></div>';
    expect(extractHexColorsFromSource(html)).toEqual(["#f4e8e1", "#1b1412"]);
  });

  it("returns an empty list when the source names no hex colors", () => {
    expect(extractHexColorsFromSource("<div>plain</div>")).toEqual([]);
  });
});

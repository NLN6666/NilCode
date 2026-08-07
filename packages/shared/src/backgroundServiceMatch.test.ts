import { describe, expect, it } from "vitest";

import { CONTROL_CHARS, createOutputMatcher, stripCommandEcho } from "./backgroundServiceMatch";

describe("createOutputMatcher", () => {
  it("matches within a single chunk and reports which needle hit", () => {
    const matcher = createOutputMatcher(["Done ("]);
    expect(matcher.push("[12:00:00] [Server thread/INFO]: Done (12.3s)!")).toBe("Done (");
  });

  it("matches across a chunk boundary", () => {
    const matcher = createOutputMatcher(["Done ("]);
    expect(matcher.push("[Server thread/INFO]: Do")).toBeNull();
    expect(matcher.push("ne (12.3s)! For help")).toBe("Done (");
  });

  it("matches a needle split across three chunks", () => {
    const matcher = createOutputMatcher(["ABCDEF"]);
    expect(matcher.push("xxABC")).toBeNull();
    expect(matcher.push("DE")).toBeNull();
    expect(matcher.push("Fyy")).toBe("ABCDEF");
  });

  it("reports whichever needle hits first", () => {
    const matcher = createOutputMatcher(["Done (", "Exception"]);
    expect(matcher.push("java.lang.Exception: boom")).toBe("Exception");
  });

  it("keeps the carry window bounded while still matching later", () => {
    const matcher = createOutputMatcher(["ABC"]);
    for (let index = 0; index < 1000; index += 1) {
      expect(matcher.push("x".repeat(1000))).toBeNull();
    }
    expect(matcher.push("ABC")).toBe("ABC");
  });

  it("never matches with an empty needle list", () => {
    expect(createOutputMatcher([]).push("anything")).toBeNull();
  });

  it("ignores empty needles rather than matching everything", () => {
    const matcher = createOutputMatcher(["", "Done ("]);
    expect(matcher.push("nothing here")).toBeNull();
    expect(matcher.push("Done (1s)")).toBe("Done (");
  });

  it("matches a single-character needle with no carry window", () => {
    const matcher = createOutputMatcher(["!"]);
    expect(matcher.push("no bang")).toBeNull();
    expect(matcher.push("bang!")).toBe("!");
  });
});

describe("stripCommandEcho", () => {
  it("strips the echoed input line the PTY reflected back", () => {
    expect(stripCommandEcho("op Steve\r\nMade Steve a server operator\r\n", "op Steve")).toBe(
      "Made Steve a server operator\r\n",
    );
  });

  it("returns the content untouched when no echo appeared", () => {
    expect(stripCommandEcho("Made Steve a server operator\r\n", "op Steve")).toBe(
      "Made Steve a server operator\r\n",
    );
  });

  it("strips only the leading echo, not the same text inside the log body", () => {
    expect(stripCommandEcho("say hi\r\n<Steve> say hi\r\n", "say hi")).toBe("<Steve> say hi\r\n");
  });

  it("leaves matching text alone when it is not at the start", () => {
    expect(stripCommandEcho("<Steve> say hi\r\n", "say hi")).toBe("<Steve> say hi\r\n");
  });

  it("tolerates leading newlines before the echo", () => {
    expect(stripCommandEcho("\r\nstop\r\nStopping server\r\n", "stop")).toBe("Stopping server\r\n");
  });

  it("returns the content unchanged for blank input", () => {
    expect(stripCommandEcho("Stopping server\r\n", "   ")).toBe("Stopping server\r\n");
  });
});

describe("CONTROL_CHARS", () => {
  it("maps to the correct control bytes", () => {
    expect(CONTROL_CHARS["ctrl-c"]).toBe("\x03");
    expect(CONTROL_CHARS["ctrl-d"]).toBe("\x04");
  });
});

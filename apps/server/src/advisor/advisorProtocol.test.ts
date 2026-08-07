import { describe, expect, it } from "vitest";

import {
  ADVISOR_SYSTEM_PROMPT,
  buildAdvisorEvaluationPrompt,
  parseAdvisorVerdict,
} from "./advisorProtocol.ts";

describe("ADVISOR_SYSTEM_PROMPT", () => {
  // The advisor's only output channel is a verdict object; free text is dropped
  // by parseAdvisorVerdict, so the prompt has to make the shape unambiguous.
  it("states both verdict shapes", () => {
    expect(ADVISOR_SYSTEM_PROMPT).toContain("silent");
    expect(ADVISOR_SYSTEM_PROMPT).toContain("advise");
  });

  it("names every severity", () => {
    for (const severity of ["nit", "concern", "blocker"]) {
      expect(ADVISOR_SYSTEM_PROMPT).toContain(severity);
    }
  });

  // Silence has to be presented as the expected outcome. An advisor that reads
  // its instructions as "review this" will find something to say every time.
  it("frames silence as the default", () => {
    expect(ADVISOR_SYSTEM_PROMPT.toLowerCase()).toContain("silent");
  });
});

describe("buildAdvisorEvaluationPrompt", () => {
  it("carries the delta", () => {
    const prompt = buildAdvisorEvaluationPrompt({
      delta: "[tool.updated] Read a.ts",
      workInProgress: false,
    });

    expect(prompt).toContain("[tool.updated] Read a.ts");
  });

  // Half-finished work must be labelled, or the advisor critiques a partial
  // change as though it were final.
  it("tells the advisor when the work is unfinished", () => {
    const prompt = buildAdvisorEvaluationPrompt({ delta: "x", workInProgress: true });

    expect(prompt.toLowerCase()).toContain("still in progress");
  });

  it("does not claim work is unfinished when it has settled", () => {
    const prompt = buildAdvisorEvaluationPrompt({ delta: "x", workInProgress: false });

    expect(prompt.toLowerCase()).not.toContain("still in progress");
  });
});

describe("parseAdvisorVerdict", () => {
  it("parses a silent verdict", () => {
    expect(parseAdvisorVerdict('{"verdict":"silent"}')).toEqual({ verdict: "silent" });
  });

  it("parses advice with a severity", () => {
    expect(
      parseAdvisorVerdict('{"verdict":"advise","severity":"concern","message":"reuse the helper"}'),
    ).toEqual({ verdict: "advise", severity: "concern", message: "reuse the helper" });
  });

  // Models wrap JSON in fences constantly. Stripping formatting is not the same
  // as loosening the schema - the object inside still has to be exactly right.
  it("parses a verdict wrapped in a code fence", () => {
    expect(parseAdvisorVerdict('```json\n{"verdict":"silent"}\n```')).toEqual({
      verdict: "silent",
    });
  });

  it("parses a verdict with surrounding prose", () => {
    expect(
      parseAdvisorVerdict('Here is my assessment:\n\n{"verdict":"silent"}\n\nLet me know.'),
    ).toEqual({ verdict: "silent" });
  });

  // No salvage: an advisor that emits free text must be treated as having
  // failed, not as having said something. Guessing intent from prose would let
  // it bypass every guard downstream.
  it("returns null for prose with no verdict object", () => {
    expect(parseAdvisorVerdict("I think you should reuse the helper in shared/text")).toBeNull();
  });

  it("returns null for a verdict missing its severity", () => {
    expect(parseAdvisorVerdict('{"verdict":"advise","message":"reuse the helper"}')).toBeNull();
  });

  it("returns null for an unknown severity", () => {
    expect(
      parseAdvisorVerdict('{"verdict":"advise","severity":"urgent","message":"stop"}'),
    ).toBeNull();
  });

  it("returns null for malformed json", () => {
    expect(parseAdvisorVerdict('{"verdict":')).toBeNull();
  });

  it("returns null for empty output", () => {
    expect(parseAdvisorVerdict("   ")).toBeNull();
  });
});

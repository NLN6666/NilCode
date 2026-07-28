// FILE: promptInjectionBudget.test.ts
// Purpose: Verifies the shared injection budget arithmetic every prompt
//          injection source (skills, color preview, thread-mention context)
//          must go through.
// Layer: Server provider tests

import { describe, expect, it } from "vitest";

import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@synara/contracts";

import {
  availablePromptInjectionChars,
  PROVIDER_INPUT_SAFETY_MARGIN_CHARS,
} from "./promptInjectionBudget.ts";

describe("availablePromptInjectionChars", () => {
  it("subtracts the used length and the safety margin from the turn limit", () => {
    expect(availablePromptInjectionChars(0)).toBe(
      PROVIDER_SEND_TURN_MAX_INPUT_CHARS - PROVIDER_INPUT_SAFETY_MARGIN_CHARS,
    );
    expect(availablePromptInjectionChars(10_000)).toBe(
      PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 10_000 - PROVIDER_INPUT_SAFETY_MARGIN_CHARS,
    );
  });

  it("clamps at zero once the input fills the budget", () => {
    expect(
      availablePromptInjectionChars(
        PROVIDER_SEND_TURN_MAX_INPUT_CHARS - PROVIDER_INPUT_SAFETY_MARGIN_CHARS,
      ),
    ).toBe(0);
    expect(availablePromptInjectionChars(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)).toBe(0);
    expect(availablePromptInjectionChars(PROVIDER_SEND_TURN_MAX_INPUT_CHARS * 2)).toBe(0);
  });

  it("models sequential injections competing for one budget", () => {
    // A first injection that consumes N chars shrinks what the next source may
    // add by exactly N — the invariant that keeps skills + color preview from
    // overflowing the same turn.
    const base = 5_000;
    const firstInjection = 2_500;
    expect(availablePromptInjectionChars(base + firstInjection)).toBe(
      availablePromptInjectionChars(base) - firstInjection,
    );
  });
});

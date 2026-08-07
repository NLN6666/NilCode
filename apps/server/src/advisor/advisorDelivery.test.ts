import { describe, expect, it } from "vitest";

import {
  ADVISOR_IMMUNE_TURNS,
  type AdvisorDeliveryContext,
  INITIAL_ADVISOR_IMMUNITY_STATE,
  isAdvisorInterruptImmune,
  markAdvisorInterruptDelivered,
  resolveAdvisorDeliveryChannel,
  shouldWithholdAdvice,
} from "./advisorDelivery.ts";

const context = (overrides: Partial<AdvisorDeliveryContext> = {}): AdvisorDeliveryContext => ({
  severity: "concern",
  turnRunning: true,
  turnInterrupting: false,
  planModeActive: false,
  interruptImmune: false,
  ...overrides,
});

describe("resolveAdvisorDeliveryChannel", () => {
  it("steers a concern during a live turn", () => {
    expect(resolveAdvisorDeliveryChannel(context())).toBe("steer");
  });

  it("steers a blocker during a live turn", () => {
    expect(resolveAdvisorDeliveryChannel(context({ severity: "blocker" }))).toBe("steer");
  });

  // A nit is never worth cutting into a running turn; it rides along at the next
  // boundary instead.
  it("routes a nit as an aside even during a live turn", () => {
    expect(resolveAdvisorDeliveryChannel(context({ severity: "nit" }))).toBe("aside");
  });

  // Plan mode is the user deciding what happens next. An advisor steer would
  // start work the user has not approved, so the note becomes a visible card.
  it("preserves any note while plan mode is active", () => {
    expect(resolveAdvisorDeliveryChannel(context({ planModeActive: true }))).toBe("preserve");
    expect(
      resolveAdvisorDeliveryChannel(context({ planModeActive: true, severity: "blocker" })),
    ).toBe("preserve");
  });

  // With no turn running, a steer would not redirect anything - it would start a
  // fresh turn the user never asked for. Only a blocker earns that.
  it("preserves a concern when no turn is running", () => {
    expect(resolveAdvisorDeliveryChannel(context({ turnRunning: false }))).toBe("preserve");
  });

  it("still steers a blocker when no turn is running", () => {
    expect(
      resolveAdvisorDeliveryChannel(context({ turnRunning: false, severity: "blocker" })),
    ).toBe("steer");
  });

  // The user interrupting is an explicit instruction to stop. The advisor must
  // not undo it by immediately starting the turn again.
  it("preserves a note while the turn is being interrupted", () => {
    expect(resolveAdvisorDeliveryChannel(context({ turnInterrupting: true }))).toBe("preserve");
    expect(
      resolveAdvisorDeliveryChannel(context({ turnInterrupting: true, severity: "blocker" })),
    ).toBe("preserve");
  });

  // Immunity is what breaks the tug-of-war: having just interrupted, the advisor
  // gives the model room to react instead of interrupting again.
  it("downgrades an interrupting note to an aside while immune", () => {
    expect(resolveAdvisorDeliveryChannel(context({ interruptImmune: true }))).toBe("aside");
    expect(
      resolveAdvisorDeliveryChannel(context({ interruptImmune: true, severity: "blocker" })),
    ).toBe("aside");
  });

  it("leaves a nit as an aside while immune", () => {
    expect(resolveAdvisorDeliveryChannel(context({ interruptImmune: true, severity: "nit" }))).toBe(
      "aside",
    );
  });
});

describe("advisor interrupt immunity", () => {
  it("is not immune before any interrupt is delivered", () => {
    expect(isAdvisorInterruptImmune(INITIAL_ADVISOR_IMMUNITY_STATE, 0)).toBe(false);
  });

  it("becomes immune once an interrupt is delivered", () => {
    const state = markAdvisorInterruptDelivered(5);

    expect(isAdvisorInterruptImmune(state, 5)).toBe(true);
  });

  it("stays immune until the configured number of turns has completed", () => {
    const state = markAdvisorInterruptDelivered(5);

    for (let offset = 0; offset < ADVISOR_IMMUNE_TURNS; offset += 1) {
      expect(isAdvisorInterruptImmune(state, 5 + offset)).toBe(true);
    }
    expect(isAdvisorInterruptImmune(state, 5 + ADVISOR_IMMUNE_TURNS)).toBe(false);
  });
});

describe("shouldWithholdAdvice", () => {
  // Judging half-finished work produces advice about things the model was
  // already about to do. Only a blocker is worth acting on that early.
  it("withholds a nit about work still in progress", () => {
    expect(shouldWithholdAdvice({ severity: "nit", workInProgress: true })).toBe(true);
  });

  it("withholds a concern about work still in progress", () => {
    expect(shouldWithholdAdvice({ severity: "concern", workInProgress: true })).toBe(true);
  });

  it("lets a blocker through even about work in progress", () => {
    expect(shouldWithholdAdvice({ severity: "blocker", workInProgress: true })).toBe(false);
  });

  it("withholds nothing once the work has settled", () => {
    for (const severity of ["nit", "concern", "blocker"] as const) {
      expect(shouldWithholdAdvice({ severity, workInProgress: false })).toBe(false);
    }
  });
});

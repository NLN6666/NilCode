import { describe, expect, it } from "vitest";

import { advisorDeliveryId, isAdvisorDeliveredMessageId } from "./advisorDelivery";

describe("advisorDeliveryId", () => {
  it("keeps the parts of one delivery distinct", () => {
    const marker = "thread-1:3";

    expect(advisorDeliveryId(marker, "message")).not.toBe(advisorDeliveryId(marker, "turn"));
  });

  it("keeps separate notes distinct", () => {
    expect(advisorDeliveryId("thread-1:3", "message")).not.toBe(
      advisorDeliveryId("thread-1:4", "message"),
    );
  });
});

describe("isAdvisorDeliveredMessageId", () => {
  // The writer and the reader have to agree, or the transcript renders the
  // advisor's own note as a user bubble.
  it("recognises an id this module minted", () => {
    expect(isAdvisorDeliveredMessageId(advisorDeliveryId("thread-1:3", "message"))).toBe(true);
  });

  it("leaves an ordinary message alone", () => {
    expect(isAdvisorDeliveredMessageId("message-1")).toBe(false);
  });

  // Automation and agent-gateway turns share dispatchOrigin "agent" with the
  // advisor; only the id tells them apart.
  it("leaves another agent-dispatched message alone", () => {
    expect(isAdvisorDeliveredMessageId("automation:run-7:message")).toBe(false);
  });
});

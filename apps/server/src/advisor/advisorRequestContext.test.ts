import { describe, expect, it } from "vitest";

import {
  ADVISOR_REQUEST_MAX_CHARS,
  ADVISOR_REQUEST_WINDOW,
  INITIAL_ADVISOR_REQUEST_STATE,
  buildAdvisorRequestContext,
  recordAdvisorRequest,
  type AdvisorRequestInput,
  type AdvisorRequestState,
} from "./advisorRequestContext.ts";

const message = (overrides: Partial<AdvisorRequestInput> = {}): AdvisorRequestInput => ({
  messageId: "message-1",
  role: "user",
  text: "add rate limiting to the login route",
  dispatchOrigin: "user",
  ...overrides,
});

const record = (
  inputs: readonly Partial<AdvisorRequestInput>[],
  state: AdvisorRequestState = INITIAL_ADVISOR_REQUEST_STATE,
): AdvisorRequestState =>
  inputs.reduce((current, input) => recordAdvisorRequest(current, message(input)), state);

describe("recordAdvisorRequest", () => {
  it("keeps a user message", () => {
    expect(recordAdvisorRequest(INITIAL_ADVISOR_REQUEST_STATE, message()).entries).toEqual([
      { messageId: "message-1", text: "add rate limiting to the login route" },
    ]);
  });

  // Assistant messages are re-sent once per stream delta, so admitting them
  // would rewrite the goal hundreds of times within a single turn.
  it("ignores assistant and system messages", () => {
    const state = record([{ role: "assistant" }, { messageId: "message-2", role: "system" }]);

    expect(state).toBe(INITIAL_ADVISOR_REQUEST_STATE);
  });

  // The advisor's own notes are delivered as role "user"; reading them as the
  // goal would let the advisor redefine the task it is checking against.
  it("ignores messages the agent dispatched", () => {
    const state = record([{ dispatchOrigin: "agent", text: "[advisor · nit] use the helper" }]);

    expect(state).toBe(INITIAL_ADVISOR_REQUEST_STATE);
  });

  it("keeps automation-dispatched requests", () => {
    const state = record([{ dispatchOrigin: "automation" }]);

    expect(state.entries).toHaveLength(1);
  });

  it("treats a message with no dispatch origin as a user request", () => {
    const state = record([{ dispatchOrigin: undefined }]);

    expect(state.entries).toHaveLength(1);
  });

  it("ignores an empty message", () => {
    expect(record([{ text: "   " }])).toBe(INITIAL_ADVISOR_REQUEST_STATE);
  });

  it("keeps the most recent messages, oldest first", () => {
    const state = record(
      Array.from({ length: ADVISOR_REQUEST_WINDOW + 2 }, (_, index) => ({
        messageId: `message-${index}`,
        text: `ask ${index}`,
      })),
    );

    expect(state.entries.map((entry) => entry.text)).toEqual(["ask 2", "ask 3", "ask 4"]);
  });

  // An edit-and-resend replays one message; it is not a second request.
  it("replaces an entry re-sent under the same id", () => {
    const state = record([{ text: "first wording" }, { text: "second wording" }]);

    expect(state.entries).toEqual([{ messageId: "message-1", text: "second wording" }]);
  });

  it("returns the same state when nothing changed", () => {
    const first = record([{}]);

    expect(recordAdvisorRequest(first, message())).toBe(first);
  });

  it("truncates a request longer than the cap", () => {
    const state = record([{ text: "x".repeat(ADVISOR_REQUEST_MAX_CHARS * 2) }]);
    const text = state.entries[0]?.text ?? "";

    expect(text).toHaveLength(ADVISOR_REQUEST_MAX_CHARS);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("buildAdvisorRequestContext", () => {
  it("returns null before any request", () => {
    expect(buildAdvisorRequestContext(INITIAL_ADVISOR_REQUEST_STATE)).toBeNull();
  });

  // Marking every entry, not just the newest, is what keeps a request spanning
  // several lines from reading as two separate requests.
  it("marks each request so multi-line text stays one request", () => {
    const state = record([
      { messageId: "message-1", text: "build the parser\nand a test" },
      { messageId: "message-2", text: "now wire it up" },
    ]);

    expect(buildAdvisorRequestContext(state)).toBe(
      "[user]\nbuild the parser\nand a test\n[user]\nnow wire it up",
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  EMPTY_ADVISOR_RESPONSE,
  foldAdvisorResponseEvent,
  type AdvisorResponseState,
} from "./advisorResponseCollector.ts";

function fold(
  events: ReadonlyArray<{ readonly type: string; readonly payload?: unknown }>,
): AdvisorResponseState {
  return events.reduce(foldAdvisorResponseEvent, EMPTY_ADVISOR_RESPONSE);
}

function assistantMessage(detail: string) {
  return { type: "item.completed", payload: { itemType: "assistant_message", detail } };
}

describe("foldAdvisorResponseEvent", () => {
  it("starts pending with no text", () => {
    expect(EMPTY_ADVISOR_RESPONSE).toEqual({ text: "", outcome: "pending" });
  });

  it("collects assistant message text", () => {
    const state = fold([assistantMessage('{"verdict":"silent"}')]);

    expect(state.text).toBe('{"verdict":"silent"}');
  });

  // Providers split a reply across blocks. The verdict object can straddle
  // them, so the parts have to be rejoined before parsing.
  it("joins multiple assistant messages", () => {
    const state = fold([assistantMessage('{"verdict":'), assistantMessage('"silent"}')]);

    expect(state.text).toBe('{"verdict":\n"silent"}');
  });

  // Reasoning is the model's private trace. Folding it in would feed
  // parseAdvisorVerdict a JSON object the advisor was only thinking about.
  it("ignores reasoning items", () => {
    const state = fold([
      {
        type: "item.completed",
        payload: { itemType: "reasoning", detail: '{"verdict":"advise"}' },
      },
      assistantMessage('{"verdict":"silent"}'),
    ]);

    expect(state.text).toBe('{"verdict":"silent"}');
  });

  it("ignores an assistant message with no detail", () => {
    const state = fold([{ type: "item.completed", payload: { itemType: "assistant_message" } }]);

    expect(state).toEqual(EMPTY_ADVISOR_RESPONSE);
  });

  it("settles on turn completion", () => {
    const state = fold([assistantMessage("x"), { type: "turn.completed" }]);

    expect(state.outcome).toBe("completed");
  });

  it("stays pending while items arrive", () => {
    expect(fold([assistantMessage("x")]).outcome).toBe("pending");
  });

  it.each(["turn.aborted", "runtime.error", "session.exited"])("fails on %s", (type) => {
    expect(fold([assistantMessage("x"), { type }]).outcome).toBe("failed");
  });

  // The caller stops reading at the first settled state, but the stream is
  // shared and may deliver a late event before the fiber unsubscribes.
  it("does not reopen a settled response", () => {
    const state = fold([
      assistantMessage("first"),
      { type: "turn.completed" },
      assistantMessage("late"),
      { type: "turn.aborted" },
    ]);

    expect(state).toEqual({ text: "first", outcome: "completed" });
  });

  it("ignores unrelated events", () => {
    const state = fold([
      { type: "turn.started" },
      { type: "content.delta", payload: { delta: "x" } },
      { type: "thread.token-usage.updated" },
    ]);

    expect(state).toEqual(EMPTY_ADVISOR_RESPONSE);
  });
});

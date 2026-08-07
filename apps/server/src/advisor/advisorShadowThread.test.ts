import { ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  ADVISOR_SHADOW_THREAD_PREFIX,
  advisorShadowThreadId,
  isAdvisorShadowThreadId,
  mainThreadIdFromAdvisorShadow,
} from "./advisorShadowThread.ts";

const main = ThreadId.makeUnsafe("thread-abc123");

describe("advisorShadowThreadId", () => {
  it("derives a shadow id carrying the main thread id", () => {
    expect(advisorShadowThreadId(main)).toBe(`${ADVISOR_SHADOW_THREAD_PREFIX}thread-abc123`);
  });

  // An advisor watching an advisor is not a thing. Deriving from a shadow id
  // must be idempotent rather than nesting prefixes forever.
  it("is idempotent on an id that is already a shadow", () => {
    const shadow = advisorShadowThreadId(main);

    expect(advisorShadowThreadId(shadow)).toBe(shadow);
  });
});

describe("isAdvisorShadowThreadId", () => {
  // This predicate is the isolation boundary: ProviderRuntimeIngestion uses it
  // to drop shadow-session events before they are journalled and projected
  // against a thread that does not exist.
  it("identifies a shadow id", () => {
    expect(isAdvisorShadowThreadId(advisorShadowThreadId(main))).toBe(true);
  });

  it("does not match an ordinary thread id", () => {
    expect(isAdvisorShadowThreadId(main)).toBe(false);
  });

  it("does not match an id that merely contains the prefix", () => {
    expect(isAdvisorShadowThreadId(ThreadId.makeUnsafe("thread-advisor:x"))).toBe(false);
  });
});

describe("mainThreadIdFromAdvisorShadow", () => {
  it("recovers the watched thread id", () => {
    expect(mainThreadIdFromAdvisorShadow(advisorShadowThreadId(main))).toBe(main);
  });

  it("returns null for an ordinary thread id", () => {
    expect(mainThreadIdFromAdvisorShadow(main)).toBeNull();
  });

  it("returns null for a prefix with nothing after it", () => {
    expect(mainThreadIdFromAdvisorShadow(ADVISOR_SHADOW_THREAD_PREFIX)).toBeNull();
  });
});

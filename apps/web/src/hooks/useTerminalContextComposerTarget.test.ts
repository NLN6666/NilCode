// FILE: useTerminalContextComposerTarget.test.ts
// Purpose: Covers the composer-target registry subscription used by terminal surfaces.
// Layer: Web hook test

import { beforeEach, describe, expect, it, vi } from "vitest";

const reactHarness = vi.hoisted(() => {
  interface HookSlot {
    deps?: readonly unknown[];
    value?: unknown;
    unsubscribe?: () => void;
  }

  let slots: HookSlot[] = [];
  let cursor = 0;
  let notificationCount = 0;
  const nextSlot = () => {
    const slot = (slots[cursor] ??= {});
    cursor += 1;
    return slot;
  };
  const depsEqual = (left: readonly unknown[] | undefined, right: readonly unknown[]) =>
    left !== undefined &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));

  return {
    beginRender() {
      cursor = 0;
    },
    notifications() {
      return notificationCount;
    },
    reset() {
      for (const slot of slots) slot.unsubscribe?.();
      slots = [];
      cursor = 0;
      notificationCount = 0;
    },
    useCallback<T>(callback: T, deps: readonly unknown[]): T {
      const slot = nextSlot();
      if (!depsEqual(slot.deps, deps)) {
        slot.deps = deps;
        slot.value = callback;
      }
      return slot.value as T;
    },
    useSyncExternalStore<T>(
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => T,
    ): T {
      const slot = nextSlot();
      if (slot.value !== subscribe) {
        slot.unsubscribe?.();
        slot.value = subscribe;
        slot.unsubscribe = subscribe(() => {
          notificationCount += 1;
        });
      }
      return getSnapshot();
    },
  };
});

vi.mock("react", () => ({
  useCallback: reactHarness.useCallback,
  useSyncExternalStore: reactHarness.useSyncExternalStore,
}));

import type { TerminalContextComposerTarget } from "~/lib/terminalContextComposerRegistry";
import { registerTerminalContextComposerTarget } from "~/lib/terminalContextComposerRegistry";
import { useTerminalContextComposerTarget } from "./useTerminalContextComposerTarget";

function render(paneScopeId: string): TerminalContextComposerTarget | undefined {
  reactHarness.beginRender();
  return useTerminalContextComposerTarget(paneScopeId);
}

beforeEach(() => {
  reactHarness.reset();
});

describe("useTerminalContextComposerTarget", () => {
  it("returns undefined when the pane has no registration", () => {
    expect(render("hook-no-registration")).toBeUndefined();
  });

  it("returns the current target and subscribes to its availability", () => {
    const target = vi.fn();

    expect(render("hook-current-target")).toBeUndefined();
    const cleanup = registerTerminalContextComposerTarget("hook-current-target", target);

    expect(reactHarness.notifications()).toBe(1);
    expect(render("hook-current-target")).toBe(target);

    cleanup();
  });

  it("returns the newer target after a replacement", () => {
    const firstTarget = vi.fn();
    const newerTarget = vi.fn();
    const cleanupFirst = registerTerminalContextComposerTarget("hook-replacement", firstTarget);

    expect(render("hook-replacement")).toBe(firstTarget);
    const cleanupNewer = registerTerminalContextComposerTarget("hook-replacement", newerTarget);
    expect(render("hook-replacement")).toBe(newerTarget);

    cleanupFirst();
    cleanupNewer();
  });

  it("returns undefined after the current target cleans up", () => {
    const cleanup = registerTerminalContextComposerTarget("hook-current-cleanup", vi.fn());

    expect(render("hook-current-cleanup")).toBeDefined();
    cleanup();
    expect(render("hook-current-cleanup")).toBeUndefined();
  });

  it("keeps the newer target when a stale target cleans up", () => {
    const firstTarget = vi.fn();
    const newerTarget = vi.fn();
    const cleanupFirst = registerTerminalContextComposerTarget("hook-stale-cleanup", firstTarget);
    const cleanupNewer = registerTerminalContextComposerTarget("hook-stale-cleanup", newerTarget);

    cleanupFirst();

    expect(render("hook-stale-cleanup")).toBe(newerTarget);

    cleanupNewer();
  });
});

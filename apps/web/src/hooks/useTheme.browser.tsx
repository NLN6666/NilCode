// FILE: useTheme.browser.tsx
// Purpose: Browser-level regressions for theme-store subscription and DOM projection.
// Layer: Web hook browser tests

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

import { useTheme } from "./useTheme";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("useTheme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not reproject unchanged root variables for each subscriber mount", async () => {
    const rootStyle = document.documentElement.style;
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
    let rootVariableWrites = 0;
    vi.spyOn(CSSStyleDeclaration.prototype, "setProperty").mockImplementation(function setProperty(
      this: CSSStyleDeclaration,
      property: string,
      value: string | null,
      priority?: string,
    ) {
      if (this === rootStyle && property.startsWith("--")) {
        rootVariableWrites += 1;
      }
      originalSetProperty.call(this, property, value, priority);
    });

    const first = await renderHook(() => useTheme());
    const second = await renderHook(() => useTheme());
    await nextFrame();

    expect(rootVariableWrites).toBe(0);

    await second.unmount();
    await first.unmount();
  });

  it("projects a semantic theme change once and ignores an identical update", async () => {
    const hook = await renderHook(() => useTheme());
    const originalTheme = hook.result.current.theme;
    const nextTheme = originalTheme === "dark" ? "light" : "dark";
    const rootStyle = document.documentElement.style;
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
    let rootVariableWrites = 0;
    vi.spyOn(CSSStyleDeclaration.prototype, "setProperty").mockImplementation(function setProperty(
      this: CSSStyleDeclaration,
      property: string,
      value: string | null,
      priority?: string,
    ) {
      if (this === rootStyle && property.startsWith("--")) {
        rootVariableWrites += 1;
      }
      originalSetProperty.call(this, property, value, priority);
    });

    hook.result.current.setTheme(nextTheme);
    await expect.poll(() => document.documentElement.dataset.themeMode).toBe(nextTheme);
    expect(rootVariableWrites).toBeGreaterThan(0);

    const writesAfterChange = rootVariableWrites;
    hook.result.current.setTheme(nextTheme);
    await nextFrame();
    expect(rootVariableWrites).toBe(writesAfterChange);

    hook.result.current.setTheme(originalTheme);
    await expect.poll(() => document.documentElement.dataset.themeMode).toBe(originalTheme);
    await hook.unmount();
  });
});

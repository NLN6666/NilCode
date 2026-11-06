// FILE: ComputerSettingsPanel.test.tsx
// Purpose: Guards what the Computer settings panel tells the user about the
//          desktop backend — the one attention row, the calm ready state, and
//          the chrome it must not grow back (a manual re-arm, spec-sheet rows,
//          duplicate permission surfaces).
// Layer: Component rendering tests
// Depends on: ComputerSettingsPanel and React server rendering.
//
// Rendered to static markup with the status query primed, which is enough for
// every question worth asking of this panel: it is a read-out, and what it
// reads out is decided at render time. Interaction (pressing Set up) belongs to
// `useProvisionComputer.test.tsx`, which owns that mutation.

import type { ComputerStatusResult } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AppSettingsSchema,
  applyLocalAppSettingsPatch,
  resolveAgentCursorColors,
  type AppSettings,
  type AppSettingsBinding,
} from "~/appSettings";
import { serverQueryKeys } from "~/lib/serverReactQuery";
import { ComputerSettingsPanel } from "./ComputerSettingsPanel";

vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));

function capabilities(overrides: Partial<ComputerStatusResult["capabilities"]> = {}) {
  return {
    windows: true,
    windowBounds: true,
    stacking: true,
    capture: true,
    input: true,
    clipboard: true,
    focus: true,
    raise: true,
    ghostCursor: true,
    visibleDesktop: true,
    ...overrides,
  };
}

function status(overrides: Partial<ComputerStatusResult> = {}): ComputerStatusResult {
  return {
    computerId: "desktop",
    availability: { kind: "available", backend: "mac" },
    capabilities: capabilities(),
    health: { status: "connected", consecutiveFailures: 0, reconnects: 0, captureAvailable: true },
    ...overrides,
  };
}

function binding(overrides: Partial<AppSettings> = {}): AppSettingsBinding {
  return {
    settings: { autoOpenComputerPane: true, computerControlEnabled: true, ...overrides },
    defaults: { autoOpenComputerPane: true, computerControlEnabled: false },
    updateSettings: vi.fn(),
  } as unknown as AppSettingsBinding;
}

function render(input: {
  readonly status?: ComputerStatusResult;
  readonly active?: boolean;
  readonly settings?: Partial<AppSettings>;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (input.status) queryClient.setQueryData(serverQueryKeys.computerStatus(), input.status);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ComputerSettingsPanel {...binding(input.settings)} active={input.active ?? true} />
    </QueryClientProvider>,
  );
}

function buttonCount(markup: string): number {
  return markup.match(/<button\b/g)?.length ?? 0;
}

describe("ComputerSettingsPanel", () => {
  it("renders nothing while the panel is not the active one", () => {
    // The status query is gated on the same flag; a panel nobody is looking at
    // must not poll a backend awake.
    expect(render({ status: status(), active: false })).toBe("");
  });

  it("keeps the ready surface free of a recovery action", () => {
    const markup = render({ status: status() });
    expect(markup).toContain('id="setting-computer-control"');
    expect(buttonCount(markup)).toBe(buttonCount(render({})));
    expect(markup).not.toContain('role="alert"');
  });

  it("asks to check access while nothing has confirmed the grants", () => {
    // After a restart the backend is idle, and without the OS's own grant
    // answer an idle backend is not evidence that anything works.
    const readyMarkup = render({ status: status() });
    const markup = render({
      status: status({
        health: {
          status: "unavailable",
          consecutiveFailures: 0,
          reconnects: 0,
          captureAvailable: false,
        },
      }),
    });
    expect(buttonCount(markup)).toBe(buttonCount(readyMarkup) + 1);
  });

  it("offers one recovery action and preserves a backend permission diagnostic", () => {
    const markup = render({
      status: status({
        availability: {
          kind: "permission-required",
          missing: ["accessibility", "screenRecording"],
          message: "macOS is asking for Accessibility.",
          buildSignature: "adhoc",
        },
      }),
    });
    expect(buttonCount(markup)).toBe(buttonCount(render({ status: status() })) + 1);
    // This diagnostic is supplied by the backend rather than being UI copy.
    expect(markup).toContain("macOS is asking for Accessibility.");
  });

  it("offers recovery when a connected desktop cannot capture", () => {
    const readyMarkup = render({ status: status() });
    const markup = render({
      status: status({
        health: {
          status: "connected",
          consecutiveFailures: 0,
          reconnects: 0,
          captureAvailable: false,
        },
      }),
    });
    expect(buttonCount(markup)).toBe(buttonCount(readyMarkup) + 1);
  });

  it("reports a reconnect in flight without offering a manual re-arm", () => {
    const readyMarkup = render({ status: status() });
    const markup = render({
      status: status({
        health: {
          status: "reconnecting",
          consecutiveFailures: 1,
          reconnects: 1,
          captureAvailable: true,
        },
      }),
    });
    expect(buttonCount(markup)).toBe(buttonCount(readyMarkup));
  });

  it("shows the backend identity in the Cua capabilities row", () => {
    const markup = render({
      status: status({
        availability: { kind: "available", backend: "cua" },
        capabilities: capabilities({
          input: false,
          focus: false,
          raise: false,
          ghostCursor: false,
        }),
      }),
    });
    expect(markup).toContain('id="setting-desktop-abilities"');
    expect(markup).toContain("Cua 0.28.2");
    expect(markup).not.toContain("macOS desktop");
  });

  describe("agent cursor colors", () => {
    it("keeps the cursor stock by default and hides the color editors", () => {
      const markup = render({ status: status() });
      expect(markup).toContain('id="setting-cursor-colors"');
      expect(markup).toContain('role="radiogroup"');
      expect(markup).toContain('role="radio"');
      // Stock is the zero-override default: no fill/rim editor renders and no
      // stored color is read out.
      expect(markup).not.toContain("data-swatch");
    });

    it("round-trips custom colors through the settings store", () => {
      const defaults = AppSettingsSchema.makeUnsafe({});
      // The default is stock with no overrides stored.
      expect(defaults.agentCursorColorMode).toBe("stock");
      expect(defaults.agentCursorFillColor).toBe("");
      expect(defaults.agentCursorRimColor).toBe("");
      expect(resolveAgentCursorColors(defaults)).toBeNull();

      const stored = applyLocalAppSettingsPatch(defaults, {
        agentCursorColorMode: "custom",
        agentCursorFillColor: "#AABBCC",
        agentCursorRimColor: "not-a-color",
      });
      expect(stored.agentCursorColorMode).toBe("custom");
      expect(stored.agentCursorFillColor).toBe("#aabbcc");
      // A value that is not a complete hex color never becomes a preference.
      expect(stored.agentCursorRimColor).toBe("");
      expect(resolveAgentCursorColors(stored)).toEqual({ fill: "#aabbcc" });

      // Stock means zero overrides even when colors are still remembered for
      // a later switch back to custom.
      const backToStock = applyLocalAppSettingsPatch(stored, {
        agentCursorColorMode: "stock",
      });
      expect(backToStock.agentCursorFillColor).toBe("#aabbcc");
      expect(resolveAgentCursorColors(backToStock)).toBeNull();
    });
  });
});

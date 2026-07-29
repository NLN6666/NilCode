import type { ServerSettings } from "@synara/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@synara/contracts";
import { setOutboundProxyResolver } from "@synara/shared/outboundHttp";
import { Deferred, Effect, Ref, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveOutboundProxy, startOutboundProxySync } from "./outboundProxyRuntime";
import { ServerSettingsService } from "./serverSettings";

vi.mock("@synara/shared/outboundHttp", () => ({ setOutboundProxyResolver: vi.fn() }));

const network = (proxy: Partial<(typeof DEFAULT_SERVER_SETTINGS)["network"]["proxy"]>) => ({
  proxy: { ...DEFAULT_SERVER_SETTINGS.network.proxy, ...proxy },
});

describe("resolveOutboundProxy", () => {
  it("defaults to reading the environment", () => {
    expect(DEFAULT_SERVER_SETTINGS.network.proxy.mode).toBe("env");
    const resolved = resolveOutboundProxy({
      network: DEFAULT_SERVER_SETTINGS.network,
      env: { HTTPS_PROXY: "http://127.0.0.1:7890" },
    });
    expect(resolved?.url.href).toBe("http://127.0.0.1:7890/");
  });

  it("returns no proxy when the environment has none", () => {
    expect(
      resolveOutboundProxy({ network: DEFAULT_SERVER_SETTINGS.network, env: {} }),
    ).toBeUndefined();
  });

  it("ignores the environment entirely when mode is off", () => {
    // The reason `off` exists: a shell-exported HTTPS_PROXY must be overridable.
    expect(
      resolveOutboundProxy({
        network: network({ mode: "off" }),
        env: { HTTPS_PROXY: "http://127.0.0.1:7890" },
      }),
    ).toBeUndefined();
  });

  it("uses the manual URL and ignores the environment", () => {
    const resolved = resolveOutboundProxy({
      network: network({ mode: "manual", url: "http://127.0.0.1:1080", noProxy: "a.com, .b.com" }),
      env: { HTTPS_PROXY: "http://127.0.0.1:7890" },
    });
    expect(resolved?.url.href).toBe("http://127.0.0.1:1080/");
    expect(resolved?.noProxy).toEqual(["a.com", ".b.com"]);
  });

  it("returns no proxy for a blank manual URL", () => {
    expect(
      resolveOutboundProxy({ network: network({ mode: "manual", url: "  " }), env: {} }),
    ).toBeUndefined();
  });

  it("returns no proxy for an invalid manual URL instead of throwing", () => {
    expect(
      resolveOutboundProxy({
        network: network({ mode: "manual", url: "socks5://127.0.0.1:1080" }),
        env: {},
      }),
    ).toBeUndefined();
  });

  it("accepts a schemeless manual URL", () => {
    const resolved = resolveOutboundProxy({
      network: network({ mode: "manual", url: "127.0.0.1:7890" }),
      env: {},
    });
    expect(resolved?.url.href).toBe("http://127.0.0.1:7890/");
  });
});

describe("startOutboundProxySync", () => {
  beforeEach(() => {
    vi.mocked(setOutboundProxyResolver).mockClear();
    // Reproduce the desktop app's environment: launched from the Start menu it
    // inherits no proxy variables, so persisted settings are the only source.
    for (const name of [
      "HTTPS_PROXY",
      "https_proxy",
      "HTTP_PROXY",
      "http_proxy",
      "ALL_PROXY",
      "all_proxy",
    ]) {
      vi.stubEnv(name, "");
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Minimal stand-in whose settings arrive only once `ready` resolves. */
  function makeSettingsService(input: {
    readonly settingsRef: Ref.Ref<ServerSettings>;
    readonly ready: Effect.Effect<void>;
  }) {
    const getSettings = Ref.get(input.settingsRef);
    return {
      start: Effect.void,
      ready: input.ready,
      getSettings,
      getSettingsView: getSettings,
      getSnapshot: Effect.map(getSettings, (settings) => ({
        revision: 1,
        migrationVersion: 1,
        settings,
      })),
      updateSettings: () => getSettings,
      updateSettingsView: () => getSettings,
      streamChanges: Stream.empty,
      streamViews: Stream.empty,
    } as unknown as typeof ServerSettingsService.Service;
  }

  it("waits for settings to load from disk before resolving the proxy", async () => {
    // Regression: the registration runs before `serverSettings.start`, so
    // reading settings eagerly pinned the defaults (mode "env") forever and a
    // manually configured proxy was silently never used.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const settingsRef = yield* Ref.make<ServerSettings>(DEFAULT_SERVER_SETTINGS);
          const readyDeferred = yield* Deferred.make<void>();
          const service = makeSettingsService({
            settingsRef,
            ready: Deferred.await(readyDeferred),
          });

          // Empty env: the desktop app inherits no HTTPS_PROXY when launched
          // from the Start menu, so settings are the only source of truth.
          yield* startOutboundProxySync({ env: {} }).pipe(
            Effect.provideService(ServerSettingsService, service),
          );

          const resolver = vi.mocked(setOutboundProxyResolver).mock.calls[0]?.[0];
          expect(resolver).toBeTypeOf("function");

          // Disk load completes after registration, exactly as at startup.
          yield* Ref.set(settingsRef, {
            ...DEFAULT_SERVER_SETTINGS,
            network: {
              proxy: { mode: "manual" as const, url: "http://127.0.0.1:7897", noProxy: "" },
            },
          });
          yield* Deferred.succeed(readyDeferred, undefined);
          yield* Effect.sleep("10 millis");

          expect(resolver?.()?.url.href).toBe("http://127.0.0.1:7897/");
        }),
      ),
    );
  });
});

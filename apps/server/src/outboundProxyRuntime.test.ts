import { DEFAULT_SERVER_SETTINGS } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveOutboundProxy } from "./outboundProxyRuntime";

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

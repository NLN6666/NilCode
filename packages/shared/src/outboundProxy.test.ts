import { describe, expect, it } from "vitest";

import {
  OutboundProxyConfigError,
  parseNoProxy,
  parseProxyUrl,
  resolveProxyFromEnv,
  shouldBypassProxy,
} from "./outboundProxy";

describe("parseProxyUrl", () => {
  it("accepts an http proxy URL", () => {
    expect(parseProxyUrl("http://127.0.0.1:7890").href).toBe("http://127.0.0.1:7890/");
  });

  it("assumes http when the scheme is omitted", () => {
    // Users copy `127.0.0.1:7890` straight out of Clash's UI. Without this,
    // `new URL()` would read `127.0.0.1:` as the scheme and accept nonsense.
    expect(parseProxyUrl("127.0.0.1:7890").href).toBe("http://127.0.0.1:7890/");
  });

  it("defaults to port 80 when none is given", () => {
    expect(parseProxyUrl("http://proxy.example").port).toBe("");
    expect(parseProxyUrl("http://proxy.example").href).toBe("http://proxy.example/");
  });

  it("rejects an empty value", () => {
    expect(() => parseProxyUrl("   ")).toThrow(OutboundProxyConfigError);
  });

  it("rejects a non-http scheme", () => {
    // We tunnel via CONNECT over plaintext to the proxy; https-to-proxy and
    // SOCKS5 are explicitly out of scope, so accepting them would silently fail.
    expect(() => parseProxyUrl("https://proxy.example:8080")).toThrow(OutboundProxyConfigError);
    expect(() => parseProxyUrl("socks5://127.0.0.1:1080")).toThrow(OutboundProxyConfigError);
  });

  it("rejects embedded credentials", () => {
    expect(() => parseProxyUrl("http://user:pass@127.0.0.1:7890")).toThrow(
      OutboundProxyConfigError,
    );
  });

  it("rejects a path, query, or fragment", () => {
    expect(() => parseProxyUrl("http://127.0.0.1:7890/proxy")).toThrow(OutboundProxyConfigError);
    expect(() => parseProxyUrl("http://127.0.0.1:7890/?a=1")).toThrow(OutboundProxyConfigError);
    expect(() => parseProxyUrl("http://127.0.0.1:7890/#x")).toThrow(OutboundProxyConfigError);
  });

  it("tolerates a bare trailing slash", () => {
    expect(parseProxyUrl("http://127.0.0.1:7890/").href).toBe("http://127.0.0.1:7890/");
  });
});

describe("parseNoProxy", () => {
  it("splits on commas and drops blanks", () => {
    expect(parseNoProxy("a.com, .b.com ,,  c.com ")).toEqual(["a.com", ".b.com", "c.com"]);
  });

  it("lowercases entries", () => {
    expect(parseNoProxy("EXAMPLE.com")).toEqual(["example.com"]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseNoProxy("")).toEqual([]);
    expect(parseNoProxy("  ")).toEqual([]);
  });
});

describe("shouldBypassProxy", () => {
  it("bypasses everything for '*'", () => {
    expect(shouldBypassProxy(new URL("https://api.anthropic.com"), ["*"])).toBe(true);
  });

  it("matches an exact host", () => {
    expect(shouldBypassProxy(new URL("https://example.com/x"), ["example.com"])).toBe(true);
  });

  it("matches subdomains of a bare entry", () => {
    expect(shouldBypassProxy(new URL("https://api.example.com"), ["example.com"])).toBe(true);
  });

  it("matches subdomains and the apex for a leading-dot entry", () => {
    expect(shouldBypassProxy(new URL("https://api.example.com"), [".example.com"])).toBe(true);
    expect(shouldBypassProxy(new URL("https://example.com"), [".example.com"])).toBe(true);
  });

  it("does not match a host that merely ends with the entry", () => {
    // `notexample.com` must not be treated as a subdomain of `example.com`.
    expect(shouldBypassProxy(new URL("https://notexample.com"), ["example.com"])).toBe(false);
  });

  it("is case insensitive", () => {
    expect(shouldBypassProxy(new URL("https://API.Example.COM"), ["example.com"])).toBe(true);
  });

  it("honors a port-qualified entry only on that port", () => {
    expect(shouldBypassProxy(new URL("http://example.com:8080/"), ["example.com:8080"])).toBe(true);
    expect(shouldBypassProxy(new URL("https://example.com/"), ["example.com:8080"])).toBe(false);
  });

  it("matches the implicit default port", () => {
    expect(shouldBypassProxy(new URL("https://example.com/"), ["example.com:443"])).toBe(true);
    expect(shouldBypassProxy(new URL("http://example.com/"), ["example.com:80"])).toBe(true);
  });

  it("returns false for an empty list", () => {
    expect(shouldBypassProxy(new URL("https://example.com"), [])).toBe(false);
  });
});

describe("resolveProxyFromEnv", () => {
  it("returns undefined when nothing is set", () => {
    expect(resolveProxyFromEnv({})).toBeUndefined();
  });

  it("reads HTTPS_PROXY", () => {
    expect(resolveProxyFromEnv({ HTTPS_PROXY: "http://127.0.0.1:7890" })?.url.href).toBe(
      "http://127.0.0.1:7890/",
    );
  });

  it("prefers the lowercase variant over the uppercase one", () => {
    // curl and friends treat lowercase as authoritative; matching that avoids
    // surprising users who set both.
    const resolved = resolveProxyFromEnv({
      https_proxy: "http://127.0.0.1:1111",
      HTTPS_PROXY: "http://127.0.0.1:2222",
    });
    expect(resolved?.url.href).toBe("http://127.0.0.1:1111/");
  });

  it("prefers https_proxy over all_proxy and http_proxy", () => {
    const resolved = resolveProxyFromEnv({
      http_proxy: "http://127.0.0.1:3333",
      all_proxy: "http://127.0.0.1:2222",
      https_proxy: "http://127.0.0.1:1111",
    });
    expect(resolved?.url.href).toBe("http://127.0.0.1:1111/");
  });

  it("falls back to all_proxy before http_proxy", () => {
    const resolved = resolveProxyFromEnv({
      http_proxy: "http://127.0.0.1:3333",
      all_proxy: "http://127.0.0.1:2222",
    });
    expect(resolved?.url.href).toBe("http://127.0.0.1:2222/");
  });

  it("carries NO_PROXY through", () => {
    const resolved = resolveProxyFromEnv({
      https_proxy: "http://127.0.0.1:7890",
      no_proxy: "example.com, .internal",
    });
    expect(resolved?.noProxy).toEqual(["example.com", ".internal"]);
  });

  it("ignores an unparseable value rather than throwing", () => {
    // A globally exported `ALL_PROXY=socks5://...` must not take the server
    // down at startup; it is simply not a proxy we can use.
    expect(resolveProxyFromEnv({ all_proxy: "socks5://127.0.0.1:1080" })).toBeUndefined();
  });

  it("skips an unusable higher-priority value and uses the next one", () => {
    const resolved = resolveProxyFromEnv({
      https_proxy: "socks5://127.0.0.1:1080",
      http_proxy: "http://127.0.0.1:7890",
    });
    expect(resolved?.url.href).toBe("http://127.0.0.1:7890/");
  });
});

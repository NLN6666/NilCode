import * as Http from "node:http";
import * as Net from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPinnedLookup, outboundHttp, setOutboundProxyResolver } from "./outboundHttp";

const PINNED = { address: "2606:4700:20::681a:86c", family: 6 } as const;

describe("createPinnedLookup", () => {
  it("answers an all:true lookup with an array", () => {
    // Regression: Node (24.x observed) calls a custom `lookup` with
    // `all: true`. Answering that with the `(address, family)` shape makes the
    // socket read `undefined` as its host and throw ERR_INVALID_IP_ADDRESS
    // before a byte leaves the process — which took every outbound request
    // down, provider usage polling and the cloud model catalog alike.
    const callback = vi.fn();

    createPinnedLookup(PINNED)("models.dev", { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [
      { address: PINNED.address, family: PINNED.family },
    ]);
  });

  it("answers a single lookup with the address and family positionally", () => {
    const callback = vi.fn();

    createPinnedLookup(PINNED)("models.dev", { all: false }, callback);

    expect(callback).toHaveBeenCalledWith(null, PINNED.address, PINNED.family);
  });

  it("treats an absent `all` as the single-address shape", () => {
    const callback = vi.fn();

    createPinnedLookup(PINNED)("models.dev", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, PINNED.address, PINNED.family);
  });

  it("ignores the requested hostname so the checked address is the one dialed", () => {
    // The whole point of pinning: the address the policy approved must be the
    // address connected to, closing the DNS-rebinding window.
    const callback = vi.fn();

    createPinnedLookup({ address: "104.26.8.108", family: 4 })(
      "attacker.example",
      { all: true },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(null, [{ address: "104.26.8.108", family: 4 }]);
  });
});

describe("outbound proxy tunnelling", () => {
  let proxy: Http.Server | undefined;
  let origin: Net.Server | undefined;
  // The CONNECT handler hands back a Duplex, not a Socket; all we need is destroy().
  let openSockets: Array<{ destroy: () => void }> = [];

  afterEach(async () => {
    setOutboundProxyResolver(undefined);
    // A tunnelled socket keeps `server.close()` pending forever, so tear the
    // connections down before waiting on the listeners.
    for (const socket of openSockets) socket.destroy();
    openSockets = [];
    for (const server of [proxy, origin]) {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    proxy = undefined;
    origin = undefined;
  });

  async function listen(server: Http.Server | Net.Server): Promise<number> {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    return address.port;
  }

  /**
   * A bare TCP destination that records whether bytes arrived, then drops the
   * connection. `normalizeOutboundOrigin` admits https origins only, so a real
   * end-to-end check would need a self-signed CA; asserting that the TLS
   * ClientHello reaches the destination proves the tunnel carries traffic
   * without dragging certificate plumbing into the suite.
   */
  async function startOrigin(): Promise<{
    readonly port: number;
    readonly reached: () => boolean;
  }> {
    let sawBytes = false;
    origin = Net.createServer((socket) => {
      openSockets.push(socket);
      socket.once("data", () => {
        sawBytes = true;
        socket.destroy();
      });
      socket.on("error", () => undefined);
    });
    return { port: await listen(origin), reached: () => sawBytes };
  }

  /** Minimal CONNECT proxy that pipes the tunnel to the requested authority. */
  async function startProxy(options: { readonly refuse?: boolean } = {}): Promise<{
    readonly port: number;
    readonly seen: string[];
  }> {
    const seen: string[] = [];
    proxy = Http.createServer((_request, response) => {
      response.writeHead(405);
      response.end();
    });
    proxy.on("connect", (request, clientSocket, head) => {
      seen.push(request.url ?? "");
      openSockets.push(clientSocket);
      if (options.refuse) {
        clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      const [host, port] = (request.url ?? "").split(":");
      const upstream: Net.Socket = Net.connect(Number(port), host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      openSockets.push(upstream);
      upstream.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => upstream.destroy());
    });
    return { port: await listen(proxy), seen };
  }

  const policy = (originPort: number) => ({
    service: `test-proxy-${originPort}`,
    allowedOrigins: [`https://127.0.0.1:${originPort}`],
    timeoutMs: 5_000,
    maxRequestBytes: 1024,
    maxResponseBytes: 1024,
    maxRedirects: 0,
    maxConcurrent: 2,
    maxQueued: 2,
    requirePublicAddress: false,
  });

  const useProxy = (port: number, noProxy: readonly string[] = []) => {
    setOutboundProxyResolver(() => ({ url: new URL(`http://127.0.0.1:${port}`), noProxy }));
  };

  it("opens a CONNECT tunnel to the destination authority and carries traffic", async () => {
    const { port: originPort, reached } = await startOrigin();
    const { port: proxyPort, seen } = await startProxy();
    useProxy(proxyPort);

    // Fails at the TLS layer against a bare TCP listener — that the failure is
    // "request" and not "proxy" is what shows the tunnel itself succeeded.
    await expect(
      outboundHttp.request({
        policy: policy(originPort),
        url: `https://127.0.0.1:${originPort}/usage`,
      }),
    ).rejects.toMatchObject({ code: "request" });

    expect(seen).toEqual([`127.0.0.1:${originPort}`]);
    expect(reached()).toBe(true);
  });

  it("fails closed when the proxy refuses the tunnel", async () => {
    const { port: originPort, reached } = await startOrigin();
    const { port: proxyPort } = await startProxy({ refuse: true });
    useProxy(proxyPort);

    await expect(
      outboundHttp.request({
        policy: policy(originPort),
        url: `https://127.0.0.1:${originPort}/usage`,
      }),
    ).rejects.toMatchObject({ code: "proxy" });
    expect(reached()).toBe(false);
  });

  it("fails closed when the proxy is unreachable, never falling back to direct", async () => {
    const { port: originPort, reached } = await startOrigin();
    // Port 1 never listens. A direct fallback would reach the origin, so
    // `reached()` staying false is the assertion that matters here.
    useProxy(1);

    await expect(
      outboundHttp.request({
        policy: policy(originPort),
        url: `https://127.0.0.1:${originPort}/usage`,
      }),
    ).rejects.toMatchObject({ code: "proxy" });
    expect(reached()).toBe(false);
  });

  it("bypasses the proxy for NO_PROXY hosts", async () => {
    const { port: originPort, reached } = await startOrigin();
    const { port: proxyPort, seen } = await startProxy();
    useProxy(proxyPort, ["127.0.0.1"]);

    await expect(
      outboundHttp.request({
        policy: policy(originPort),
        url: `https://127.0.0.1:${originPort}/usage`,
      }),
    ).rejects.toMatchObject({ code: "request" });

    expect(seen).toEqual([]);
    expect(reached()).toBe(true);
  });

  it("still enforces the destination origin allowlist through a proxy", async () => {
    const { port: originPort, reached } = await startOrigin();
    const { port: proxyPort, seen } = await startProxy();
    useProxy(proxyPort);

    // The allowlist is the remaining SSRF control once the destination's DNS is
    // resolved by the proxy, so it must reject before any tunnel is opened.
    await expect(
      outboundHttp.request({
        policy: { ...policy(originPort), allowedOrigins: ["https://api.anthropic.com"] },
        url: `https://127.0.0.1:${originPort}/usage`,
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(seen).toEqual([]);
    expect(reached()).toBe(false);
  });

  it("rejects a proxy on a non-loopback private address", async () => {
    const { port: originPort, reached } = await startOrigin();
    setOutboundProxyResolver(() => ({ url: new URL("http://192.168.7.7:7890"), noProxy: [] }));

    await expect(
      outboundHttp.request({
        policy: policy(originPort),
        url: `https://127.0.0.1:${originPort}/usage`,
      }),
    ).rejects.toMatchObject({ code: "proxy" });
    expect(reached()).toBe(false);
  });

  it("leaves direct requests untouched when no resolver is registered", async () => {
    const { port: originPort, reached } = await startOrigin();

    await expect(
      outboundHttp.request({
        policy: policy(originPort),
        url: `https://127.0.0.1:${originPort}/usage`,
      }),
    ).rejects.toMatchObject({ code: "request" });
    expect(reached()).toBe(true);
  });
});

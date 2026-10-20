import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type RequestListener,
  type Server as HttpServer,
} from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { OutboundPolicyError } from "./outboundHttpPolicy";
import * as Http from "node:http";
import * as Net from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPinnedLookup,
  decodeOutboundJson,
  outboundHttp,
  setOutboundProxyResolver,
} from "./outboundHttp";

const PINNED = { address: "2606:4700:20::681a:86c", family: 6 } as const;

describe("createPinnedLookup", () => {
  it("answers an all:true lookup with an array", async () => {
    // Regression: Node (24.x observed) calls a custom `lookup` with
    // `all: true`. Answering that with the `(address, family)` shape makes the
    // socket read `undefined` as its host and throw ERR_INVALID_IP_ADDRESS
    // before a byte leaves the process — which took every outbound request
    // down, provider usage polling and the cloud model catalog alike.
    const callback = vi.fn();

    createPinnedLookup(PINNED)("models.dev", { all: true }, callback);
    await Promise.resolve();

    expect(callback).toHaveBeenCalledWith(null, [
      { address: PINNED.address, family: PINNED.family },
    ]);
  });

  it("answers a single lookup with the address and family positionally", async () => {
    const callback = vi.fn();

    createPinnedLookup(PINNED)("models.dev", { all: false }, callback);
    await Promise.resolve();

    expect(callback).toHaveBeenCalledWith(null, PINNED.address, PINNED.family);
  });

  it("treats an absent `all` as the single-address shape", async () => {
    const callback = vi.fn();

    createPinnedLookup(PINNED)("models.dev", {}, callback);
    await Promise.resolve();

    expect(callback).toHaveBeenCalledWith(null, PINNED.address, PINNED.family);
  });

  it("ignores the requested hostname so the checked address is the one dialed", async () => {
    // The whole point of pinning: the address the policy approved must be the
    // address connected to, closing the DNS-rebinding window.
    const callback = vi.fn();

    createPinnedLookup({ address: "104.26.8.108", family: 4 })(
      "attacker.example",
      { all: true },
      callback,
    );
    await Promise.resolve();

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

  /** A port nothing listens on, so only a tunnel can reach the authority naming it. */
  async function deadPort(): Promise<number> {
    const probe = Net.createServer();
    const port = await listen(probe);
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  }

  /**
   * Minimal CONNECT proxy that pipes the tunnel to the requested authority, or
   * to `forwardTo` when the test needs the tunnel to be the only route there.
   */
  async function startProxy(
    options: { readonly refuse?: boolean; readonly forwardTo?: number } = {},
  ): Promise<{
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
      const upstream: Net.Socket = Net.connect(options.forwardTo ?? Number(port), host, () => {
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

  it("sends the request over the tunnel instead of dialing the destination directly", async () => {
    // Regression: opening the tunnel is not the same as using it. Node reads
    // `agent: false` as "make a fresh default agent", and an agent dials through
    // its own `createConnection`, so the tunnel was opened and then abandoned
    // while the request went direct — fail-closed proxying became a silent
    // direct connection. A destination nobody listens on, reachable only because
    // the proxy forwards elsewhere, is what tells the two paths apart.
    const { port: originPort, reached } = await startOrigin();
    const unreachablePort = await deadPort();
    const { port: proxyPort, seen } = await startProxy({ forwardTo: originPort });
    useProxy(proxyPort);

    await expect(
      outboundHttp.request({
        policy: policy(unreachablePort),
        url: `https://127.0.0.1:${unreachablePort}/usage`,
      }),
    ).rejects.toMatchObject({ code: "request" });

    expect(seen).toEqual([`127.0.0.1:${unreachablePort}`]);
    // Direct dialing would have been refused outright and never landed here.
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

/**
 * A port nothing is listening on, so every connection attempt is refused.
 *
 * HTTPS because the outbound policy rejects plain HTTP destinations outright,
 * which would fail the request before it ever reaches a socket.
 *
 * Taken by opening a server and closing it, which is more reliable than picking
 * a number and hoping: the OS will not hand the same port out again while this
 * process holds the reference.
 */
async function refusedPort(): Promise<number> {
  const server: NetServer = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const policyFor = (port: number) => ({
  service: "test",
  allowedOrigins: [`https://127.0.0.1:${port}`],
  timeoutMs: 5_000,
  maxRequestBytes: 0,
  maxResponseBytes: 64 * 1024,
  maxRedirects: 0,
  maxConcurrent: 2,
  maxQueued: 4,
  requirePublicAddress: false,
});

async function listenHttpServer(
  listener: RequestListener,
): Promise<{ readonly server: HttpServer; readonly origin: string }> {
  const server = createHttpServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected HTTP server address.");
  }
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const loopbackPolicyFor = (allowedOrigins: ReadonlyArray<string>, maxRedirects = 0) => ({
  service: "loopback-test",
  allowedOrigins,
  timeoutMs: 5_000,
  maxRequestBytes: 0,
  maxResponseBytes: 64 * 1024,
  maxRedirects,
  maxConcurrent: 2,
  maxQueued: 4,
  requirePublicAddress: true,
  allowLoopbackHttp: true,
});

/**
 * These cover the observable contract: a refused connection rejects, and the
 * client is still usable afterwards.
 *
 * The specific regression behind the `on`/`once` change is not reproducible
 * here. It needs a host whose addresses all refuse so Happy Eyeballs emits
 * `error` more than once, and the client pins DNS to a single address, so a
 * request from this suite can only ever emit once. It was reproduced by hand
 * against a real multi-address host: the request rejected correctly, execution
 * continued, and the process then died on the second emit.
 */
describe("outbound requests that cannot connect", () => {
  it("survives an immediate TLS connection error and serves the next request", async () => {
    // A synchronous pinned lookup can destroy the TLS socket during its
    // constructor, before Node attaches its error handlers. Keep the fatal
    // regression in a child process and exercise the real transport there.
    const directory = await mkdtemp(join(tmpdir(), "synara-outbound-tls-"));
    try {
      for (const name of ["outboundHttpPolicy", "outboundProxy", "outboundHttp"]) {
        const source = await readFile(new URL(`./${name}.ts`, import.meta.url), "utf8");
        const transformed = stripTypeScriptTypes(source, { mode: "transform" })
          .replaceAll('"./outboundHttpPolicy"', '"./outboundHttpPolicy.mjs"')
          .replaceAll('"./outboundProxy"', '"./outboundProxy.mjs"');
        await writeFile(join(directory, `${name}.mjs`), transformed);
      }
      const fixture = join(directory, "connection-failure.mjs");
      await writeFile(
        fixture,
        `import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { createServer } from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { outboundHttp, OutboundHttpError } from "./outboundHttp.mjs";

// Pin localhost to IPv4; the connection failure itself comes from the OS.
const lookup = dns.lookup;
dns.lookup = (hostname, options) => hostname === "localhost"
  ? Promise.resolve([{ address: "127.0.0.1", family: 4 }])
  : lookup(hostname, options);
syncBuiltinESMExports();
const policy = {
  service: "tls-lifecycle-test", allowedOrigins: ["https://localhost"],
  timeoutMs: 1000, maxRequestBytes: 0, maxResponseBytes: 1024,
  maxRedirects: 0, maxConcurrent: 1, maxQueued: 1, requirePublicAddress: false,
};
// TEST-NET-1 is not a local interface, so bind fails before TLS setup completes.
https.globalAgent.options.localAddress = "192.0.2.123";
await assert.rejects(outboundHttp.request({ policy, url: "https://localhost/" }),
  (error) => error instanceof OutboundHttpError && error.code === "request"
    && error.cause?.code === "EADDRNOTAVAIL");
delete https.globalAgent.options.localAddress;

const server = createServer((_request, response) => response.end("ok"));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const origin = "http://127.0.0.1:" + server.address().port;
  const response = await outboundHttp.request({
    policy: { ...policy, allowedOrigins: [origin], allowLoopbackHttp: true },
    url: origin,
  });
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder().decode(response.body), "ok");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log("survived");
`,
      );
      const { stdout } = await promisify(execFile)(process.execPath, [fixture], {
        timeout: 10_000,
      });
      expect(stdout.trim()).toBe("survived");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects rather than hanging", async () => {
    const port = await refusedPort();

    await expect(
      outboundHttp.request({
        policy: policyFor(port),
        url: `https://127.0.0.1:${port}/favicon.ico`,
        headers: { Accept: "image/*" },
      }),
    ).rejects.toThrow(/Outbound request failed/u);
  });
});

// A literal 198.18.x.x URL exercises the pinned-address check without DNS:
// literal hosts go through the same assertion as resolved answers.
const benchmarkPolicyFor = (origin: string) => ({
  service: "benchmark-test",
  allowedOrigins: [origin],
  timeoutMs: 2_000,
  maxRequestBytes: 0,
  maxResponseBytes: 1024,
  maxRedirects: 0,
  maxConcurrent: 1,
  maxQueued: 1,
  requirePublicAddress: true,
});

describe("benchmark-range opt-in", () => {
  it("rejects a 198.18.0.0/15 destination by default", async () => {
    await expect(
      outboundHttp.request({
        policy: benchmarkPolicyFor("https://198.18.0.1"),
        url: "https://198.18.0.1/",
      }),
    ).rejects.toMatchObject({ code: "private-address" });
  });

  it("lets an opted-in request past the address check", async () => {
    // Nothing answers on the benchmark range here, so the request still fails at
    // the socket — the assertion is that policy stopped rejecting it.
    const failure = await outboundHttp
      .request({
        policy: {
          ...benchmarkPolicyFor("https://198.18.0.1"),
          allowBenchmarkAddressRange: true,
        },
        url: "https://198.18.0.1/",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failure).not.toBeInstanceOf(OutboundPolicyError);
  });

  it.each(["https://10.0.0.1", "https://127.0.0.1", "https://169.254.169.254"])(
    "still rejects other blocked ranges with the opt-in: %s",
    async (origin) => {
      await expect(
        outboundHttp.request({
          policy: { ...benchmarkPolicyFor(origin), allowBenchmarkAddressRange: true },
          url: `${origin}/`,
        }),
      ).rejects.toMatchObject({ code: "private-address" });
    },
  );
});

describe("loopback HTTP transport", () => {
  it("performs an explicitly opted-in request against a local HTTP server", async () => {
    const { server, origin } = await listenHttpServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    });

    try {
      const response = await outboundHttp.request({
        policy: loopbackPolicyFor([origin]),
        url: `${origin}/status`,
      });

      expect(response.status).toBe(200);
      expect(decodeOutboundJson(response, { maxDepth: 4, maxNodes: 10 })).toEqual({ ok: true });
    } finally {
      await closeHttpServer(server);
    }
  });

  it("rejects redirects to another origin even when both origins are allowed", async () => {
    let redirectOrigin = "";
    let targetRequests = 0;
    const { server, origin } = await listenHttpServer((request, response) => {
      if (request.url === "/target") {
        targetRequests += 1;
        response.end("unexpected");
        return;
      }
      response.statusCode = 302;
      response.setHeader("Location", `${redirectOrigin}/target`);
      response.end();
    });
    redirectOrigin = origin.replace("127.0.0.1", "localhost");

    try {
      await expect(
        outboundHttp.request({
          policy: loopbackPolicyFor([origin, redirectOrigin], 1),
          url: `${origin}/redirect`,
        }),
      ).rejects.toMatchObject({ code: "invalid-redirect" });
      expect(targetRequests).toBe(0);
    } finally {
      await closeHttpServer(server);
    }
  });

  it("stops reading a stream the server keeps open once the caller has what it needs", async () => {
    const { server, origin } = await listenHttpServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
      // Never ends: a buffered read would wait for the timeout.
    });
    try {
      const seen: string[] = [];
      const response = await outboundHttp.request({
        policy: { ...loopbackPolicyFor([origin]), timeoutMs: 2_000 },
        url: origin,
        stopReadingAfter: (chunk, headers) => {
          seen.push(headers.get("content-type") ?? "");
          return new TextDecoder().decode(chunk).includes("first");
        },
      });
      expect(response.status).toBe(200);
      expect(new TextDecoder().decode(response.body)).toBe("data: first\n\n");
      expect(seen).toEqual(["text/event-stream"]);
    } finally {
      server.closeAllConnections();
      await closeHttpServer(server);
    }
  });

  it("fails only the request when the caller's reader throws", async () => {
    const { server, origin } = await listenHttpServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
    });
    try {
      await expect(
        outboundHttp.request({
          policy: { ...loopbackPolicyFor([origin]), timeoutMs: 2_000 },
          url: origin,
          stopReadingAfter: () => {
            throw new Error("collector bug");
          },
        }),
      ).rejects.toMatchObject({ code: "request", message: "Outbound response reader failed." });
    } finally {
      server.closeAllConnections();
      await closeHttpServer(server);
    }
  });
});

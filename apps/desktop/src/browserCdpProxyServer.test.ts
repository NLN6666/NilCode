import { afterEach, describe, expect, it, vi } from "vitest";
import puppeteer from "puppeteer-core";
import WebSocket from "ws";
import type {
  BrowserNewTabInput,
  BrowserTabInput,
  BrowserTabState,
  ThreadBrowserState,
  ThreadId,
} from "@synara/contracts";

import type {
  BrowserAutomationAcquireOptions,
  BrowserAutomationLeaseHandle,
} from "./browserAutomationLease";
import {
  BrowserCdpProxyServer,
  loadOrCreateBrowserCdpProxyToken,
  type BrowserCdpProxyBrowserHost,
  type BrowserCdpProxySnapshot,
} from "./browserCdpProxyServer";
import type { BrowserUseCdpEvent } from "./browserManager";

const THREAD_A = "thread-a" as ThreadId;
const THREAD_B = "thread-b" as ThreadId;
const TOKEN = "test-token-0123456789abcdef";

function tab(overrides: Partial<BrowserTabState> & { id: string }): BrowserTabState {
  return {
    url: "https://example.com/",
    title: "Example",
    status: "live",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastCommittedUrl: null,
    lastError: null,
    ...overrides,
  };
}

function threadState(threadId: ThreadId, tabs: BrowserTabState[]): ThreadBrowserState {
  return {
    threadId,
    version: 1,
    open: true,
    activeTabId: tabs[0]?.id ?? null,
    tabs,
    lastError: null,
  };
}

interface LoggedCommand {
  threadId: ThreadId;
  tabId: string;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

// Electron-free stand-in for DesktopBrowserManager's narrow host surface. It answers the
// handful of CDP commands puppeteer needs shaped responses for and logs everything else.
class FakeBrowserHost implements BrowserCdpProxyBrowserHost {
  snapshot: BrowserCdpProxySnapshot | null = null;
  readonly commands: LoggedCommand[] = [];
  readonly leaseCounts = new Map<string, number>();
  readonly forcedDetachCallbacks = new Map<
    string,
    Set<(reason: "devtools" | "runtime-destroyed") => void>
  >();
  private readonly targetListeners = new Set<() => void>();
  private readonly cdpListeners = new Map<string, Set<(event: BrowserUseCdpEvent) => void>>();
  private nextTabNumber = 1;
  readonly requestOpenPanel = vi.fn(async () => {});

  private keyOf(input: BrowserTabInput): string {
    return `${input.threadId}:${input.tabId}`;
  }

  setSnapshot(snapshot: BrowserCdpProxySnapshot | null): void {
    this.snapshot = snapshot;
    for (const listener of this.targetListeners) {
      listener();
    }
  }

  leaseCount(input: BrowserTabInput): number {
    return this.leaseCounts.get(this.keyOf(input)) ?? 0;
  }

  totalLeaseCount(): number {
    let total = 0;
    for (const count of this.leaseCounts.values()) {
      total += count;
    }
    return total;
  }

  emitCdpEvent(input: BrowserTabInput, event: BrowserUseCdpEvent): void {
    for (const listener of this.cdpListeners.get(this.keyOf(input)) ?? []) {
      listener(event);
    }
  }

  getSnapshot = (): BrowserCdpProxySnapshot | null => this.snapshot;

  subscribeTargets = (listener: () => void): (() => void) => {
    this.targetListeners.add(listener);
    return () => {
      this.targetListeners.delete(listener);
    };
  };

  acquireLease = async (
    input: BrowserTabInput,
    options: BrowserAutomationAcquireOptions,
  ): Promise<BrowserAutomationLeaseHandle> => {
    const key = this.keyOf(input);
    this.leaseCounts.set(key, (this.leaseCounts.get(key) ?? 0) + 1);
    if (options.onForcedDetach) {
      const callbacks = this.forcedDetachCallbacks.get(key) ?? new Set();
      callbacks.add(options.onForcedDetach);
      this.forcedDetachCallbacks.set(key, callbacks);
    }
    let released = false;
    return {
      threadId: input.threadId,
      tabId: input.tabId,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.leaseCounts.set(key, Math.max(0, (this.leaseCounts.get(key) ?? 1) - 1));
      },
    };
  };

  sendCdpCommand = async (
    input: BrowserTabInput & {
      method: string;
      params?: Record<string, unknown>;
      sessionId?: string;
    },
  ): Promise<unknown> => {
    if (!this.snapshot?.state.tabs.some((entry) => entry.id === input.tabId)) {
      throw new Error("The browser tab runtime is not available.");
    }
    this.commands.push({
      threadId: input.threadId,
      tabId: input.tabId,
      method: input.method,
      ...(input.params ? { params: input.params } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    switch (input.method) {
      case "Page.getFrameTree":
        return {
          frameTree: {
            frame: {
              id: `frame-${input.tabId}`,
              loaderId: "loader-1",
              url: "about:blank",
              domainAndRegistry: "",
              securityOrigin: "://",
              mimeType: "text/html",
              secureContextType: "InsecureScheme",
              crossOriginIsolatedContextType: "NotIsolated",
              gatedAPIFeatures: [],
            },
            childFrames: [],
          },
        };
      case "Page.navigate":
        return { frameId: `frame-${input.tabId}`, loaderId: "loader-2" };
      default:
        return {};
    }
  };

  subscribeToCdpEvents = (
    input: BrowserTabInput,
    listener: (event: BrowserUseCdpEvent) => void,
  ): (() => void) => {
    const key = this.keyOf(input);
    const listeners = this.cdpListeners.get(key) ?? new Set();
    listeners.add(listener);
    this.cdpListeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
    };
  };

  newTab = (input: BrowserNewTabInput): ThreadBrowserState => {
    if (!this.snapshot || this.snapshot.threadId !== input.threadId) {
      throw new Error("No open browser for that thread");
    }
    const created = tab({
      id: `tab-created-${this.nextTabNumber}`,
      url: input.url ?? "about:blank",
    });
    this.nextTabNumber += 1;
    const nextState: ThreadBrowserState = {
      ...this.snapshot.state,
      version: this.snapshot.state.version + 1,
      tabs: [...this.snapshot.state.tabs, created],
      activeTabId: input.activate === false ? this.snapshot.state.activeTabId : created.id,
    };
    this.setSnapshot({ threadId: input.threadId, state: nextState });
    return nextState;
  };

  closeTab = (input: BrowserTabInput): ThreadBrowserState => {
    if (!this.snapshot || this.snapshot.threadId !== input.threadId) {
      throw new Error("No open browser for that thread");
    }
    const nextTabs = this.snapshot.state.tabs.filter((entry) => entry.id !== input.tabId);
    const nextState: ThreadBrowserState = {
      ...this.snapshot.state,
      version: this.snapshot.state.version + 1,
      tabs: nextTabs,
      activeTabId: nextTabs[0]?.id ?? null,
    };
    this.setSnapshot({ threadId: input.threadId, state: nextState });
    return nextState;
  };

  selectTab = (input: BrowserTabInput): ThreadBrowserState => {
    if (!this.snapshot) {
      throw new Error("No open browser");
    }
    const nextState: ThreadBrowserState = {
      ...this.snapshot.state,
      version: this.snapshot.state.version + 1,
      activeTabId: input.tabId,
    };
    this.setSnapshot({ threadId: this.snapshot.threadId, state: nextState });
    return nextState;
  };

  getVersionInfo = () => ({
    chromeVersion: "132.0.6834.0",
    userAgent: "Mozilla/5.0 (Synara Test) Chrome/132.0.6834.0",
    v8Version: "13.2.152.1",
  });
}

interface RawEvent {
  method: string;
  params?: unknown;
  sessionId?: string;
}

// Minimal flatten-envelope CDP client for the specialized tests, so assertions stay
// deterministic and independent of puppeteer's internal command batching.
class RawCdpClient {
  readonly events: RawEvent[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private constructor(readonly socket: WebSocket) {}

  static connect(endpoint: string, token: string): Promise<RawCdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const client = new RawCdpClient(socket);
      socket.on("open", () => resolve(client));
      socket.on("error", reject);
      socket.on("close", (code, reason) => {
        client.closes.push({ code, reason: reason.toString() });
      });
      socket.on("message", (data) => {
        const parsed = JSON.parse(String(data)) as {
          id?: number;
          result?: unknown;
          error?: { code: number; message: string };
          method?: string;
          params?: unknown;
          sessionId?: string;
        };
        if (typeof parsed.id === "number") {
          const entry = client.pending.get(parsed.id);
          client.pending.delete(parsed.id);
          if (!entry) {
            return;
          }
          if (parsed.error) {
            entry.reject(new Error(`${parsed.error.code}: ${parsed.error.message}`));
          } else {
            entry.resolve(parsed.result);
          }
          return;
        }
        if (typeof parsed.method === "string") {
          client.events.push({
            method: parsed.method,
            params: parsed.params,
            ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
          });
        }
      });
    });
  }

  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(
        JSON.stringify({
          id,
          method,
          ...(params ? { params } : {}),
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }

  async waitForEvent(
    method: string,
    timeoutMs = 3_000,
    predicate: (event: RawEvent) => boolean = () => true,
  ): Promise<RawEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = this.events.find((event) => event.method === method && predicate(event));
      if (match) {
        return match;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${method}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async waitForClose(timeoutMs = 3_000): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (this.closes.length === 0) {
      if (Date.now() > deadline) {
        throw new Error("Timed out waiting for the socket to close");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.closes[0] as { code: number; reason: string };
  }

  close(): void {
    this.socket.close();
  }
}

interface Harness {
  host: FakeBrowserHost;
  server: BrowserCdpProxyServer;
}

const cleanups: Array<() => Promise<void> | void> = [];

async function startHarness(
  options: { maxQueuedOutputBytes?: number; snapshot?: BrowserCdpProxySnapshot | null } = {},
): Promise<Harness> {
  const host = new FakeBrowserHost();
  host.snapshot =
    options.snapshot !== undefined
      ? options.snapshot
      : { threadId: THREAD_A, state: threadState(THREAD_A, [tab({ id: "tab-1" })]) };
  const server = new BrowserCdpProxyServer({
    browserHost: host,
    token: TOKEN,
    port: 0,
    ...(options.maxQueuedOutputBytes !== undefined
      ? { maxQueuedOutputBytes: options.maxQueuedOutputBytes }
      : {}),
  });
  await server.start();
  cleanups.push(() => server.dispose());
  return { host, server };
}

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("BrowserCdpProxyServer integration (real puppeteer-core)", () => {
  it("puppeteer.connect can list targets, attach, and run Page.navigate", async () => {
    const { host, server } = await startHarness();

    const browser = await puppeteer.connect({
      browserWSEndpoint: server.endpoint,
      headers: { Authorization: `Bearer ${TOKEN}` },
      defaultViewport: null,
      protocolTimeout: 10_000,
    });
    cleanups.push(() => {
      browser.disconnect();
    });

    const target = await browser.waitForTarget(
      (candidate) => candidate.type() === "page" && candidate.url() === "https://example.com/",
      { timeout: 5_000 },
    );
    expect(target).toBeDefined();
    // The synthesized target ids never leak Synara thread/tab identifiers.
    const targetId = (target as unknown as { _targetId: string })._targetId;
    expect(targetId).toMatch(/^[0-9A-F]{32}$/);

    const session = await target.createCDPSession();
    const navigateResult = (await session.send("Page.navigate", {
      url: "https://example.com/next",
    })) as { frameId: string };
    expect(navigateResult.frameId).toBe("frame-tab-1");

    const navigateCommand = host.commands.find((command) => command.method === "Page.navigate");
    expect(navigateCommand).toMatchObject({
      threadId: THREAD_A,
      tabId: "tab-1",
      params: { url: "https://example.com/next" },
    });
    // Nested-session plumbing: puppeteer's own page-session bootstrap commands were
    // routed to the same tab rather than swallowed.
    expect(
      host.commands.some((command) => command.method === "Runtime.runIfWaitingForDebugger"),
    ).toBe(true);
    expect(host.leaseCount({ threadId: THREAD_A, tabId: "tab-1" })).toBeGreaterThan(0);
  }, 20_000);
});

describe("BrowserCdpProxyServer authentication", () => {
  it("rejects a missing bearer token during the upgrade", async () => {
    const { server } = await startHarness();

    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(server.endpoint);
      socket.on("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
        socket.terminate();
      });
      socket.on("open", () => reject(new Error("connection should have been rejected")));
      socket.on("error", () => {});
    });
    expect(status).toBe(401);
  });

  it("rejects a wrong bearer token during the upgrade", async () => {
    const { server } = await startHarness();

    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(server.endpoint, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      socket.on("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
        socket.terminate();
      });
      socket.on("open", () => reject(new Error("connection should have been rejected")));
      socket.on("error", () => {});
    });
    expect(status).toBe(401);
  });

  it("rejects wrong paths even with a valid token", async () => {
    const { server } = await startHarness();

    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(server.endpoint.replace("/synara/cdp", "/other"), {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      socket.on("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
        socket.terminate();
      });
      socket.on("open", () => reject(new Error("connection should have been rejected")));
      socket.on("error", () => {});
    });
    expect(status).toBe(404);
  });
});

describe("BrowserCdpProxyServer protocol behavior", () => {
  it("answers unknown browser-level methods with -32601 and refuses Browser.close", async () => {
    const { server } = await startHarness();
    const client = await RawCdpClient.connect(server.endpoint, TOKEN);
    cleanups.push(() => client.close());

    await expect(client.send("Browser.whatIsThis")).rejects.toThrow(/-32601/);
    await expect(client.send("Browser.close")).rejects.toThrow(/not allowed/);
    await expect(client.send("Target.createBrowserContext")).rejects.toThrow(
      /does not support creating browser contexts/,
    );
  });

  it("Target.createTarget wakes the panel via requestOpenPanel when nothing is open", async () => {
    const { host, server } = await startHarness({ snapshot: null });
    host.requestOpenPanel.mockImplementation(async () => {
      host.setSnapshot({
        threadId: THREAD_A,
        state: threadState(THREAD_A, [tab({ id: "tab-1" })]),
      });
    });
    const client = await RawCdpClient.connect(server.endpoint, TOKEN);
    cleanups.push(() => client.close());

    const result = (await client.send("Target.createTarget", {
      url: "https://example.com/new",
    })) as {
      targetId: string;
    };
    expect(host.requestOpenPanel).toHaveBeenCalledTimes(1);
    expect(result.targetId).toMatch(/^[0-9A-F]{32}$/);
  });

  it("commands on unknown sessions report Chrome's session-not-found error", async () => {
    const { server } = await startHarness();
    const client = await RawCdpClient.connect(server.endpoint, TOKEN);
    cleanups.push(() => client.close());

    await expect(client.send("Page.navigate", { url: "x" }, "F".repeat(32))).rejects.toThrow(
      /Session with given id not found/,
    );
  });
});

describe("BrowserCdpProxyServer failure modes", () => {
  it("switching threads destroys targets and detaches sessions", async () => {
    const { host, server } = await startHarness();
    const client = await RawCdpClient.connect(server.endpoint, TOKEN);
    cleanups.push(() => client.close());

    await client.send("Target.setDiscoverTargets", { discover: true });
    const created = await client.waitForEvent("Target.targetCreated");
    const targetId = (created.params as { targetInfo: { targetId: string } }).targetInfo.targetId;
    const attach = (await client.send("Target.attachToTarget", { targetId, flatten: true })) as {
      sessionId: string;
    };
    expect(host.leaseCount({ threadId: THREAD_A, tabId: "tab-1" })).toBe(1);

    host.setSnapshot({ threadId: THREAD_B, state: threadState(THREAD_B, [tab({ id: "tab-9" })]) });

    const detached = await client.waitForEvent("Target.detachedFromTarget");
    expect(detached.params).toMatchObject({ sessionId: attach.sessionId, targetId });
    await client.waitForEvent(
      "Target.targetDestroyed",
      3_000,
      (event) => (event.params as { targetId: string }).targetId === targetId,
    );
    expect(host.leaseCount({ threadId: THREAD_A, tabId: "tab-1" })).toBe(0);

    await expect(client.send("Page.navigate", { url: "x" }, attach.sessionId)).rejects.toThrow(
      /Session with given id not found/,
    );
  });

  it("signals CDP detachment and closes instead of silently dropping events at capacity", async () => {
    const { host, server } = await startHarness();
    const client = await RawCdpClient.connect(server.endpoint, TOKEN);
    cleanups.push(() => client.close());

    await client.send("Target.setDiscoverTargets", { discover: true });
    const created = await client.waitForEvent("Target.targetCreated");
    const targetId = (created.params as { targetInfo: { targetId: string } }).targetInfo.targetId;
    const attach = (await client.send("Target.attachToTarget", { targetId, flatten: true })) as {
      sessionId: string;
    };

    // One notification bigger than the whole output budget must trip the overflow path.
    host.emitCdpEvent(
      { threadId: THREAD_A, tabId: "tab-1" },
      { method: "Network.dataReceived", params: { blob: "x".repeat(2 * 1024 * 1024) } },
    );

    const detached = await client.waitForEvent("Target.detachedFromTarget");
    expect(detached.params).toMatchObject({ sessionId: attach.sessionId, targetId });
    const close = await client.waitForClose();
    expect(close.code).toBe(1013);
    expect(host.leaseCount({ threadId: THREAD_A, tabId: "tab-1" })).toBe(0);
    // The oversized notification itself was never delivered as a corrupted stream.
    expect(client.events.some((event) => event.method === "Network.dataReceived")).toBe(false);
  });

  it("reference counting: detaching one session does not break the other", async () => {
    const { host, server } = await startHarness();
    const client = await RawCdpClient.connect(server.endpoint, TOKEN);
    cleanups.push(() => client.close());

    await client.send("Target.setDiscoverTargets", { discover: true });
    const created = await client.waitForEvent("Target.targetCreated");
    const targetId = (created.params as { targetInfo: { targetId: string } }).targetInfo.targetId;

    const first = (await client.send("Target.attachToTarget", { targetId, flatten: true })) as {
      sessionId: string;
    };
    const second = (await client.send("Target.attachToTarget", { targetId, flatten: true })) as {
      sessionId: string;
    };
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(host.leaseCount({ threadId: THREAD_A, tabId: "tab-1" })).toBe(2);

    await client.send("Target.detachFromTarget", { sessionId: first.sessionId });
    expect(host.leaseCount({ threadId: THREAD_A, tabId: "tab-1" })).toBe(1);

    // The surviving session still routes commands.
    await client.send(
      "Page.navigate",
      { url: "https://example.com/still-alive" },
      second.sessionId,
    );
    expect(
      host.commands.some(
        (command) =>
          command.method === "Page.navigate" &&
          (command.params as { url: string }).url === "https://example.com/still-alive",
      ),
    ).toBe(true);

    await client.send("Target.detachFromTarget", { sessionId: second.sessionId });
    expect(host.leaseCount({ threadId: THREAD_A, tabId: "tab-1" })).toBe(0);
  });

  it("a runtime forced-detach (DevTools) sends Target.detachedFromTarget to the client", async () => {
    const { host, server } = await startHarness();
    const client = await RawCdpClient.connect(server.endpoint, TOKEN);
    cleanups.push(() => client.close());

    await client.send("Target.setDiscoverTargets", { discover: true });
    const created = await client.waitForEvent("Target.targetCreated");
    const targetId = (created.params as { targetInfo: { targetId: string } }).targetInfo.targetId;
    const attach = (await client.send("Target.attachToTarget", { targetId, flatten: true })) as {
      sessionId: string;
    };

    for (const callback of host.forcedDetachCallbacks.get(`${THREAD_A}:tab-1`) ?? []) {
      callback("devtools");
    }

    const detached = await client.waitForEvent("Target.detachedFromTarget");
    expect(detached.params).toMatchObject({ sessionId: attach.sessionId, targetId });
  });

  it("start fails loudly when the port is already taken", async () => {
    const { server } = await startHarness();
    const endpointPort = Number(new URL(server.endpoint.replace("ws://", "http://")).port);

    const conflicting = new BrowserCdpProxyServer({
      browserHost: new FakeBrowserHost(),
      token: TOKEN,
      port: endpointPort,
    });
    cleanups.push(() => conflicting.dispose());
    await expect(conflicting.start()).rejects.toThrow(/Could not bind the browser CDP proxy/);
  });
});

describe("loadOrCreateBrowserCdpProxyToken", () => {
  it("creates a stable token and reuses it across calls", async () => {
    const FS = await import("node:fs");
    const OS = await import("node:os");
    const Path = await import("node:path");
    const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), "synara-cdp-token-"));
    cleanups.push(() => {
      FS.rmSync(dir, { recursive: true, force: true });
    });

    const first = loadOrCreateBrowserCdpProxyToken(dir);
    const second = loadOrCreateBrowserCdpProxyToken(dir);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });
});

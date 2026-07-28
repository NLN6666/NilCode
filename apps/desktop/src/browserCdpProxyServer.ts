// FILE: browserCdpProxyServer.ts
// Purpose: Browser-level CDP endpoint over WebSocket for the in-app browser, so
//          chrome-devtools-mcp / puppeteer can connect to Synara like a real Chrome.
// Layer: Desktop browser automation bridge
// Depends on: ws, the pure CDP proxy modules, and a narrow host interface supplied by
//             DesktopBrowserManager (plus main-process wiring for panel/open requests)
//
// Security model: the endpoint binds 127.0.0.1 only, authenticates with a bearer token
// during the HTTP upgrade (unauthorized connections die before any protocol state
// exists), and never exposes discovery endpoints like /json/version. Synara's own
// renderer never enters the target registry, so it is unaddressable by protocol design.

import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Http from "node:http";
import * as Path from "node:path";

import { WebSocketServer, type WebSocket } from "ws";
import type {
  BrowserNewTabInput,
  BrowserTabInput,
  ThreadBrowserState,
  ThreadId,
} from "@synara/contracts";

import type {
  BrowserAutomationAcquireOptions,
  BrowserAutomationLeaseHandle,
} from "./browserAutomationLease";
import {
  buildCdpErrorResponse,
  buildCdpEvent,
  buildCdpResponse,
  handleBrowserCdpCommand,
  parseCdpClientMessage,
  serverError,
  sessionNotFoundError,
  type BrowserCdpVersionInput,
  type CdpClientMessage,
} from "./browserCdpProtocol";
import {
  BrowserCdpTargetRegistry,
  createCdpId,
  type CdpTargetEvent,
} from "./browserCdpTargetRegistry";
import { BrowserCdpSessionRouter, type CdpRoutedSession } from "./browserCdpSessionRouter";
import type { BrowserUseCdpEvent } from "./browserManager";

export const BROWSER_CDP_PROXY_PATH = "/synara/cdp";
export const BROWSER_CDP_PROXY_DEFAULT_PORT = 9333;
const BROWSER_CDP_PROXY_MAX_CLIENTS = 8;
const BROWSER_CDP_PROXY_MAX_IN_FLIGHT = 16;
const BROWSER_CDP_PROXY_MAX_QUEUED_OUTPUT_BYTES = 1024 * 1024;
const BROWSER_CDP_PROXY_PANEL_READY_TIMEOUT_MS = 2_000;
const BROWSER_CDP_PROXY_PANEL_READY_POLL_MS = 50;
const BROWSER_CDP_PROXY_TOKEN_FILE = "browser-cdp-proxy-token";
const BROWSER_CDP_PROXY_INITIAL_URL = "about:blank";

/**
 * Loads the persisted bearer token, creating it on first use. The token lives in the
 * user-data directory with owner-only permissions and is stable across restarts so a
 * pasted MCP configuration keeps working.
 */
export function loadOrCreateBrowserCdpProxyToken(userDataDir: string): string {
  const tokenPath = Path.join(userDataDir, BROWSER_CDP_PROXY_TOKEN_FILE);
  try {
    const existing = FS.readFileSync(tokenPath, "utf8").trim();
    if (/^[0-9a-f]{48,}$/.test(existing)) {
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const token = Crypto.randomBytes(32).toString("hex");
  FS.mkdirSync(userDataDir, { recursive: true });
  FS.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

export interface BrowserCdpProxySettings {
  enabled: boolean;
  port: number;
}

export const DEFAULT_BROWSER_CDP_PROXY_SETTINGS: BrowserCdpProxySettings = {
  // Disabled by default: enabling opens a local port, so it is an explicit user choice.
  enabled: false,
  port: BROWSER_CDP_PROXY_DEFAULT_PORT,
};

const BROWSER_CDP_PROXY_SETTINGS_FILE = "browser-cdp-proxy.json";

function normalizeBrowserCdpProxyPort(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535
    ? value
    : BROWSER_CDP_PROXY_DEFAULT_PORT;
}

export function readBrowserCdpProxySettings(userDataDir: string): BrowserCdpProxySettings {
  try {
    const raw = FS.readFileSync(Path.join(userDataDir, BROWSER_CDP_PROXY_SETTINGS_FILE), "utf8");
    const parsed = JSON.parse(raw) as { enabled?: unknown; port?: unknown };
    return {
      enabled: parsed.enabled === true,
      port: normalizeBrowserCdpProxyPort(parsed.port),
    };
  } catch {
    return { ...DEFAULT_BROWSER_CDP_PROXY_SETTINGS };
  }
}

export function writeBrowserCdpProxySettings(
  userDataDir: string,
  settings: BrowserCdpProxySettings,
): BrowserCdpProxySettings {
  const normalized: BrowserCdpProxySettings = {
    enabled: settings.enabled === true,
    port: normalizeBrowserCdpProxyPort(settings.port),
  };
  FS.mkdirSync(userDataDir, { recursive: true });
  FS.writeFileSync(
    Path.join(userDataDir, BROWSER_CDP_PROXY_SETTINGS_FILE),
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return normalized;
}

export interface BrowserCdpProxySnapshot {
  threadId: ThreadId;
  state: ThreadBrowserState;
}

/**
 * Narrow host surface over DesktopBrowserManager (same pattern as the element picker),
 * so the proxy carries no Electron dependency and integration tests can drive it with a
 * fake host.
 */
export interface BrowserCdpProxyBrowserHost {
  getSnapshot: () => BrowserCdpProxySnapshot | null;
  subscribeTargets: (listener: () => void) => () => void;
  acquireLease: (
    input: BrowserTabInput,
    options: BrowserAutomationAcquireOptions,
  ) => Promise<BrowserAutomationLeaseHandle>;
  sendCdpCommand: (
    input: BrowserTabInput & {
      method: string;
      params?: Record<string, unknown>;
      sessionId?: string;
    },
  ) => Promise<unknown>;
  subscribeToCdpEvents: (
    input: BrowserTabInput,
    listener: (event: BrowserUseCdpEvent) => void,
  ) => () => void;
  newTab: (input: BrowserNewTabInput) => ThreadBrowserState;
  closeTab: (input: BrowserTabInput) => ThreadBrowserState;
  selectTab: (input: BrowserTabInput) => ThreadBrowserState;
  getVersionInfo: () => BrowserCdpVersionInput;
  requestOpenPanel?: () => void | Promise<void>;
}

export interface BrowserCdpProxyServerOptions {
  browserHost: BrowserCdpProxyBrowserHost;
  token: string;
  port?: number;
  maxClients?: number;
  maxInFlightRequests?: number;
  maxQueuedOutputBytes?: number;
}

interface ProxySessionRecord {
  session: CdpRoutedSession;
  leaseHandle: BrowserAutomationLeaseHandle | null;
  unsubscribeEvents: () => void;
  closed: boolean;
}

interface ProxyConnection {
  socket: WebSocket;
  router: BrowserCdpSessionRouter;
  sessionRecords: Map<string, ProxySessionRecord>;
  discoverEnabled: boolean;
  autoAttachEnabled: boolean;
  inFlightRequests: number;
  overflowed: boolean;
}

type ProxyWriteResult = "written" | "overflow" | "closed";

function timingSafeTokenEquals(expected: string, provided: string): boolean {
  const left = Crypto.createHash("sha256").update(expected, "utf8").digest();
  const right = Crypto.createHash("sha256").update(provided, "utf8").digest();
  return Crypto.timingSafeEqual(left, right);
}

function readBearerToken(request: Http.IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

export class BrowserCdpProxyServer {
  private readonly browserHost: BrowserCdpProxyBrowserHost;
  private readonly token: string;
  // Mutable only for port 0 (tests): resolved to the actual bound port after listen.
  private port: number;
  private readonly maxClients: number;
  private readonly maxInFlightRequests: number;
  private readonly maxQueuedOutputBytes: number;
  private readonly registry = new BrowserCdpTargetRegistry();
  private readonly connections = new Set<ProxyConnection>();
  private readonly browserTargetId = createCdpId();
  private readonly httpServer: Http.Server;
  private readonly wsServer: WebSocketServer;
  private unsubscribeTargets: (() => void) | null = null;
  private started = false;

  constructor(options: BrowserCdpProxyServerOptions) {
    this.browserHost = options.browserHost;
    this.token = options.token;
    this.port = options.port ?? BROWSER_CDP_PROXY_DEFAULT_PORT;
    this.maxClients = options.maxClients ?? BROWSER_CDP_PROXY_MAX_CLIENTS;
    this.maxInFlightRequests = options.maxInFlightRequests ?? BROWSER_CDP_PROXY_MAX_IN_FLIGHT;
    this.maxQueuedOutputBytes =
      options.maxQueuedOutputBytes ?? BROWSER_CDP_PROXY_MAX_QUEUED_OUTPUT_BYTES;

    // Deliberately no HTTP surface: /json/version and friends stay unimplemented so the
    // only reachable path is the authenticated WebSocket upgrade.
    this.httpServer = Http.createServer((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    this.wsServer = new WebSocketServer({ noServer: true });
    this.httpServer.on("upgrade", (request, socket, head) => {
      this.handleUpgrade(request, socket as import("node:net").Socket, head);
    });
  }

  /** The ws:// endpoint clients should connect to. */
  get endpoint(): string {
    return `ws://127.0.0.1:${this.port}${BROWSER_CDP_PROXY_PATH}`;
  }

  /**
   * Binds the endpoint. A port conflict (or any listen failure) rejects loudly so the
   * caller can surface it in the UI — the proxy must never silently disable itself.
   */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        reject(
          new Error(
            `Could not bind the browser CDP proxy to 127.0.0.1:${this.port}: ${error.message}`,
          ),
        );
      };
      this.httpServer.once("error", onError);
      this.httpServer.listen({ host: "127.0.0.1", port: this.port }, () => {
        this.httpServer.off("error", onError);
        const address = this.httpServer.address();
        if (address && typeof address === "object") {
          this.port = address.port;
        }
        resolve();
      });
    });
    this.unsubscribeTargets = this.browserHost.subscribeTargets(() => {
      this.refreshTargets();
    });
    this.refreshTargets();
    this.started = true;
  }

  async dispose(): Promise<void> {
    this.unsubscribeTargets?.();
    this.unsubscribeTargets = null;
    // Snapshot: terminate() fires the close handler, which deletes from this.connections.
    for (const connection of [...this.connections]) {
      this.teardownConnection(connection);
      connection.socket.terminate();
    }
    this.connections.clear();
    this.wsServer.close();
    if (this.started || this.httpServer.listening) {
      await new Promise<void>((resolve) => {
        this.httpServer.close(() => resolve());
      });
    }
    this.started = false;
  }

  private handleUpgrade(
    request: Http.IncomingMessage,
    socket: import("node:net").Socket,
    head: Buffer,
  ): void {
    // Auth first: unauthorized requests must die before any protocol state machine exists.
    const providedToken = readBearerToken(request);
    if (!providedToken || !timingSafeTokenEquals(this.token, providedToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const requestPath = (request.url ?? "").split("?")[0];
    if (requestPath !== BROWSER_CDP_PROXY_PATH) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (this.connections.size >= this.maxClients) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wsServer.handleUpgrade(request, socket, head, (webSocket) => {
      this.handleConnection(webSocket);
    });
  }

  private handleConnection(socket: WebSocket): void {
    const connection: ProxyConnection = {
      socket,
      router: new BrowserCdpSessionRouter(),
      sessionRecords: new Map(),
      discoverEnabled: false,
      autoAttachEnabled: false,
      inFlightRequests: 0,
      overflowed: false,
    };
    this.connections.add(connection);
    socket.on("message", (data) => {
      this.handleClientFrame(connection, data);
    });
    socket.on("close", () => {
      this.connections.delete(connection);
      this.teardownConnection(connection);
    });
    socket.on("error", () => {
      socket.terminate();
    });
  }

  private teardownConnection(connection: ProxyConnection): void {
    // Snapshot: closeSessionRecord deletes from the map being iterated.
    for (const record of [...connection.sessionRecords.values()]) {
      this.closeSessionRecord(connection, record, { releaseLease: true });
    }
    connection.sessionRecords.clear();
    connection.router.detachAll();
  }

  private handleClientFrame(connection: ProxyConnection, data: unknown): void {
    if (connection.overflowed) {
      return;
    }
    const raw =
      typeof data === "string"
        ? data
        : Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Array.isArray(data)
            ? Buffer.concat(data as Buffer[]).toString("utf8")
            : Buffer.from(data as ArrayBuffer).toString("utf8");
    const message = parseCdpClientMessage(raw);
    if (!message) {
      // A malformed frame has no command id to settle; failing the connection loudly
      // beats leaving the client waiting on a reply that can never come.
      connection.socket.close(1007, "Malformed CDP command");
      return;
    }
    if (connection.inFlightRequests >= this.maxInFlightRequests) {
      this.writeToConnection(
        connection,
        buildCdpErrorResponse(
          message.id,
          serverError("Too many in-flight CDP commands"),
          message.sessionId,
        ),
        true,
      );
      return;
    }
    connection.inFlightRequests += 1;
    void this.dispatchCommand(connection, message)
      .catch((error: unknown) => {
        this.writeToConnection(
          connection,
          buildCdpErrorResponse(
            message.id,
            serverError(error instanceof Error ? error.message : "CDP command failed"),
            message.sessionId,
          ),
          true,
        );
      })
      .finally(() => {
        connection.inFlightRequests -= 1;
      });
  }

  private async dispatchCommand(
    connection: ProxyConnection,
    message: CdpClientMessage,
  ): Promise<void> {
    // Core routing rule (plan 013 §5.3): no sessionId → synthesized browser level,
    // never forwarded to Electron; with sessionId → routed to the tab's debugger.
    if (!message.sessionId) {
      const outcome = await handleBrowserCdpCommand(message, {
        getVersion: () => this.browserHost.getVersionInfo(),
        listTargets: () => this.registry.listTargets(),
        getTargetInfo: (targetId) => this.registry.getTargetInfo(targetId),
        getBrowserTargetInfo: () => ({
          targetId: this.browserTargetId,
          type: "browser",
          title: "Synara in-app browser",
          url: "",
          attached: true,
          canAccessOpener: false,
          browserContextId: this.registry.browserContextId,
        }),
        announceDiscoveredTargets: () => {
          connection.discoverEnabled = true;
          for (const targetInfo of this.registry.listTargets()) {
            this.writeEvent(connection, "Target.targetCreated", { targetInfo });
          }
        },
        // Puppeteer's browser-level filter excludes "page" (it expects Chrome tab
        // targets, which Electron does not have), so the filter is deliberately
        // ignored: page targets are what this proxy auto-attaches.
        setAutoAttach: async (autoAttach) => {
          connection.autoAttachEnabled = autoAttach;
          if (!autoAttach) {
            return;
          }
          for (const targetInfo of this.registry.listTargets()) {
            if (connection.router.sessionsForTarget(targetInfo.targetId).length > 0) {
              continue;
            }
            try {
              await this.attachTarget(connection, targetInfo.targetId);
            } catch {
              // The tab may have vanished between listing and attaching; the next
              // target refresh reports its destruction.
            }
          }
        },
        attachToTarget: (targetId) => this.attachTarget(connection, targetId),
        detachFromTarget: async (sessionId) => this.detachSession(connection, sessionId),
        createTarget: (url) => this.createTarget(url),
        closeTarget: async (targetId) => {
          const target = this.registry.resolveTarget(targetId);
          if (!target) {
            return false;
          }
          this.browserHost.closeTab({ threadId: target.threadId, tabId: target.tabId });
          this.refreshTargets();
          return true;
        },
        activateTarget: async (targetId) => {
          const target = this.registry.resolveTarget(targetId);
          if (!target) {
            return;
          }
          this.browserHost.selectTab({ threadId: target.threadId, tabId: target.tabId });
        },
      });
      if (outcome.kind === "result") {
        this.writeToConnection(connection, buildCdpResponse(message.id, outcome.result), true);
      } else {
        this.writeToConnection(connection, buildCdpErrorResponse(message.id, outcome.error), true);
      }
      return;
    }

    const route = connection.router.resolve(message.sessionId);
    if (!route) {
      this.writeToConnection(
        connection,
        buildCdpErrorResponse(message.id, sessionNotFoundError(), message.sessionId),
        true,
      );
      return;
    }
    try {
      const result = await this.browserHost.sendCdpCommand({
        threadId: route.session.threadId,
        tabId: route.session.tabId,
        method: message.method,
        params: message.params,
        ...(route.kind === "child" ? { sessionId: route.upstreamSessionId } : {}),
      });
      this.writeToConnection(
        connection,
        buildCdpResponse(message.id, result, message.sessionId),
        true,
      );
    } catch (error) {
      const record = connection.sessionRecords.get(route.session.sessionId);
      if (record && !this.isRuntimeAvailable(route.session)) {
        // The runtime died under the session: report the Chrome-shaped session error and
        // follow up with the detach event the client needs to converge (plan 013 §7.2).
        this.writeToConnection(
          connection,
          buildCdpErrorResponse(message.id, sessionNotFoundError(), message.sessionId),
          true,
        );
        this.closeSessionRecord(connection, record, { releaseLease: true, notifyClient: true });
        return;
      }
      this.writeToConnection(
        connection,
        buildCdpErrorResponse(
          message.id,
          serverError(error instanceof Error ? error.message : "CDP command failed"),
          message.sessionId,
        ),
        true,
      );
    }
  }

  private isRuntimeAvailable(session: CdpRoutedSession): boolean {
    const snapshot = this.browserHost.getSnapshot();
    return (
      snapshot !== null &&
      snapshot.threadId === session.threadId &&
      snapshot.state.tabs.some((tab) => tab.id === session.tabId)
    );
  }

  private async attachTarget(connection: ProxyConnection, targetId: string): Promise<string> {
    const target = this.registry.resolveTarget(targetId);
    if (!target) {
      throw new Error("No target with given id found");
    }
    const tabInput: BrowserTabInput = { threadId: target.threadId, tabId: target.tabId };
    const session = connection.router.attach(targetId, target.threadId, target.tabId);
    const record: ProxySessionRecord = {
      session,
      leaseHandle: null,
      unsubscribeEvents: () => {},
      closed: false,
    };
    connection.sessionRecords.set(session.sessionId, record);
    try {
      record.leaseHandle = await this.browserHost.acquireLease(tabInput, {
        markAgentControl: true,
        onForcedDetach: () => {
          record.leaseHandle = null;
          if (!record.closed) {
            this.closeSessionRecord(connection, record, {
              releaseLease: false,
              notifyClient: true,
            });
          }
        },
      });
      record.unsubscribeEvents = this.browserHost.subscribeToCdpEvents(tabInput, (event) => {
        this.forwardUpstreamEvent(connection, record, event);
      });
    } catch (error) {
      connection.sessionRecords.delete(session.sessionId);
      connection.router.detach(session.sessionId);
      record.closed = true;
      record.leaseHandle?.release();
      throw error instanceof Error ? error : new Error("Could not attach to the target");
    }

    const attachInfo = this.registry.getTargetInfo(targetId) ?? {
      targetId,
      type: "page" as const,
      title: "",
      url: "",
      attached: true,
      canAccessOpener: false as const,
      browserContextId: this.registry.browserContextId,
    };
    this.writeEvent(connection, "Target.attachedToTarget", {
      sessionId: session.sessionId,
      targetInfo: { ...attachInfo, attached: true },
      waitingForDebugger: false,
    });
    this.syncTargetAttachedFlag(targetId);
    return session.sessionId;
  }

  private async detachSession(connection: ProxyConnection, sessionId: string): Promise<boolean> {
    const record = connection.sessionRecords.get(sessionId);
    if (!record) {
      return false;
    }
    this.closeSessionRecord(connection, record, { releaseLease: true, notifyClient: true });
    return true;
  }

  private closeSessionRecord(
    connection: ProxyConnection,
    record: ProxySessionRecord,
    options: { releaseLease: boolean; notifyClient?: boolean },
  ): void {
    if (record.closed) {
      return;
    }
    record.closed = true;
    connection.sessionRecords.delete(record.session.sessionId);
    connection.router.detach(record.session.sessionId);
    try {
      record.unsubscribeEvents();
    } catch {
      // The runtime may already be gone; its listeners died with it.
    }
    if (options.releaseLease) {
      record.leaseHandle?.release();
    }
    record.leaseHandle = null;
    if (options.notifyClient) {
      this.writeEvent(connection, "Target.detachedFromTarget", {
        sessionId: record.session.sessionId,
        targetId: record.session.targetId,
      });
    }
    this.syncTargetAttachedFlag(record.session.targetId);
  }

  private syncTargetAttachedFlag(targetId: string): void {
    let attached = false;
    for (const connection of this.connections) {
      if (connection.router.sessionsForTarget(targetId).length > 0) {
        attached = true;
        break;
      }
    }
    const changed = this.registry.setAttached(targetId, attached);
    if (changed) {
      this.broadcastTargetEvent(changed);
    }
  }

  private async createTarget(url: string): Promise<string> {
    const snapshot = await this.waitForOpenSnapshot();
    if (!snapshot) {
      throw new Error("No Synara browser pane is available");
    }
    const nextState = this.browserHost.newTab({
      threadId: snapshot.threadId,
      url: url || BROWSER_CDP_PROXY_INITIAL_URL,
      activate: true,
    });
    const tabId = nextState.activeTabId ?? nextState.tabs[nextState.tabs.length - 1]?.id;
    if (!tabId) {
      throw new Error("Could not create a browser tab");
    }
    this.refreshTargets();
    const targetId = this.registry.findTargetIdForTab(snapshot.threadId, tabId);
    if (!targetId) {
      throw new Error("Could not expose the created browser tab");
    }
    return targetId;
  }

  // Same wake pattern as the Codex pipe server: ask the renderer to open the panel,
  // then poll for an open browser state until the ready timeout elapses.
  private async waitForOpenSnapshot(): Promise<BrowserCdpProxySnapshot | null> {
    const existing = this.getOpenSnapshot();
    if (existing) {
      return existing;
    }
    await this.browserHost.requestOpenPanel?.();
    const deadline = Date.now() + BROWSER_CDP_PROXY_PANEL_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const snapshot = this.getOpenSnapshot();
      if (snapshot) {
        return snapshot;
      }
      await new Promise((resolve) => setTimeout(resolve, BROWSER_CDP_PROXY_PANEL_READY_POLL_MS));
    }
    return null;
  }

  private getOpenSnapshot(): BrowserCdpProxySnapshot | null {
    const snapshot = this.browserHost.getSnapshot();
    return snapshot && snapshot.state.open ? snapshot : null;
  }

  private refreshTargets(): void {
    const events = this.registry.applySnapshot(this.getOpenSnapshot());
    for (const event of events) {
      if (event.method === "Target.targetDestroyed") {
        // Sessions die with their target: emit detachedFromTarget before targetDestroyed
        // so clients unwind in the order Chrome uses.
        for (const connection of this.connections) {
          for (const session of connection.router.sessionsForTarget(event.params.targetId)) {
            const record = connection.sessionRecords.get(session.sessionId);
            if (record) {
              this.closeSessionRecord(connection, record, {
                releaseLease: true,
                notifyClient: true,
              });
            }
          }
        }
      }
      this.broadcastTargetEvent(event);
      if (event.method === "Target.targetCreated") {
        for (const connection of this.connections) {
          if (!connection.autoAttachEnabled) {
            continue;
          }
          void this.attachTarget(connection, event.params.targetInfo.targetId).catch(() => {
            // The tab may have vanished between diff and attach; the next refresh
            // announces its destruction, so there is nothing to repair here.
          });
        }
      }
    }
  }

  private broadcastTargetEvent(event: CdpTargetEvent): void {
    for (const connection of this.connections) {
      if (!connection.discoverEnabled) {
        continue;
      }
      this.writeEvent(connection, event.method, event.params);
    }
  }

  private forwardUpstreamEvent(
    connection: ProxyConnection,
    record: ProxySessionRecord,
    event: BrowserUseCdpEvent,
  ): void {
    if (connection.overflowed || record.closed) {
      return;
    }
    const routed = connection.router.routeUpstreamEvent(record.session, event);
    const result = this.writeToConnection(
      connection,
      buildCdpEvent(routed.method, routed.params, routed.sessionId),
    );
    if (result === "overflow") {
      this.signalOverflowAndClose(connection);
    }
  }

  private writeEvent(connection: ProxyConnection, method: string, params: unknown): void {
    if (connection.overflowed) {
      return;
    }
    const result = this.writeToConnection(connection, buildCdpEvent(method, params));
    if (result === "overflow") {
      this.signalOverflowAndClose(connection);
    }
  }

  /**
   * Output overflow handling, mirroring the browser-use pipe: dropping CDP events would
   * silently corrupt the client's state machine, so the proxy signals detachment for
   * every session and drops the connection instead (plan 013 §7.3).
   */
  private signalOverflowAndClose(connection: ProxyConnection): void {
    if (connection.overflowed) {
      return;
    }
    connection.overflowed = true;
    // Snapshot: the loop deletes each record from the map it iterates.
    for (const record of [...connection.sessionRecords.values()]) {
      record.closed = true;
      connection.sessionRecords.delete(record.session.sessionId);
      connection.router.detach(record.session.sessionId);
      try {
        record.unsubscribeEvents();
      } catch {
        // Already torn down.
      }
      record.leaseHandle?.release();
      record.leaseHandle = null;
      this.writeToConnection(
        connection,
        buildCdpEvent("Target.detachedFromTarget", {
          sessionId: record.session.sessionId,
          targetId: record.session.targetId,
        }),
        true,
      );
      this.syncTargetAttachedFlag(record.session.targetId);
    }
    connection.socket.close(1013, "CDP proxy output capacity exceeded");
  }

  private writeToConnection(
    connection: ProxyConnection,
    data: string,
    allowBoundedOverflow = false,
  ): ProxyWriteResult {
    const { socket } = connection;
    if (socket.readyState !== socket.OPEN) {
      return "closed";
    }
    if (
      !allowBoundedOverflow &&
      socket.bufferedAmount + Buffer.byteLength(data, "utf8") > this.maxQueuedOutputBytes
    ) {
      // Command responses always go through (their in-flight cap bounds them); only
      // unsolicited notifications are subject to the strict output budget.
      return "overflow";
    }
    socket.send(data);
    return "written";
  }
}

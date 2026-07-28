// FILE: browserCdpProtocol.ts
// Purpose: Pure CDP wire codec plus synthesized browser-level (Browser.*/Target.*) command
//          handling for the in-app browser CDP proxy, in flatten-session envelope form.
// Layer: Desktop browser CDP proxy (pure logic, no Electron)
// Depends on: browserCdpTargetRegistry types only

import type { CdpTargetInfo } from "./browserCdpTargetRegistry";

// Chrome-shaped protocol error codes (crdtp::DispatchResponse).
export const CDP_METHOD_NOT_FOUND_CODE = -32601;
export const CDP_INVALID_PARAMS_CODE = -32602;
export const CDP_SERVER_ERROR_CODE = -32000;
export const CDP_SESSION_NOT_FOUND_CODE = -32001;

export interface CdpErrorShape {
  code: number;
  message: string;
}

export interface CdpClientMessage {
  id: number;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

/**
 * Parses one client frame of the flatten-session CDP envelope. Returns null for
 * anything that is not a well-formed command, so the caller can reject the frame
 * loudly instead of guessing.
 */
export function parseCdpClientMessage(raw: string): CdpClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "number" || !Number.isInteger(record.id)) {
    return null;
  }
  if (typeof record.method !== "string" || record.method.length === 0) {
    return null;
  }
  if (record.sessionId !== undefined && typeof record.sessionId !== "string") {
    return null;
  }
  const params =
    typeof record.params === "object" && record.params !== null && !Array.isArray(record.params)
      ? (record.params as Record<string, unknown>)
      : {};
  const message: CdpClientMessage = { id: record.id, method: record.method, params };
  if (typeof record.sessionId === "string" && record.sessionId.length > 0) {
    message.sessionId = record.sessionId;
  }
  return message;
}

export function buildCdpResponse(id: number, result: unknown, sessionId?: string): string {
  return JSON.stringify({ id, result: result ?? {}, ...(sessionId ? { sessionId } : {}) });
}

export function buildCdpErrorResponse(
  id: number,
  error: CdpErrorShape,
  sessionId?: string,
): string {
  return JSON.stringify({ id, error, ...(sessionId ? { sessionId } : {}) });
}

export function buildCdpEvent(method: string, params: unknown, sessionId?: string): string {
  return JSON.stringify({
    method,
    params: params ?? {},
    ...(sessionId ? { sessionId } : {}),
  });
}

export function methodNotFoundError(method: string): CdpErrorShape {
  // Same shape and wording Chrome uses for unknown methods.
  return { code: CDP_METHOD_NOT_FOUND_CODE, message: `'${method}' wasn't found` };
}

export function sessionNotFoundError(): CdpErrorShape {
  return { code: CDP_SESSION_NOT_FOUND_CODE, message: "Session with given id not found." };
}

export function invalidParamsError(message: string): CdpErrorShape {
  return { code: CDP_INVALID_PARAMS_CODE, message };
}

export function serverError(message: string): CdpErrorShape {
  return { code: CDP_SERVER_ERROR_CODE, message };
}

export interface BrowserCdpVersionInput {
  chromeVersion: string;
  userAgent: string;
  v8Version: string;
}

export function buildBrowserVersionResult(input: BrowserCdpVersionInput): {
  protocolVersion: "1.3";
  product: string;
  revision: string;
  userAgent: string;
  jsVersion: string;
} {
  return {
    protocolVersion: "1.3",
    product: `Chrome/${input.chromeVersion}`,
    revision: "@synara-in-app-browser",
    userAgent: input.userAgent,
    jsVersion: input.v8Version,
  };
}

function readString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Host operations the browser-level dispatcher needs. Everything async is owned by the
 * proxy server; this module only decides which operation a command maps to and shapes
 * the reply, so the mapping stays purely unit-testable.
 */
export interface BrowserCdpCommandHost {
  getVersion(): BrowserCdpVersionInput;
  listTargets(): CdpTargetInfo[];
  getTargetInfo(targetId: string): CdpTargetInfo | null;
  getBrowserTargetInfo(): Omit<CdpTargetInfo, "type"> & { type: string };
  /** Emits Target.targetCreated for every current target (setDiscoverTargets contract). */
  announceDiscoveredTargets(): void;
  /** Records the auto-attach flag and attaches every current target when enabling. */
  setAutoAttach(autoAttach: boolean): Promise<void>;
  /** Attaches to the target, emitting Target.attachedToTarget, and returns the sessionId. */
  attachToTarget(targetId: string): Promise<string>;
  /** Detaches a top-level proxy session, emitting Target.detachedFromTarget. */
  detachFromTarget(sessionId: string): Promise<boolean>;
  /** Opens a new tab (waking the panel when needed) and returns its targetId. */
  createTarget(url: string): Promise<string>;
  closeTarget(targetId: string): Promise<boolean>;
  /** The only UI-switching entry point: brings the target's tab to the front. */
  activateTarget(targetId: string): Promise<void>;
}

export type BrowserCdpCommandOutcome =
  | { kind: "result"; result: unknown }
  | { kind: "error"; error: CdpErrorShape };

function ok(result: unknown): BrowserCdpCommandOutcome {
  return { kind: "result", result };
}

function fail(error: CdpErrorShape): BrowserCdpCommandOutcome {
  return { kind: "error", error };
}

/**
 * Handles a command that arrived without a sessionId, i.e. addressed to the synthetic
 * browser target. These are never forwarded to Electron: the browser-level protocol
 * surface is fully synthesized here (see plan 013 §5.3).
 */
export async function handleBrowserCdpCommand(
  message: CdpClientMessage,
  host: BrowserCdpCommandHost,
): Promise<BrowserCdpCommandOutcome> {
  switch (message.method) {
    case "Browser.getVersion":
      return ok(buildBrowserVersionResult(host.getVersion()));
    case "Browser.close":
      // Refused outright: a single agent command must not be able to take down Synara.
      return fail(serverError("Browser.close is not allowed on the Synara in-app browser."));
    case "Target.setDiscoverTargets": {
      if (message.params.discover === true) {
        host.announceDiscoveredTargets();
      }
      return ok({});
    }
    case "Target.getTargets":
      return ok({ targetInfos: host.listTargets() });
    case "Target.getTargetInfo": {
      const targetId = readString(message.params, "targetId");
      if (!targetId) {
        return ok({ targetInfo: host.getBrowserTargetInfo() });
      }
      const targetInfo = host.getTargetInfo(targetId);
      if (!targetInfo) {
        return fail(invalidParamsError(`No target with given id found`));
      }
      return ok({ targetInfo });
    }
    case "Target.setAutoAttach": {
      await host.setAutoAttach(message.params.autoAttach === true);
      return ok({});
    }
    case "Target.attachToTarget": {
      const targetId = readString(message.params, "targetId");
      if (!targetId) {
        return fail(invalidParamsError("Target.attachToTarget requires a targetId"));
      }
      try {
        const sessionId = await host.attachToTarget(targetId);
        return ok({ sessionId });
      } catch (error) {
        return fail(serverError(error instanceof Error ? error.message : "Attach failed"));
      }
    }
    case "Target.detachFromTarget": {
      const sessionId = readString(message.params, "sessionId");
      if (!sessionId) {
        return fail(invalidParamsError("Target.detachFromTarget requires a sessionId"));
      }
      const detached = await host.detachFromTarget(sessionId);
      return detached ? ok({}) : fail(sessionNotFoundError());
    }
    case "Target.createTarget": {
      const url = readString(message.params, "url") ?? "about:blank";
      try {
        const targetId = await host.createTarget(url);
        return ok({ targetId });
      } catch (error) {
        return fail(
          serverError(error instanceof Error ? error.message : "Could not create a target"),
        );
      }
    }
    case "Target.closeTarget": {
      const targetId = readString(message.params, "targetId");
      if (!targetId) {
        return fail(invalidParamsError("Target.closeTarget requires a targetId"));
      }
      const success = await host.closeTarget(targetId);
      return success
        ? ok({ success: true })
        : fail(invalidParamsError("No target with given id found"));
    }
    case "Target.activateTarget": {
      const targetId = readString(message.params, "targetId");
      if (!targetId) {
        return fail(invalidParamsError("Target.activateTarget requires a targetId"));
      }
      const targetInfo = host.getTargetInfo(targetId);
      if (!targetInfo) {
        return fail(invalidParamsError("No target with given id found"));
      }
      await host.activateTarget(targetId);
      return ok({});
    }
    case "Target.getBrowserContexts":
      // Chrome only lists non-default contexts here; Synara has exactly the default one.
      return ok({ browserContextIds: [] });
    case "Target.createBrowserContext":
      // Explicit refusal instead of pretending: puppeteer degrades correctly on errors,
      // but a fake context id would corrupt its state.
      return fail(
        serverError("The Synara in-app browser does not support creating browser contexts."),
      );
    case "Target.disposeBrowserContext":
      return fail(
        serverError("The Synara in-app browser does not support disposing browser contexts."),
      );
    default:
      // Unknown browser-level command: Chrome-shaped -32601, never silently swallowed
      // and never forwarded to Electron.
      return fail(methodNotFoundError(message.method));
  }
}

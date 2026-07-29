// FILE: outboundHttp.ts
// Purpose: Owns bounded, origin-pinned, DNS-safe outbound HTTP for server integrations.
// Layer: Shared Node/Electron network security boundary

import { randomUUID } from "node:crypto";
import type { LookupAddress } from "node:dns";
import * as Dns from "node:dns/promises";
import * as Http from "node:http";
import * as Https from "node:https";
import * as Net from "node:net";
import * as Tls from "node:tls";

import {
  assertJsonWithinLimits,
  assertOutboundUrlAllowed,
  assertPublicIpAddress,
  isLoopbackIpAddress,
  isPublicIpAddress,
  normalizeOutboundOrigin,
  stripOutboundSensitiveHeaders,
} from "./outboundHttpPolicy";
import { type OutboundProxyConfig, shouldBypassProxy } from "./outboundProxy";

export type OutboundHttpErrorCode =
  | "aborted"
  | "admission"
  | "compressed-response"
  | "dns"
  | "invalid-redirect"
  | "json"
  | "proxy"
  | "request"
  | "request-too-large"
  | "response-too-large"
  | "timeout";

export class OutboundHttpError extends Error {
  readonly code: OutboundHttpErrorCode;
  override readonly cause?: unknown;

  constructor(code: OutboundHttpErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "OutboundHttpError";
    this.code = code;
    this.cause = cause;
  }
}

export interface OutboundHttpPolicy {
  readonly service: string;
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly timeoutMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  readonly maxConcurrent: number;
  readonly maxQueued: number;
  readonly requirePublicAddress?: boolean;
}

export interface OutboundHttpRequest {
  readonly policy: OutboundHttpPolicy;
  readonly url: string | URL;
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly headers?: ConstructorParameters<typeof Headers>[0];
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
}

export interface OutboundHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
  readonly url: string;
}

export interface OutboundMultipartPart {
  readonly name: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly body: string | Uint8Array;
}

export interface OutboundMultipartOptions {
  readonly maxBytes: number;
}

function quoteMultipartToken(value: string, label: string): string {
  if (!value || /[\r\n]/u.test(value)) {
    throw new OutboundHttpError("request", `Multipart ${label} is invalid.`);
  }
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function assertMultipartContentType(value: string): string {
  if (!value.trim() || /[\r\n]/u.test(value)) {
    throw new OutboundHttpError("request", "Multipart content type is invalid.");
  }
  return value;
}

export function encodeOutboundMultipart(
  parts: ReadonlyArray<OutboundMultipartPart>,
  options: OutboundMultipartOptions,
): { readonly body: Uint8Array; readonly contentType: string } {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new OutboundHttpError("request", "Multipart byte limit must be a positive integer.");
  }
  const boundary = `Synara-${randomUUID()}`;
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  let size = 0;
  const push = (chunk: Uint8Array) => {
    if (chunk.byteLength > options.maxBytes - size) {
      throw new OutboundHttpError(
        "request-too-large",
        `Multipart request exceeded the ${options.maxBytes}-byte limit.`,
      );
    }
    chunks.push(chunk);
    size += chunk.byteLength;
  };

  for (const part of parts) {
    const disposition = [
      `form-data; name="${quoteMultipartToken(part.name, "field name")}"`,
      ...(part.filename ? [`filename="${quoteMultipartToken(part.filename, "filename")}"`] : []),
    ].join("; ");
    push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: ${disposition}\r\n${
          part.contentType
            ? `Content-Type: ${assertMultipartContentType(part.contentType)}\r\n`
            : ""
        }\r\n`,
      ),
    );
    push(typeof part.body === "string" ? encoder.encode(part.body) : part.body);
    push(encoder.encode("\r\n"));
  }
  push(encoder.encode(`--${boundary}--\r\n`));

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

interface AdmissionWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

class AdmissionGate {
  private active = 0;
  private readonly waiters: AdmissionWaiter[] = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueued: number,
  ) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw abortedError(signal.reason);
    }
    if (this.active < this.limit) {
      this.active += 1;
      return this.makeRelease();
    }
    if (this.waiters.length >= this.maxQueued) {
      throw new OutboundHttpError(
        "admission",
        "Outbound request admission queue is full for this service.",
      );
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: AdmissionWaiter = {
        resolve,
        reject,
        ...(signal ? { signal } : {}),
        ...(signal
          ? {
              onAbort: () => {
                const index = this.waiters.indexOf(waiter);
                if (index >= 0) this.waiters.splice(index, 1);
                reject(abortedError(signal.reason));
              },
            }
          : {}),
      };
      if (signal && waiter.onAbort) {
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });

    return this.makeRelease();
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        if (next.signal && next.onAbort) {
          next.signal.removeEventListener("abort", next.onAbort);
        }
        next.resolve();
        return;
      }
      this.active -= 1;
    };
  }
}

const GLOBAL_MAX_CONCURRENT = 24;
const GLOBAL_MAX_QUEUED = 96;
const globalAdmission = new AdmissionGate(GLOBAL_MAX_CONCURRENT, GLOBAL_MAX_QUEUED);
const serviceAdmissions = new Map<string, AdmissionGate>();

function serviceAdmission(policy: OutboundHttpPolicy): AdmissionGate {
  const existing = serviceAdmissions.get(policy.service);
  if (existing) return existing;
  const created = new AdmissionGate(policy.maxConcurrent, policy.maxQueued);
  serviceAdmissions.set(policy.service, created);
  return created;
}

function abortedError(reason?: unknown): OutboundHttpError {
  return new OutboundHttpError("aborted", "Outbound request was cancelled.", reason);
}

function bodyBytes(body: string | Uint8Array | undefined): Uint8Array | undefined {
  if (body === undefined) return undefined;
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

function responseHeaders(headers: Http.IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

function requestHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name] = value;
  });
  return result;
}

async function resolvePinnedAddress(
  url: URL,
  requirePublicAddress: boolean,
  signal: AbortSignal,
): Promise<{ readonly address: string; readonly family: 4 | 6 }> {
  if (signal.aborted) throw abortedError(signal.reason);
  const literalFamily = Net.isIP(url.hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (requirePublicAddress) assertPublicIpAddress(url.hostname);
    return { address: url.hostname, family: literalFamily };
  }

  let addresses: ReadonlyArray<{ readonly address: string; readonly family: 4 | 6 }>;
  try {
    addresses = (await Promise.race([
      Dns.lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(abortedError(signal.reason)), {
          once: true,
        });
      }),
    ])) as ReadonlyArray<{ readonly address: string; readonly family: 4 | 6 }>;
  } catch (cause) {
    if (cause instanceof OutboundHttpError) throw cause;
    throw new OutboundHttpError("dns", "Outbound destination DNS lookup failed.", cause);
  }
  if (addresses.length === 0) {
    throw new OutboundHttpError("dns", "Outbound destination DNS lookup returned no addresses.");
  }
  if (requirePublicAddress) {
    for (const result of addresses) assertPublicIpAddress(result.address);
  }
  const selected = addresses[0];
  if (!selected) {
    throw new OutboundHttpError("dns", "Outbound destination DNS lookup returned no addresses.");
  }
  return selected;
}

/**
 * Custom `http`/`https` lookup that always returns the already-pinned address,
 * closing the DNS-rebinding window between the policy check and the connect.
 *
 * Node picks the callback shape via `options.all`, and the two shapes are not
 * interchangeable: modern Node/Bun Happy Eyeballs pass `{ all: true }` and
 * expect the array form, and answering such a call with `(address, family)`
 * makes the socket read `undefined` as its host and throw
 * ERR_INVALID_IP_ADDRESS before any byte is sent.
 */
export function invokePinnedDnsLookup(
  pinned: { readonly address: string; readonly family: 4 | 6 },
  options: { readonly all?: boolean | undefined } | undefined,
  // Match Node/Bun's Happy Eyeballs lookup callback shape (`LookupAddress[]`, not
  // a readonly structural twin) so `http.request({ lookup })` typechecks.
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  if (options?.all) {
    callback(null, [{ address: pinned.address, family: pinned.family }]);
    return;
  }
  callback(null, pinned.address, pinned.family);
}

/** Adapts {@link invokePinnedDnsLookup} to the `lookup` hook shape Node expects. */
export function createPinnedLookup(pinned: {
  readonly address: string;
  readonly family: 4 | 6;
}): Net.LookupFunction {
  return ((
    _hostname: string,
    options: { readonly all?: boolean | undefined } | undefined,
    callback: Parameters<typeof invokePinnedDnsLookup>[2],
  ) => {
    invokePinnedDnsLookup(pinned, options, callback);
  }) as Net.LookupFunction;
}

export type OutboundProxyResolver = () => OutboundProxyConfig | undefined;

let outboundProxyResolver: OutboundProxyResolver | undefined;

/**
 * Register the process-wide proxy source. Left unset, every request behaves
 * exactly as it did before proxy support existed.
 *
 * A resolver (rather than a value) is what lets a settings-panel change take
 * effect on the next request without a restart.
 */
export function setOutboundProxyResolver(resolver: OutboundProxyResolver | undefined): void {
  outboundProxyResolver = resolver;
}

function resolveProxyForTarget(target: URL): OutboundProxyConfig | undefined {
  const proxy = outboundProxyResolver?.();
  if (!proxy) return undefined;
  return shouldBypassProxy(target, proxy.noProxy) ? undefined : proxy;
}

/**
 * A proxy may be on loopback (a local proxy app) or on a public address, but
 * never elsewhere in private space — that would turn a misconfiguration into an
 * SSRF pivot into the user's LAN.
 */
function assertProxyAddressAllowed(address: string): void {
  if (isLoopbackIpAddress(address) || isPublicIpAddress(address)) return;
  throw new OutboundHttpError(
    "proxy",
    "Proxy address resolved to a private, reserved, or invalid address. Only loopback or public proxies are allowed.",
  );
}

/**
 * Open a CONNECT tunnel through the proxy and hand back the raw socket.
 *
 * Note the security consequence, which is unavoidable rather than an oversight:
 * the destination hostname is resolved by the proxy, so the destination's
 * `requirePublicAddress` check cannot apply on this path. The remaining — and
 * still hard — control is the per-service origin allowlist enforced by
 * `assertOutboundUrlAllowed` before we ever get here.
 */
async function connectThroughProxy(input: {
  readonly proxyUrl: URL;
  readonly target: URL;
  readonly signal: AbortSignal;
}): Promise<Net.Socket> {
  const pinnedProxy = await resolvePinnedAddress(input.proxyUrl, false, input.signal).catch(
    (cause: unknown) => {
      if (cause instanceof OutboundHttpError && cause.code === "aborted") throw cause;
      throw new OutboundHttpError(
        "proxy",
        "Could not resolve the configured proxy address.",
        cause,
      );
    },
  );
  assertProxyAddressAllowed(pinnedProxy.address);

  const targetPort = input.target.port || (input.target.protocol === "https:" ? "443" : "80");
  const authority = `${input.target.hostname}:${targetPort}`;

  return await new Promise<Net.Socket>((resolve, reject) => {
    let settled = false;
    // The handshake is written by hand rather than via `http.request`'s CONNECT
    // support: Bun's http compatibility layer rejects the authority-form path
    // ("host:port", no leading slash) with "fetch() URL is invalid", which would
    // break every proxied request under `bun run`. Dialing the already-pinned
    // address also makes the DNS-rebinding guard exact without a lookup hook.
    const socket = Net.connect({
      host: pinnedProxy.address,
      port: Number(input.proxyUrl.port || "80"),
    });

    const settle = (error?: OutboundHttpError) => {
      if (settled) return false;
      settled = true;
      socket.removeListener("data", onData);
      if (error) {
        socket.destroy();
        reject(error);
        return false;
      }
      return true;
    };

    let header = "";
    const onData = (chunk: Buffer) => {
      // latin1 keeps byte boundaries intact so any body bytes that arrive in
      // the same packet can be pushed back unchanged.
      header += chunk.toString("latin1");
      const end = header.indexOf("\r\n\r\n");
      if (end === -1) {
        if (header.length > 16_384) {
          settle(new OutboundHttpError("proxy", "Proxy sent an oversized CONNECT response."));
        }
        return;
      }
      const status = Number(header.slice(0, header.indexOf("\r\n")).split(" ")[1]);
      if (status !== 200) {
        settle(
          new OutboundHttpError("proxy", `Proxy refused the CONNECT tunnel (${status || 0}).`),
        );
        return;
      }
      const trailing = header.slice(end + 4);
      if (!settle()) return;
      if (trailing.length > 0) socket.unshift(Buffer.from(trailing, "latin1"));
      resolve(socket);
    };

    socket.once("connect", () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    socket.on("data", onData);
    socket.once("error", (cause) => {
      if (input.signal.aborted) {
        settle(abortedError(input.signal.reason) as OutboundHttpError);
        return;
      }
      settle(new OutboundHttpError("proxy", "Could not reach the configured HTTP proxy.", cause));
    });
    socket.once("close", () => {
      settle(
        new OutboundHttpError("proxy", "Proxy closed the connection before the tunnel opened."),
      );
    });
    if (input.signal.aborted) {
      settle(abortedError(input.signal.reason) as OutboundHttpError);
      return;
    }
    input.signal.addEventListener(
      "abort",
      () => settle(abortedError(input.signal.reason) as OutboundHttpError),
      { once: true },
    );
  });
}

async function requestHop(input: {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: Uint8Array;
  readonly maxResponseBytes: number;
  readonly requirePublicAddress: boolean;
  readonly proxy?: OutboundProxyConfig;
  readonly signal: AbortSignal;
}): Promise<OutboundHttpResponse> {
  // Through a proxy the destination is dialed by the proxy, so we pin the proxy
  // instead. Failure here is terminal: we never silently fall back to a direct
  // connection, or "did this request use the proxy?" becomes unanswerable.
  const tunnel = input.proxy
    ? await connectThroughProxy({
        proxyUrl: input.proxy.url,
        target: input.url,
        signal: input.signal,
      })
    : undefined;
  const connectionOptions = tunnel
    ? {
        agent: false as const,
        // The tunnel already reaches the destination, so wrap it in TLS and
        // hand the stream to the request instead of dialing. `normalizeOutboundOrigin`
        // admits https origins only, so the destination is always TLS.
        createConnection: () => Tls.connect({ socket: tunnel, servername: input.url.hostname }),
      }
    : {
        lookup: createPinnedLookup(
          await resolvePinnedAddress(input.url, input.requirePublicAddress, input.signal),
        ),
      };

  return await new Promise<OutboundHttpResponse>((resolve, reject) => {
    let settled = false;
    const settle = (result: OutboundHttpResponse | Error) => {
      if (settled) return;
      settled = true;
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const transport = input.url.protocol === "https:" ? Https : Http;
    const request = transport.request(
      input.url,
      {
        method: input.method,
        headers: requestHeaders(input.headers),
        signal: input.signal,
        ...connectionOptions,
      },
      (response) => {
        const headers = responseHeaders(response.headers);
        const encoding = headers.get("content-encoding")?.trim().toLowerCase();
        if (encoding && encoding !== "identity") {
          response.destroy();
          settle(
            new OutboundHttpError(
              "compressed-response",
              "Compressed outbound responses are rejected so byte limits remain exact.",
            ),
          );
          return;
        }
        const declaredLength = Number(headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > input.maxResponseBytes) {
          response.destroy();
          settle(
            new OutboundHttpError(
              "response-too-large",
              `Outbound response exceeded the ${input.maxResponseBytes}-byte limit.`,
            ),
          );
          return;
        }

        const chunks: Uint8Array[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | Uint8Array | string) => {
          const bytes =
            typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
          size += bytes.byteLength;
          if (size > input.maxResponseBytes) {
            response.destroy();
            settle(
              new OutboundHttpError(
                "response-too-large",
                `Outbound response exceeded the ${input.maxResponseBytes}-byte limit.`,
              ),
            );
            return;
          }
          chunks.push(bytes);
        });
        response.once("end", () => {
          const body = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
          }
          settle({
            status: response.statusCode ?? 0,
            headers,
            body,
            url: input.url.href,
          });
        });
        response.once("error", (cause) => {
          settle(new OutboundHttpError("request", "Outbound response failed.", cause));
        });
      },
    );
    request.once("error", (cause) => {
      if (input.signal.aborted) {
        settle(abortedError(input.signal.reason));
      } else {
        settle(new OutboundHttpError("request", "Outbound request failed.", cause));
      }
    });
    if (input.body) request.write(input.body);
    request.end();
  });
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export class OutboundHttpClient {
  async request(input: OutboundHttpRequest): Promise<OutboundHttpResponse> {
    const policy = input.policy;
    const allowedOrigins = policy.allowedOrigins.map(normalizeOutboundOrigin);
    let url = assertOutboundUrlAllowed({ url: input.url, allowedOrigins });
    let method = input.method ?? "GET";
    let body = bodyBytes(input.body);
    if ((body?.byteLength ?? 0) > policy.maxRequestBytes) {
      throw new OutboundHttpError(
        "request-too-large",
        `Outbound request exceeded the ${policy.maxRequestBytes}-byte limit.`,
      );
    }
    let headers = new Headers(input.headers);
    headers.set("accept-encoding", "identity");
    if (body) headers.set("content-length", String(body.byteLength));

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) abortFromCaller();
    else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(
      () =>
        controller.abort(
          new OutboundHttpError(
            "timeout",
            `Outbound request exceeded its ${policy.timeoutMs}ms deadline.`,
          ),
        ),
      policy.timeoutMs,
    );
    timeout.unref?.();

    let releaseGlobal: (() => void) | undefined;
    let releaseService: (() => void) | undefined;
    try {
      releaseGlobal = await globalAdmission.acquire(controller.signal);
      releaseService = await serviceAdmission(policy).acquire(controller.signal);
      for (let redirects = 0; ; redirects += 1) {
        // Resolved per hop: a redirect may cross into a NO_PROXY host.
        const proxy = resolveProxyForTarget(url);
        const response = await requestHop({
          url,
          method,
          headers,
          ...(body ? { body } : {}),
          maxResponseBytes: policy.maxResponseBytes,
          requirePublicAddress: policy.requirePublicAddress ?? true,
          ...(proxy ? { proxy } : {}),
          signal: controller.signal,
        });
        if (!isRedirectStatus(response.status)) return response;
        if (redirects >= policy.maxRedirects) {
          throw new OutboundHttpError(
            "invalid-redirect",
            "Outbound response exceeded its redirect limit.",
          );
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new OutboundHttpError(
            "invalid-redirect",
            "Outbound redirect did not include a Location header.",
          );
        }
        const nextUrl = assertOutboundUrlAllowed({
          url: new URL(location, url),
          allowedOrigins,
        });
        if (nextUrl.origin !== url.origin) {
          headers = stripOutboundSensitiveHeaders(headers);
        }
        if (response.status === 303) {
          method = "GET";
          body = undefined;
          headers.delete("content-length");
          headers.delete("content-type");
        }
        url = nextUrl;
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        if (reason instanceof OutboundHttpError && reason.code === "timeout") throw reason;
        throw abortedError(reason);
      }
      throw cause;
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
      releaseService?.();
      releaseGlobal?.();
    }
  }
}

export const outboundHttp = new OutboundHttpClient();

export function decodeOutboundText(response: OutboundHttpResponse): string {
  return new TextDecoder().decode(response.body);
}

export function decodeOutboundJson(
  response: OutboundHttpResponse,
  limits: { readonly maxDepth: number; readonly maxNodes: number },
): unknown {
  let value: unknown;
  try {
    value = JSON.parse(decodeOutboundText(response)) as unknown;
  } catch (cause) {
    throw new OutboundHttpError("json", "Outbound response was not valid JSON.", cause);
  }
  assertJsonWithinLimits(value, limits);
  return value;
}

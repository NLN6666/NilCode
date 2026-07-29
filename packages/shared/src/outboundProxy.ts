// FILE: outboundProxy.ts
// Purpose: Pure parsing and matching rules for the outbound HTTP proxy (no I/O).
// Layer: Shared network policy, consumed by outboundHttp and the server settings runtime

export class OutboundProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundProxyConfigError";
  }
}

export interface OutboundProxyConfig {
  /** Always an `http:` URL without credentials, path, query, or fragment. */
  readonly url: URL;
  /** Lowercased NO_PROXY entries; see {@link shouldBypassProxy}. */
  readonly noProxy: readonly string[];
}

/**
 * Parse a user- or env-supplied proxy address.
 *
 * Only `http:` is accepted: we reach the proxy in plaintext and open a CONNECT
 * tunnel, so an `https:` or `socks5:` value would fail at connect time in a way
 * that is hard to diagnose. Rejecting it here turns it into a clear message.
 */
export function parseProxyUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new OutboundProxyConfigError("Proxy address is empty.");
  }
  // `127.0.0.1:7890` is what proxy apps display, but `new URL()` would read
  // `127.0.0.1:` as the scheme, so give a schemeless value the http default.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new OutboundProxyConfigError(`Proxy address '${raw}' is not a valid URL.`);
  }
  if (url.protocol !== "http:") {
    throw new OutboundProxyConfigError(
      `Proxy address must use http:// (got '${url.protocol}//'). SOCKS and HTTPS proxies are not supported.`,
    );
  }
  if (url.username || url.password) {
    throw new OutboundProxyConfigError("Proxy authentication is not supported.");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new OutboundProxyConfigError("Proxy address must not include a path, query, or fragment.");
  }
  if (!url.hostname) {
    throw new OutboundProxyConfigError(`Proxy address '${raw}' has no host.`);
  }
  return url;
}

export function parseNoProxy(raw: string): readonly string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function defaultPortForProtocol(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

/**
 * NO_PROXY matching, following the de-facto curl/Go behavior:
 * `*` bypasses everything, a bare `example.com` also covers its subdomains,
 * a leading dot covers subdomains and the apex, and a `host:port` entry only
 * matches that port.
 */
export function shouldBypassProxy(target: URL, noProxy: readonly string[]): boolean {
  if (noProxy.length === 0) return false;
  const host = target.hostname.toLowerCase();
  const port = target.port || defaultPortForProtocol(target.protocol);

  for (const entry of noProxy) {
    if (entry === "*") return true;

    let pattern = entry;
    const separator = entry.lastIndexOf(":");
    // Only treat a trailing `:digits` as a port so IPv6 literals stay intact.
    if (separator > 0 && /^\d+$/.test(entry.slice(separator + 1))) {
      if (entry.slice(separator + 1) !== port) continue;
      pattern = entry.slice(0, separator);
    }
    if (!pattern) continue;

    const bare = pattern.startsWith(".") ? pattern.slice(1) : pattern;
    if (host === bare || host.endsWith(`.${bare}`)) return true;
  }
  return false;
}

// Lowercase first: curl treats it as authoritative, and `HTTP_PROXY` in
// uppercase is untrustworthy in CGI-style environments.
const PROXY_ENV_NAMES = [
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
  "http_proxy",
  "HTTP_PROXY",
] as const;

const NO_PROXY_ENV_NAMES = ["no_proxy", "NO_PROXY"] as const;

/**
 * Resolve a proxy from standard environment variables.
 *
 * Unparseable values are skipped rather than thrown: a globally exported
 * `ALL_PROXY=socks5://…` is common and must not prevent the server from
 * starting. Values typed into the settings panel go through
 * {@link parseProxyUrl} directly so the user sees the error.
 */
export function resolveProxyFromEnv(env: NodeJS.ProcessEnv): OutboundProxyConfig | undefined {
  const rawNoProxy = NO_PROXY_ENV_NAMES.map((name) => env[name]).find(
    (value) => value !== undefined && value.trim().length > 0,
  );
  const noProxy = rawNoProxy ? parseNoProxy(rawNoProxy) : [];

  for (const name of PROXY_ENV_NAMES) {
    const raw = env[name];
    if (!raw || !raw.trim()) continue;
    try {
      return { url: parseProxyUrl(raw), noProxy };
    } catch {
      continue;
    }
  }
  return undefined;
}

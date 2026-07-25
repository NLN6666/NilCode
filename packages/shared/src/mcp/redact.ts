// FILE: mcp/redact.ts
// Purpose: Strip credentials out of agent MCP server configuration before it leaves the server.
// Layer: Shared pure helpers
// Exports: REDACTED_URL_PLACEHOLDER, redactMcpUrl, redactedMcpKeys

/** Stand-in for a URL we could not parse; never echo the raw string, it may embed a token. */
export const REDACTED_URL_PLACEHOLDER = "<invalid url>";

/**
 * Keep only the parts of an MCP endpoint that identify it — scheme, host, port and path.
 * Query strings, fragments and `user:pass@` userinfo routinely carry API keys, so they are
 * dropped rather than masked: the browser never receives the bytes at all.
 */
export function redactMcpUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return REDACTED_URL_PLACEHOLDER;
  }
}

/**
 * Sorted key names of an `env` / `headers` style record. Values are credentials by convention
 * (`CONTEXT7_API_KEY`, `Authorization`, …) and are never returned, matching what `codex mcp list`
 * renders in a terminal — except that a WebSocket frame can cross a network, so the value is
 * discarded here instead of masked.
 */
export function redactedMcpKeys(record: unknown): ReadonlyArray<string> {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return [];
  return Object.keys(record).toSorted();
}

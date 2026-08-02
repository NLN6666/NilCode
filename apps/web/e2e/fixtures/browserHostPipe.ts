import { join } from "node:path";

/**
 * Address the desktop browser-host pipe the way BrowserUsePipeServer binds it. Windows named
 * pipes live in their own namespace, so a path under the test home never binds there and the
 * MCP client only ever reports "no browser host is available".
 */
export function browserHostPipePath(home: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\synara-e2e-browser-host-${crypto.randomUUID()}`
    : join(home, "browser-host.sock");
}

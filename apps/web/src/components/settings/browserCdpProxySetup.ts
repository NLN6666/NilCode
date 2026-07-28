// FILE: browserCdpProxySetup.ts
// Purpose: Builds the chrome-devtools-mcp client configuration that points at Synara's
//          in-app browser CDP proxy, so the settings row can hand it over verbatim.
// Layer: Settings UI logic (pure)
// Depends on: nothing

/** Server key the snippet registers under, matching chrome-devtools-mcp's own docs. */
export const BROWSER_CDP_PROXY_MCP_SERVER_NAME = "chrome-devtools";

/**
 * Renders the MCP server entry for the running proxy. `--ws-headers` takes a JSON string,
 * so the bearer header is serialized once more inside the argument list.
 */
export function buildBrowserCdpProxyMcpConfiguration(input: {
  endpoint: string;
  token: string;
}): string {
  return JSON.stringify(
    {
      [BROWSER_CDP_PROXY_MCP_SERVER_NAME]: {
        command: "npx",
        args: [
          "-y",
          "chrome-devtools-mcp@latest",
          "--ws-endpoint",
          input.endpoint,
          "--ws-headers",
          JSON.stringify({ Authorization: `Bearer ${input.token}` }),
        ],
      },
    },
    null,
    2,
  );
}

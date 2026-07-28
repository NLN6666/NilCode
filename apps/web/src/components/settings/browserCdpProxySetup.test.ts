import { describe, expect, it } from "vitest";

import { buildBrowserCdpProxyMcpConfiguration } from "./browserCdpProxySetup";

describe("buildBrowserCdpProxyMcpConfiguration", () => {
  it("emits the chrome-devtools-mcp entry documented in plan 013", () => {
    const configuration = buildBrowserCdpProxyMcpConfiguration({
      endpoint: "ws://127.0.0.1:9333/synara/cdp",
      token: "abc123",
    });

    expect(JSON.parse(configuration)).toEqual({
      "chrome-devtools": {
        command: "npx",
        args: [
          "-y",
          "chrome-devtools-mcp@latest",
          "--ws-endpoint",
          "ws://127.0.0.1:9333/synara/cdp",
          "--ws-headers",
          '{"Authorization":"Bearer abc123"}',
        ],
      },
    });
  });

  it("carries a custom port through the endpoint verbatim", () => {
    const configuration = buildBrowserCdpProxyMcpConfiguration({
      endpoint: "ws://127.0.0.1:4111/synara/cdp",
      token: "token-2",
    });

    expect(configuration).toContain("ws://127.0.0.1:4111/synara/cdp");
    // The headers argument must stay a JSON *string*, not a nested object.
    expect(configuration).toContain('{\\"Authorization\\":\\"Bearer token-2\\"}');
  });
});

import { ThreadId } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EnvironmentSidechatsSection } from "./EnvironmentSidechatsSection";

describe("EnvironmentSidechatsSection", () => {
  it("renders create, open, and delete actions while marking expired conversations", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentSidechatsSection
        sidechats={[
          {
            id: ThreadId.makeUnsafe("sidechat-expired"),
            title: "Old investigation",
            expiredAt: "2026-08-30T12:00:00.000Z",
          },
        ]}
        onCreate={() => undefined}
        onOpen={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(markup).toContain("Old investigation");
    expect(markup).toContain("opacity-60");
    expect(markup.match(/<button\b/g) ?? []).toHaveLength(3);
  });

  it("renders nothing when there are no side chats yet", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentSidechatsSection
        sidechats={[]}
        onCreate={() => undefined}
        onOpen={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(markup).toBe("");
  });
});

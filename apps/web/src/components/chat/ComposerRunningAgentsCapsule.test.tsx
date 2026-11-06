import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerRunningAgentsCapsule } from "./ComposerRunningAgentsCapsule";

describe("ComposerRunningAgentsCapsule", () => {
  it("exposes the current running-agent count in the capsule", () => {
    const markup = renderToStaticMarkup(<ComposerRunningAgentsCapsule count={2} />);
    const capsule = markup.slice(markup.indexOf('data-testid="running-agents-capsule"'));

    expect(capsule).toMatch(/<span\b[^>]*>\s*2\b/u);
  });

  it("is a button only when there is a card to show", () => {
    expect(renderToStaticMarkup(<ComposerRunningAgentsCapsule count={2} />)).not.toContain(
      "<button",
    );
    expect(
      renderToStaticMarkup(<ComposerRunningAgentsCapsule count={2} onShow={() => {}} />),
    ).toContain("<button");
  });
});

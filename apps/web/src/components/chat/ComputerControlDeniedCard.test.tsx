// FILE: ComputerControlDeniedCard.test.tsx
// Purpose: Keeps the denial card's Enable wiring truthful: the button only
// shows while control is off, and the card flips to a confirmation once on.
// Layer: Chat transcript UI regression test

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComputerControlDeniedCard } from "./ComputerControlDeniedCard";

describe("ComputerControlDeniedCard", () => {
  it("hides Enable without a handler instead of rendering a dead button", () => {
    const markup = renderToStaticMarkup(<ComputerControlDeniedCard />);

    expect(markup).not.toContain("<button");
    expect(
      renderToStaticMarkup(<ComputerControlDeniedCard onEnable={() => undefined} />),
    ).toContain("<button");
  });

  it("does not offer enable once control is already on", () => {
    const markup = renderToStaticMarkup(
      <ComputerControlDeniedCard computerControlEnabled onEnable={() => undefined} />,
    );

    expect(markup).not.toContain("<button");
  });
});

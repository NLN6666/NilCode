// FILE: ComputerSetupRequiredCard.test.tsx
// Purpose: Keeps the setup card aligned with live permission state and explicit setup.
// Layer: Chat transcript UI regression test

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComputerStatusResult } from "@synara/contracts";

import { ComputerSetupRequiredCard } from "./ComputerSetupRequiredCard";

function status(availability: ComputerStatusResult["availability"]): ComputerStatusResult {
  return {
    computerId: "desktop",
    availability,
    health: { status: "connected", captureAvailable: true, consecutiveFailures: 0, reconnects: 0 },
    capabilities: {
      windows: true,
      windowBounds: true,
      stacking: true,
      capture: true,
      input: true,
      clipboard: true,
      focus: true,
      raise: true,
      ghostCursor: true,
      visibleDesktop: true,
    },
    provisionable: true,
  };
}

describe("ComputerSetupRequiredCard", () => {
  it("offers setup when permission grants are missing", () => {
    const markup = renderToStaticMarkup(
      <ComputerSetupRequiredCard
        missing={["accessibility", "screenRecording"]}
        onSetUp={() => undefined}
      />,
    );

    expect(markup.match(/<button\b/g) ?? []).toHaveLength(1);
    expect(markup).not.toContain('disabled=""');
  });

  it("names the responsible app in the tccutil fallback, and withholds it when unknown", () => {
    // The command has to repair *this* Synara's TCC row. `.dev` and `.canary`
    // are separate bundle identifiers, so a guessed production id would revoke a
    // separately installed release build's working grants and fix nothing here.
    const known = renderToStaticMarkup(
      <ComputerSetupRequiredCard
        missing={["accessibility"]}
        buildSignature="adhoc"
        bundleId="com.emanueledipietro.synara.dev"
        onSetUp={() => undefined}
      />,
    );
    expect(known).toContain("tccutil reset Accessibility com.emanueledipietro.synara.dev");

    // A server with no desktop shell behind it has no responsible app, and the
    // card must say nothing rather than guess.
    const unknown = renderToStaticMarkup(
      <ComputerSetupRequiredCard
        missing={["accessibility"]}
        buildSignature="adhoc"
        onSetUp={() => undefined}
      />,
    );
    expect(unknown).not.toContain("tccutil");
  });

  it("drops the button once the grants have landed", () => {
    const markup = renderToStaticMarkup(
      <ComputerSetupRequiredCard
        missing={["accessibility"]}
        computerControlReady
        onSetUp={() => undefined}
      />,
    );

    expect(markup).not.toContain("<button");
  });

  it("replaces historical missing grants and build identity with the live status", () => {
    const markup = renderToStaticMarkup(
      <ComputerSetupRequiredCard
        missing={["accessibility", "screenRecording"]}
        buildSignature="adhoc"
        bundleId="old.bundle"
        status={status({
          kind: "permission-required",
          missing: ["screenRecording"],
          buildSignature: "signed",
          message: "Screen Recording is missing.",
        })}
        onSetUp={() => undefined}
      />,
    );
    expect(markup).not.toContain("old.bundle");
    expect(markup.match(/<button\b/g) ?? []).toHaveLength(1);
  });

  it("reports unsupported platforms and status failures without old grant claims", () => {
    const unsupported = renderToStaticMarkup(
      <ComputerSetupRequiredCard
        missing={["accessibility", "screenRecording"]}
        status={status({ kind: "unsupported-platform", platform: "win32" })}
        onSetUp={() => undefined}
      />,
    );
    expect(unsupported).not.toContain("<button");
    const failed = renderToStaticMarkup(
      <ComputerSetupRequiredCard
        missing={["accessibility"]}
        computerControlReady
        status={status({ kind: "available" })}
        statusError="The server disconnected."
        onSetUp={() => undefined}
        onRecheck={() => undefined}
      />,
    );
    expect(failed).toContain("The server disconnected.");
    expect(failed.match(/<button\b/g) ?? []).toHaveLength(1);
  });

  it("requires connected health and capture access before reporting readiness", () => {
    const current = status({ kind: "available" });
    const markup = renderToStaticMarkup(
      <ComputerSetupRequiredCard
        status={{
          ...current,
          health: { ...current.health, status: "unavailable" },
          provisionable: false,
        }}
        computerControlReady
      />,
    );
    expect(markup).toContain("bg-warning/8 text-warning");
    expect(markup).not.toContain("bg-success/8 text-success");
  });

  it("disables setup while the shared request is pending", () => {
    const markup = renderToStaticMarkup(
      <ComputerSetupRequiredCard isPending onSetUp={() => undefined} />,
    );
    expect(markup).toContain('disabled=""');
  });
});

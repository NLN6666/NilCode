// FILE: ComposerVoiceRecorderBar.browser.tsx
// Purpose: Verifies voice recording exposes cancel plus a send-styled primary stop action.
// Layer: Browser UI test
// Depends on: vitest browser rendering and ComposerVoiceRecorderBar.

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { en } from "~/i18n/locales/en";
import { ComposerVoiceRecorderBar } from "./ComposerVoiceRecorderBar";

const voice = en.composer.voice;

describe("ComposerVoiceRecorderBar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses the send treatment for stop while keeping cancel separate", async () => {
    const onDiscard = vi.fn();
    const onStop = vi.fn();
    const screen = await render(
      <ComposerVoiceRecorderBar
        durationLabel="0:03"
        isRecording
        isTranscribing={false}
        waveformLevels={[0.2, 0.6, 0.4]}
        onDiscard={onDiscard}
        onStop={onStop}
      />,
    );

    const stopButton = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${voice.send}"]`,
    );
    expect(stopButton).not.toBeNull();
    expect(stopButton?.className).toContain("bg-[var(--color-text-foreground)]");
    expect(stopButton?.className).toContain("text-[var(--color-background-surface)]");
    // The primary action submits the recording, so it is the only send affordance: the
    // cancel button must not pick up the same treatment or label.
    expect(document.querySelectorAll(`button[aria-label="${voice.send}"]`)).toHaveLength(1);

    await page.getByRole("button", { name: voice.send }).click();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();

    await page.getByRole("button", { name: voice.cancel }).click();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });
});

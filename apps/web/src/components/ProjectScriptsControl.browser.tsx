// FILE: ProjectScriptsControl.browser.tsx
// Purpose: Browser regressions for the chat-header project action control.
// Layer: Browser UI test

import "../index.css";

import { type ProjectScript, type ResolvedKeybindingsConfig } from "@synara/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import ProjectScriptsControl, { type NewProjectScriptInput } from "./ProjectScriptsControl";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

async function mountProjectScriptsControl(props?: {
  scripts?: ProjectScript[];
  preferredScriptId?: string | null;
  runningScriptIds?: ReadonlySet<string>;
  withDetectServices?: boolean;
}) {
  const onRunScript = vi.fn();
  const onStopScript = vi.fn();
  const onDetectServices = vi.fn();
  const onAddScript = vi.fn<(input: NewProjectScriptInput) => void>();
  const onUpdateScript = vi.fn<(scriptId: string, input: NewProjectScriptInput) => void>();
  const onDeleteScript = vi.fn<(scriptId: string) => void>();
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <ProjectScriptsControl
      scripts={props?.scripts ?? []}
      keybindings={EMPTY_KEYBINDINGS}
      preferredScriptId={props?.preferredScriptId ?? null}
      runningScriptIds={props?.runningScriptIds ?? new Set()}
      onRunScript={onRunScript}
      onStopScript={onStopScript}
      onDetectServices={props?.withDetectServices === false ? undefined : onDetectServices}
      onAddScript={onAddScript}
      onUpdateScript={onUpdateScript}
      onDeleteScript={onDeleteScript}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    onRunScript,
    onStopScript,
    onDetectServices,
    onAddScript,
    onUpdateScript,
    onDeleteScript,
  };
}

const WEB_SCRIPT: ProjectScript = {
  id: "erp-web",
  name: "erp-web",
  command: "dotnet run",
  icon: "play",
  runOnWorktreeCreate: false,
  port: 5299,
};

describe("ProjectScriptsControl", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the add-action dialog from the header when no script exists yet", async () => {
    await using _ = await mountProjectScriptsControl();

    await page.getByRole("button", { name: "Add action" }).click();

    await expect.poll(() => document.body.textContent).toContain("Add Action");
    expect(document.body.textContent).toContain(
      "Actions are project-scoped commands you can run from the top bar or keybindings.",
    );
  });

  it("runs the primary action and exposes setup actions in the dropdown", async () => {
    const setupScript: ProjectScript = {
      id: "setup",
      name: "Setup",
      command: "bun install",
      icon: "configure",
      runOnWorktreeCreate: true,
    };
    await using control = await mountProjectScriptsControl({
      scripts: [setupScript],
      preferredScriptId: "setup",
    });

    await page.getByRole("button", { name: "Run Setup" }).click();
    expect(control.onRunScript).toHaveBeenCalledWith(setupScript);

    await page.getByLabelText("Script actions").click();
    await expect.poll(() => document.body.textContent).toContain("Setup (setup)");
    await expect.poll(() => document.body.textContent).toContain("Add action");
  });

  it("offers service detection even before the project has any action", async () => {
    await using control = await mountProjectScriptsControl();

    await page.getByLabelText("Script actions").click();
    await page.getByRole("menuitem", { name: "Detect services" }).click();

    expect(control.onDetectServices).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain add button when there is no project to inspect", async () => {
    await using _ = await mountProjectScriptsControl({ withDetectServices: false });

    await expect.poll(() => document.body.textContent).toContain("Add action");
    expect(document.querySelector('[aria-label="Script actions"]')).toBeNull();
  });

  it("turns a live service into a stop control instead of running it again", async () => {
    await using control = await mountProjectScriptsControl({
      scripts: [WEB_SCRIPT],
      preferredScriptId: "erp-web",
      runningScriptIds: new Set(["erp-web"]),
    });

    await page.getByRole("button", { name: "Stop erp-web" }).click();

    expect(control.onStopScript).toHaveBeenCalledWith(WEB_SCRIPT);
    expect(control.onRunScript).not.toHaveBeenCalled();
  });

  it("runs an idle service rather than stopping it", async () => {
    await using control = await mountProjectScriptsControl({
      scripts: [WEB_SCRIPT],
      preferredScriptId: "erp-web",
    });

    await page.getByRole("button", { name: "Run erp-web" }).click();

    expect(control.onRunScript).toHaveBeenCalledWith(WEB_SCRIPT);
    expect(control.onStopScript).not.toHaveBeenCalled();
  });

  it("keeps the edit dialog delete action legible", async () => {
    const setupScript: ProjectScript = {
      id: "setup",
      name: "Setup",
      command: "bun install",
      icon: "configure",
      runOnWorktreeCreate: true,
    };
    await using _ = await mountProjectScriptsControl({
      scripts: [setupScript],
      preferredScriptId: "setup",
    });

    await page.getByLabelText("Script actions").click();
    await expect
      .poll(() => document.querySelector<HTMLButtonElement>('button[aria-label="Edit Setup"]'))
      .not.toBeNull();
    document.querySelector<HTMLButtonElement>('button[aria-label="Edit Setup"]')?.click();

    await expect.poll(() => document.body.textContent).toContain("Edit Action");
    const deleteButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Delete",
    );

    expect(deleteButton?.className).toContain("text-destructive");
    expect(deleteButton?.className).not.toContain("text-destructive-foreground");
  });
});

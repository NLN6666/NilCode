import type { LaunchConfiguration } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { appendPromptToDraft, buildDetectServicesPrompt } from "./detectServicesPrompt";

const PROJECT_CWD = "/home/dev/erp";

describe("buildDetectServicesPrompt", () => {
  it("names the exact file the agent must write", () => {
    const prompt = buildDetectServicesPrompt({ projectCwd: PROJECT_CWD });

    expect(prompt).toContain("/home/dev/erp/.nilcode/launch.json");
  });

  it("documents the fields the file format needs", () => {
    const prompt = buildDetectServicesPrompt({ projectCwd: PROJECT_CWD });

    for (const field of ["name", "runtimeExecutable", "runtimeArgs", "command", "port", "env"]) {
      expect(prompt).toContain(`\`${field}\``);
    }
  });

  it("forbids starting services to probe them", () => {
    const prompt = buildDetectServicesPrompt({ projectCwd: PROJECT_CWD });

    expect(prompt).toContain("Do NOT start any service");
  });

  it("tells the agent to create the file when none exists", () => {
    const prompt = buildDetectServicesPrompt({ projectCwd: PROJECT_CWD });

    expect(prompt).toContain("does not exist yet");
    expect(prompt).not.toContain("Preserve every existing entry");
  });

  it("protects hand-authored entries when the file already has some", () => {
    const existing: LaunchConfiguration[] = [
      { name: "erp-web", runtimeExecutable: "dotnet", runtimeArgs: ["run"], port: 5299 },
      { name: "erp-worker", command: "dotnet run --project src/Erp.Worker" },
    ];

    const prompt = buildDetectServicesPrompt({
      projectCwd: PROJECT_CWD,
      existingConfigurations: existing,
    });

    expect(prompt).toContain("2 configuration(s)");
    expect(prompt).toContain("`erp-web`");
    expect(prompt).toContain("`erp-worker`");
    expect(prompt).toContain("Preserve every existing entry");
    expect(prompt).not.toContain("does not exist yet");
  });
});

describe("appendPromptToDraft", () => {
  it("uses the prompt alone when the composer is empty", () => {
    expect(appendPromptToDraft("", "PROMPT")).toBe("PROMPT");
    expect(appendPromptToDraft("   \n ", "PROMPT")).toBe("PROMPT");
  });

  it("never discards what the user already typed", () => {
    expect(appendPromptToDraft("my own notes", "PROMPT")).toBe("my own notes\n\nPROMPT");
  });

  it("collapses trailing whitespace into the separator", () => {
    expect(appendPromptToDraft("notes\n\n\n", "PROMPT")).toBe("notes\n\nPROMPT");
  });
});

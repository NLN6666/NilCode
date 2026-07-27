import type { LaunchConfiguration, ProjectScript } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  launchConfigurationCommand,
  launchConfigurationsToProjectScripts,
  parseLaunchConfigFile,
  projectScriptsToLaunchConfigurations,
  quoteShellToken,
  serializeLaunchConfigFile,
} from "./launchConfig";

const ERP_LAUNCH_JSON = JSON.stringify({
  version: "0.0.1",
  configurations: [
    {
      name: "erp-web",
      runtimeExecutable: "dotnet",
      runtimeArgs: ["run", "--project", "src/Erp.Web", "--launch-profile", "http"],
      port: 5299,
    },
    {
      name: "erp-web-seed",
      runtimeExecutable: "dotnet",
      runtimeArgs: ["run", "--project", "src/Erp.Web", "--launch-profile", "seed"],
      port: 5300,
    },
  ],
});

describe("launchConfigurationCommand", () => {
  it("joins runtimeExecutable and runtimeArgs", () => {
    expect(
      launchConfigurationCommand({
        name: "erp-web",
        runtimeExecutable: "dotnet",
        runtimeArgs: ["run", "--project", "src/Erp.Web"],
      }),
    ).toBe("dotnet run --project src/Erp.Web");
  });

  it("quotes only tokens that need it", () => {
    expect(
      launchConfigurationCommand({
        name: "spaced",
        runtimeExecutable: "C:/Program Files/dotnet/dotnet.exe",
        runtimeArgs: ["run", "--msg", "hello world"],
      }),
    ).toBe('"C:/Program Files/dotnet/dotnet.exe" run --msg "hello world"');
  });

  it("prefers an explicit command over the structured form", () => {
    expect(
      launchConfigurationCommand({
        name: "override",
        command: "bun run dev",
        runtimeExecutable: "dotnet",
      }),
    ).toBe("bun run dev");
  });

  it("returns null when neither form supplies a command", () => {
    expect(launchConfigurationCommand({ name: "empty" })).toBeNull();
  });
});

describe("quoteShellToken", () => {
  it("escapes embedded quotes and expansion characters", () => {
    expect(quoteShellToken('say "hi" $USER')).toBe('"say \\"hi\\" \\$USER"');
  });

  it("renders an empty token as an explicit empty argument", () => {
    expect(quoteShellToken("")).toBe('""');
  });
});

describe("parseLaunchConfigFile", () => {
  it("parses the documented file shape", () => {
    const parsed = parseLaunchConfigFile(ERP_LAUNCH_JSON);

    expect(parsed.issues).toEqual([]);
    expect(parsed.configurations.map((entry) => entry.name)).toEqual(["erp-web", "erp-web-seed"]);
    expect(parsed.configurations[0]?.port).toBe(5299);
  });

  it("reports invalid JSON as a file-level issue", () => {
    const parsed = parseLaunchConfigFile("{ not json");

    expect(parsed.configurations).toEqual([]);
    expect(parsed.issues[0]?.index).toBeNull();
    expect(parsed.issues[0]?.message).toContain("Invalid JSON");
  });

  it("skips a malformed entry but keeps the rest of the file usable", () => {
    const parsed = parseLaunchConfigFile(
      JSON.stringify({
        configurations: [{ name: "no-command" }, { name: "ok", command: "bun run dev" }],
      }),
    );

    expect(parsed.configurations.map((entry) => entry.name)).toEqual(["ok"]);
    expect(parsed.issues).toEqual([
      { index: 0, message: '"no-command" needs either "command" or "runtimeExecutable".' },
    ]);
  });

  it("drops duplicate names so two configurations cannot claim one action", () => {
    const parsed = parseLaunchConfigFile(
      JSON.stringify({
        configurations: [
          { name: "dev", command: "bun run dev" },
          { name: "Dev", command: "bun run other" },
        ],
      }),
    );

    expect(parsed.configurations).toHaveLength(1);
    expect(parsed.issues[0]?.message).toContain("Duplicate configuration name");
  });

  it("flags a missing configurations array", () => {
    expect(parseLaunchConfigFile("{}").issues).toEqual([
      { index: null, message: 'Missing a "configurations" array.' },
    ]);
  });
});

describe("launchConfigurationsToProjectScripts", () => {
  it("derives ids, icons, and ports", () => {
    const scripts = launchConfigurationsToProjectScripts(
      parseLaunchConfigFile(ERP_LAUNCH_JSON).configurations,
    );

    expect(scripts).toEqual([
      {
        id: "erp-web",
        name: "erp-web",
        command: "dotnet run --project src/Erp.Web --launch-profile http",
        icon: "play",
        runOnWorktreeCreate: false,
        port: 5299,
      },
      {
        id: "erp-web-seed",
        name: "erp-web-seed",
        command: "dotnet run --project src/Erp.Web --launch-profile seed",
        icon: "play",
        runOnWorktreeCreate: false,
        port: 5300,
      },
    ]);
  });

  it("honours the pinned id and nilcode options", () => {
    const scripts = launchConfigurationsToProjectScripts([
      {
        name: "Install dependencies",
        command: "bun install",
        nilcode: { id: "setup", icon: "configure", runOnWorktreeCreate: true },
      },
    ]);

    expect(scripts[0]).toMatchObject({
      id: "setup",
      icon: "configure",
      runOnWorktreeCreate: true,
      port: null,
    });
  });

  it("deduplicates ids derived from colliding names", () => {
    const scripts = launchConfigurationsToProjectScripts([
      { name: "dev server", command: "a" },
      { name: "dev/server", command: "b" },
    ]);

    expect(scripts.map((script) => script.id)).toEqual(["dev-server", "dev-server-2"]);
  });
});

describe("projectScriptsToLaunchConfigurations", () => {
  const previous = parseLaunchConfigFile(ERP_LAUNCH_JSON).configurations;

  it("keeps the structured argv form when the command is unchanged", () => {
    const scripts = launchConfigurationsToProjectScripts(previous);
    const roundTripped = projectScriptsToLaunchConfigurations({ scripts, previous });

    expect(roundTripped[0]).toEqual({
      name: "erp-web",
      runtimeExecutable: "dotnet",
      runtimeArgs: ["run", "--project", "src/Erp.Web", "--launch-profile", "http"],
      port: 5299,
      nilcode: { id: "erp-web", icon: "play" },
    });
  });

  it("falls back to a flat command once the command is edited", () => {
    const scripts = launchConfigurationsToProjectScripts(previous);
    const edited = scripts[0];
    if (edited === undefined) throw new Error("expected a script to edit");
    scripts[0] = { ...edited, command: "dotnet watch" };

    expect(projectScriptsToLaunchConfigurations({ scripts, previous })[0]).toEqual({
      name: "erp-web",
      command: "dotnet watch",
      port: 5299,
      nilcode: { id: "erp-web", icon: "play" },
    });
  });

  it("preserves cwd and env carried by the previous entry", () => {
    const withExtras: LaunchConfiguration[] = [
      {
        name: "api",
        command: "bun run api",
        cwd: "services/api",
        env: { NODE_ENV: "development" },
      },
    ];
    const scripts = launchConfigurationsToProjectScripts(withExtras);

    expect(projectScriptsToLaunchConfigurations({ scripts, previous: withExtras })[0]).toEqual({
      name: "api",
      command: "bun run api",
      cwd: "services/api",
      env: { NODE_ENV: "development" },
      nilcode: { id: "api", icon: "play" },
    });
  });

  it("round-trips a brand-new action with no previous entry", () => {
    const script: ProjectScript = {
      id: "lint",
      name: "Lint",
      command: "bun lint",
      icon: "lint",
      runOnWorktreeCreate: false,
      port: null,
    };

    expect(projectScriptsToLaunchConfigurations({ scripts: [script] })[0]).toEqual({
      name: "Lint",
      command: "bun lint",
      nilcode: { id: "lint", icon: "lint" },
    });
  });
});

describe("serializeLaunchConfigFile", () => {
  it("writes a stamped, newline-terminated document", () => {
    const serialized = serializeLaunchConfigFile([{ name: "dev", command: "bun run dev" }]);

    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual({
      version: "0.0.1",
      configurations: [{ name: "dev", command: "bun run dev" }],
    });
  });

  it("survives a parse -> scripts -> configurations -> serialize round trip", () => {
    const parsed = parseLaunchConfigFile(ERP_LAUNCH_JSON);
    const scripts = launchConfigurationsToProjectScripts(parsed.configurations);
    const serialized = serializeLaunchConfigFile(
      projectScriptsToLaunchConfigurations({ scripts, previous: parsed.configurations }),
    );

    expect(
      launchConfigurationsToProjectScripts(parseLaunchConfigFile(serialized).configurations),
    ).toEqual(scripts);
  });
});

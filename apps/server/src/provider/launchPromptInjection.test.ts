import type { DaemonSnapshot, LaunchConfiguration } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { buildLaunchInstructions, LAUNCH_INSTRUCTIONS_CORE } from "./launchPromptInjection";

function daemon(overrides: Partial<DaemonSnapshot> & { name: string }): DaemonSnapshot {
  return {
    id: `daemon-${overrides.name}`,
    state: "running",
    pid: null,
    createdAt: "",
    startedAt: null,
    readyAt: null,
    exitedAt: null,
    exitCode: null,
    exitReason: null,
    restartCount: 0,
    outputBytes: 0,
    readyPending: [],
    ...overrides,
  } as DaemonSnapshot;
}

const UNLIMITED = 100_000;

describe("buildLaunchInstructions", () => {
  it("returns nothing when the budget cannot hold the core block", () => {
    expect(buildLaunchInstructions({ maxChars: 0, daemons: [], configurations: [] })).toBe("");
    expect(
      buildLaunchInstructions({
        maxChars: LAUNCH_INSTRUCTIONS_CORE.length,
        daemons: [],
        configurations: [],
      }),
    ).toBe("");
  });

  it("wraps the core block in the mode tags", () => {
    const result = buildLaunchInstructions({
      maxChars: UNLIMITED,
      daemons: [],
      configurations: [],
    });
    expect(result.startsWith("<background_service_mode>")).toBe(true);
    expect(result.endsWith("</background_service_mode>")).toBe(true);
    expect(result).toContain(LAUNCH_INSTRUCTIONS_CORE);
  });

  it("reports supervised daemons with their state and pid", () => {
    const result = buildLaunchInstructions({
      maxChars: UNLIMITED,
      daemons: [
        daemon({ name: "mc-server", state: "ready", pid: 4821 }),
        daemon({ name: "vite-dev", state: "failed", exitCode: 1 }),
      ],
      configurations: [],
    });
    expect(result).toContain("- mc-server — ready, pid 4821");
    expect(result).toContain("- vite-dev — failed, exit 1");
  });

  it("says so explicitly when nothing is supervised", () => {
    const result = buildLaunchInstructions({
      maxChars: UNLIMITED,
      daemons: [],
      configurations: [],
    });
    expect(result).toContain("Nothing is under supervision right now.");
  });

  it("lists declared configurations with their command, cwd, and port", () => {
    const configuration: LaunchConfiguration = {
      name: "mc-server",
      runtimeExecutable: "java",
      runtimeArgs: ["-Xmx4G", "-jar", "server.jar"],
      cwd: "server",
      port: 25565,
    };
    const result = buildLaunchInstructions({
      maxChars: UNLIMITED,
      daemons: [],
      configurations: [configuration],
    });
    expect(result).toContain("- mc-server — java -Xmx4G -jar server.jar (cwd: server, port 25565)");
  });

  it("omits the configuration section entirely when nothing is declared", () => {
    const result = buildLaunchInstructions({
      maxChars: UNLIMITED,
      daemons: [],
      configurations: [],
    });
    expect(result).not.toContain("launch.json");
  });

  it("drops snapshot sections that do not fit rather than truncating them", () => {
    const daemons = [daemon({ name: "mc-server", state: "ready", pid: 4821 })];
    const configurations: LaunchConfiguration[] = [{ name: "web", command: "bun dev", port: 5173 }];
    const full = buildLaunchInstructions({ maxChars: UNLIMITED, daemons, configurations });
    const withoutConfigurations = buildLaunchInstructions({
      maxChars: UNLIMITED,
      daemons,
      configurations: [],
    });

    // A budget one short of the full text must fall back to a whole section
    // boundary, never emit a partial one.
    const clipped = buildLaunchInstructions({
      maxChars: full.length - 1,
      daemons,
      configurations,
    });
    expect(clipped).toBe(withoutConfigurations);
    expect(clipped).toContain("- mc-server — ready, pid 4821");
    expect(clipped).not.toContain("bun dev");
  });

  it("replaces the full catalog with only the targeted services", () => {
    const configurations: LaunchConfiguration[] = [
      { name: "mc-server", command: "java -jar server.jar", port: 25565 },
      { name: "web", command: "bun dev", port: 5173 },
    ];
    const result = buildLaunchInstructions({
      maxChars: UNLIMITED,
      daemons: [],
      configurations,
      targets: ["mc-server"],
    });
    expect(result).toContain("The user pointed this turn at one service: mc-server.");
    expect(result).toContain("java -jar server.jar");
    expect(result).not.toContain("bun dev");
  });

  it("matches a target case-insensitively", () => {
    const result = buildLaunchInstructions({
      maxChars: UNLIMITED,
      daemons: [],
      configurations: [{ name: "mc-server", command: "java -jar server.jar" }],
      targets: ["MC-Server"],
    });
    expect(result).toContain("java -jar server.jar");
    expect(result).not.toContain("Not declared");
  });

  it("reports targets that no configuration declares instead of dropping them", () => {
    const result = buildLaunchInstructions({
      maxChars: UNLIMITED,
      daemons: [],
      configurations: [{ name: "web", command: "bun dev" }],
      targets: ["mc-server", "web"],
    });
    expect(result).toContain("The user pointed this turn at these services: mc-server, web.");
    expect(result).toContain("bun dev");
    expect(result).toContain("Not declared in `.nilcode/launch.json`: mc-server.");
  });

  it("still names the target when the project declares nothing at all", () => {
    const result = buildLaunchInstructions({
      maxChars: UNLIMITED,
      daemons: [],
      configurations: [],
      targets: ["mc-server"],
    });
    expect(result).toContain("The user pointed this turn at one service: mc-server.");
    expect(result).toContain("Not declared in `.nilcode/launch.json`: mc-server.");
  });

  it("never exceeds the budget it was given", () => {
    const daemons = [
      daemon({ name: "mc-server", state: "ready", pid: 4821 }),
      daemon({ name: "vite-dev", state: "running", pid: 22 }),
    ];
    const configurations: LaunchConfiguration[] = [
      { name: "web", command: "bun dev", port: 5173 },
      { name: "api", command: "bun run api" },
    ];
    const full = buildLaunchInstructions({ maxChars: UNLIMITED, daemons, configurations });
    for (let budget = 0; budget <= full.length + 10; budget += 7) {
      expect(
        buildLaunchInstructions({ maxChars: budget, daemons, configurations }).length,
      ).toBeLessThanOrEqual(budget);
    }
  });
});

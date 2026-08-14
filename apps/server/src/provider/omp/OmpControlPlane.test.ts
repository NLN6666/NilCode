import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildOmpControlPlanePlan,
  prepareOmpControlPlane,
  waitForOmpTurnSettle,
} from "./OmpControlPlane";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OmpControlPlane overlay policy", () => {
  it("generates deterministic minimal YAML without copying secrets", () => {
    const input = {
      overlayPath: "C:/Users/test/.omp/synara/acp-provider.yml",
      globalConfigText: [
        "memory:",
        "  backend: hindsight",
        "hindsight:",
        "  apiUrl: https://memory.example",
        "  apiToken: must-not-leak",
        "modelRoles:",
        "  advisor: anthropic/claude-fable-5:medium",
        "providerSecrets:",
        "  token: also-must-not-leak",
      ].join("\n"),
      env: {},
    } as const;

    const first = buildOmpControlPlanePlan(input);
    const second = buildOmpControlPlanePlan(input);

    expect(second).toEqual(first);
    expect(first.overlayContent).toBe(
      [
        "launch:",
        "  enabled: true",
        "advisor:",
        "  enabled: true",
        "autolearn:",
        "  enabled: true",
        "  autoContinue: true",
        "",
      ].join("\n"),
    );
    expect(first.overlayContent).not.toContain("must-not-leak");
    expect(first.policy.memory).toMatchObject({
      backend: "hindsight",
      source: "user-config",
    });
    expect(first.policy.advisor).toMatchObject({
      state: "configured",
      modelRole: "anthropic/claude-fable-5:medium",
    });
  });

  it("atomically writes the fixed overlay and leaves global config untouched", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "synara-omp-control-"));
    tempRoots.push(homeDir);
    const agentDir = join(homeDir, ".omp", "agent");
    const globalConfigPath = join(agentDir, "config.yml");
    await mkdir(agentDir, { recursive: true });
    const globalContents = [
      "memory:",
      "  backend: off",
      "modelRoles:",
      "  default: openai/gpt-5.6-sol",
      "secrets:",
      "  apiKey: keep-global-only",
      "",
    ].join("\n");
    await writeFile(globalConfigPath, globalContents, "utf8");
    const before = await stat(globalConfigPath);

    const first = await prepareOmpControlPlane({ homeDir, env: {} });
    const second = await prepareOmpControlPlane({ homeDir, env: {} });

    expect(first.overlayWritten).toBe(true);
    expect(second.overlayWritten).toBe(false);
    expect(first.overlayPath).toBe(join(homeDir, ".omp", "synara", "acp-provider.yml"));
    expect(await readFile(first.overlayPath, "utf8")).toBe(first.overlayContent);
    expect(first.overlayContent).toContain("memory:\n  backend: local\n");
    expect(first.overlayContent).not.toContain("keep-global-only");
    expect(await readFile(globalConfigPath, "utf8")).toBe(globalContents);
    const after = await stat(globalConfigPath);
    expect({ size: after.size, mtimeMs: after.mtimeMs }).toEqual({
      size: before.size,
      mtimeMs: before.mtimeMs,
    });
    const overlayStat = await stat(first.overlayPath);
    if (process.platform !== "win32") expect(overlayStat.mode & 0o777).toBe(0o600);
  });

  it.each([
    ["missing", undefined, {}, "local", "synara-fallback", true],
    ["off", "off", {}, "local", "synara-fallback", true],
    ["local", "local", {}, "local", "user-config", false],
    ["mnemopi", "mnemopi", {}, "mnemopi", "user-config", false],
    [
      "hindsight with environment URL",
      "hindsight",
      { HINDSIGHT_API_URL: "https://memory.example" },
      "hindsight",
      "user-config",
      false,
    ],
    ["hindsight without URL", "hindsight", {}, "local", "synara-fallback", true],
  ] as const)(
    "resolves %s memory configuration without inventing remote credentials",
    (_label, configured, env, backend, source, writesFallback) => {
      const globalConfigText = configured ? `memory:\n  backend: ${configured}\n` : undefined;
      const plan = buildOmpControlPlanePlan({ overlayPath: "C:/overlay.yml", globalConfigText, env });

      expect(plan.policy.memory).toMatchObject({ backend, source });
      expect(plan.overlayContent.includes("memory:\n  backend: local\n")).toBe(writesFallback);
    },
  );

  it("degrades Advisor when its model role is missing or invalid", () => {
    for (const globalConfigText of [undefined, "modelRoles:\n  advisor: ''\n", "modelRoles:\n  advisor: |\n"] as const) {
      const plan = buildOmpControlPlanePlan({
        overlayPath: "C:/overlay.yml",
        globalConfigText,
        env: {},
      });

      expect(plan.policy.advisor.state).toBe("degraded");
      expect(plan.policy.advisor.warning).toContain("modelRoles.advisor");
      expect(plan.policy.advisor).not.toHaveProperty("modelRole");
    }
  });
});

describe("OmpControlPlane bounded turn settle", () => {
  function virtualClock(onSleep?: (now: number) => void) {
    let now = 0;
    return {
      now: () => now,
      sleep: async (milliseconds: number) => {
        now += milliseconds;
        onSleep?.(now);
      },
    };
  }

  it("waits for the queued snapshot and a quiet window", async () => {
    let processed = 0;
    let activityVersion = 0;
    const clock = virtualClock((now) => {
      if (now === 20) {
        processed = 2;
        activityVersion += 1;
      }
      if (now === 40) activityVersion += 1;
    });

    const result = await waitForOmpTurnSettle({
      targetEnqueued: 2,
      getSnapshot: () => ({ processed, activityVersion, aborted: false, processExited: false }),
      quietWindowMs: 30,
      maxWaitMs: 100,
      pollMs: 10,
      ...clock,
    });

    expect(result).toEqual({ outcome: "settled", waitedMs: 70, queueDrained: true });
  });

  it.each([
    ["timeout", { processed: 0, activityVersion: 0, aborted: false, processExited: false }, "timed-out"],
    ["abort", { processed: 0, activityVersion: 0, aborted: true, processExited: false }, "aborted"],
    ["process crash", { processed: 0, activityVersion: 0, aborted: false, processExited: true }, "process-exited"],
  ] as const)("reports bounded %s without claiming Auto-Learn capture", async (_label, snapshot, outcome) => {
    const clock = virtualClock();
    const result = await waitForOmpTurnSettle({
      targetEnqueued: 1,
      getSnapshot: () => snapshot,
      quietWindowMs: 20,
      maxWaitMs: 50,
      pollMs: 10,
      ...clock,
    });

    expect(result.outcome).toBe(outcome);
    expect(result).not.toHaveProperty("captureComplete");
    expect(result.waitedMs).toBe(outcome === "timed-out" ? 50 : 0);
  });
});

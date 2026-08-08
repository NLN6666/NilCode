// FILE: windowsProcessEffect.test.ts
// Purpose: Verifies Effect forwards verbatim Windows command lines to Node spawn.
// Layer: Server process integration test

import * as NodeServices from "@effect/platform-node/NodeServices";
import { prepareWindowsSafeProcess } from "@synara/shared/windowsProcess";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import * as Path from "node:path";

import { Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { expect, it } from "vitest";

// Upstream's spawner enumerates POSIX spawn options and models the Windows-only
// ones nowhere, so we patch them in (patches/@effect%2Fplatform-node-shared@*).
// `windowsHide` is the load-bearing one: when the parent process has no console
// of its own - the packaged desktop app - every child that omits it pops a
// visible cmd.exe window. That regressed once already because the patch added
// `windowsVerbatimArguments` alone, so guard the field here rather than trusting
// the next dependency bump to carry it along.
it("keeps the patched Effect spawner forwarding windowsHide to Node spawn", () => {
  // Resolved through platform-node because the shared package is a transitive
  // dependency, not one this workspace declares.
  const platformNodePath = createRequire(import.meta.url).resolve(
    "@effect/platform-node/package.json",
  );
  const packagePath = createRequire(platformNodePath).resolve(
    "@effect/platform-node-shared/package.json",
  );
  const spawner = readFileSync(
    Path.join(Path.dirname(packagePath), "dist", "NodeChildProcessSpawner.js"),
    "utf8",
  );

  expect(spawner).toContain("windowsHide: cmd.options.windowsHide ?? true");
  // killProcessGroup shells out to taskkill through `exec`, which is a second,
  // separate omission in the same file - it fired once per finished command.
  const killIndex = spawner.indexOf("taskkill");
  expect(killIndex).toBeGreaterThan(-1);
  expect(spawner.slice(killIndex, killIndex + 120)).toContain("windowsHide: true");
});

it.runIf(process.platform === "win32")(
  "forwards encoded Codex arguments verbatim through the Effect Node spawner",
  async () => {
    const root = mkdtempSync(Path.join(tmpdir(), "synara-effect-windows-process-"));
    const commandDir = Path.join(root, "tools(x86)");
    const scriptPath = Path.join(commandDir, "capture.mjs");
    const commandPath = Path.join(commandDir, "codex.cmd");
    const outputPath = Path.join(root, "args.json");
    const expectedArgs = [
      "exec",
      "--config",
      'approval_policy="never"',
      "--config",
      'model_reasoning_effort="high"',
    ];

    try {
      mkdirSync(commandDir);
      writeFileSync(
        scriptPath,
        [
          'import { writeFileSync } from "node:fs";',
          "writeFileSync(process.env.SYNARA_CAPTURE_PATH, JSON.stringify(process.argv.slice(2)));",
          "",
        ].join("\n"),
      );
      writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "%~dp0capture.mjs" %*\r\n`);

      const env = { ...process.env, SYNARA_CAPTURE_PATH: outputPath };
      const prepared = prepareWindowsSafeProcess(commandPath, expectedArgs, {
        platform: "win32",
        env,
      });
      const options = {
        env,
        shell: prepared.shell,
        ...(prepared.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      };

      const exitCode = await Effect.runPromise(
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const child = yield* spawner.spawn(
            ChildProcess.make(prepared.command, prepared.args, options),
          );
          return yield* child.exitCode;
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
      );

      expect(Number(exitCode)).toBe(0);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(expectedArgs);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  },
);

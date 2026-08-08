// Runs one advisor prompt as a single short-lived CLI invocation.
//
// The advisor used to be a shadow provider session - a second long-lived
// runtime keyed by "advisor:<threadId>". That inherited the whole session
// machinery (lifecycle generations, resume cursors, reconciliation, a
// consecutive-failure kill switch) for something that only ever needs one
// prompt answered once, and each of those mechanisms produced its own failure:
// a revived resume cursor pointing at a conversation that never existed, a
// console window per spawn on Windows, an authentication path distinct from
// the one the main session uses.
//
// oh-my-pi runs its advisors in-process, reusing the primary agent's client
// and auth and never spawning anything. Synara orchestrates CLIs rather than
// owning a model client, so the closest equivalent is this: no session, one
// process, one answer. What it keeps from that design is the important part -
// the advisor borrows the same binaries, environment and credentials the main
// session already uses, instead of standing up a parallel world of its own.

import { randomUUID } from "node:crypto";

import type { AdvisorModelSelection } from "@synara/contracts";
import { prepareWindowsSafeProcess } from "@synara/shared/windowsProcess";
import { Effect, FileSystem, Layer, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { buildCodexProcessEnv } from "../../codexProcessEnv.ts";
import { ServerConfig } from "../../config.ts";
import { buildClaudeProcessEnv } from "../../provider/claudeProcessEnv.ts";
import {
  AdvisorInference,
  type AdvisorInferenceInput,
  type AdvisorInferenceShape,
} from "../Services/AdvisorInference.ts";

/** A silent advisor is the common case, but a stalled one must not stall us. */
export const ADVISOR_INFERENCE_TIMEOUT_MS = 90_000;

/** How much of a failed invocation's stderr reaches the log. */
const STDERR_PREVIEW_CHARS = 300;

function readEffort(selection: AdvisorModelSelection): string | undefined {
  const effort = (selection.options as { readonly effort?: unknown } | undefined)?.effort;
  return typeof effort === "string" && effort.trim().length > 0 ? effort.trim() : undefined;
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* Effect.service(ServerConfig);

  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const collect = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, never> =>
    Effect.gen(function* () {
      let text = "";
      yield* Stream.runForEach(stream, (chunk) =>
        Effect.sync(() => {
          text += Buffer.from(chunk).toString("utf8");
        }),
      ).pipe(Effect.catchCause(() => Effect.void));
      return text;
    });

  const safeRemove = (filePath: string) =>
    fileSystem.remove(filePath).pipe(Effect.catchCause(() => Effect.void));

  /**
   * Codex writes prose and progress to stdout, so the reply is collected from
   * `--output-last-message` instead. Claude with `-p` prints only the reply.
   */
  const resolveInvocation = (input: AdvisorInferenceInput) =>
    Effect.gen(function* () {
      const effort = readEffort(input.modelSelection);
      if (input.modelSelection.provider === "claudeAgent") {
        return {
          binaryPath: input.providerOptions?.claudeAgent?.binaryPath ?? "claude",
          args: [
            "-p",
            "--model",
            input.modelSelection.model,
            ...(effort === undefined ? [] : ["--effort", effort]),
          ],
          env: buildClaudeProcessEnv({ homeDir: serverConfig.homeDir }),
          outputPath: null,
        } as const;
      }
      const outputPath = path.join(tempDir, `synara-advisor-${process.pid}-${randomUUID()}.txt`);
      const codexHome = input.providerOptions?.codex?.homePath;
      return {
        binaryPath: input.providerOptions?.codex?.binaryPath ?? "codex",
        args: [
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          // The advisor advises; it never acts. A stray tool call must fail
          // immediately rather than wait on an approval nobody will answer.
          "--config",
          'approval_policy="never"',
          "-s",
          "read-only",
          "--model",
          input.modelSelection.model,
          ...(effort === undefined ? [] : ["--config", `model_reasoning_effort="${effort}"`]),
          "--output-last-message",
          outputPath,
          "-",
        ],
        env: yield* Effect.promise(() =>
          buildCodexProcessEnv(codexHome === undefined ? {} : { homePath: codexHome }),
        ),
        outputPath,
      } as const;
    });

  const run: AdvisorInferenceShape["run"] = (input) =>
    Effect.gen(function* () {
      const invocation = yield* resolveInvocation(input);
      const prepared = prepareWindowsSafeProcess(invocation.binaryPath, [...invocation.args], {
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        env: invocation.env,
      });
      const command = ChildProcess.make(prepared.command, prepared.args, {
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        env: invocation.env,
        shell: prepared.shell,
        ...(prepared.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
        stdin: { stream: Stream.make(new TextEncoder().encode(input.prompt)) },
      });

      const child = yield* commandSpawner.spawn(command).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("advisor inference failed to spawn", {
            binaryPath: invocation.binaryPath,
            cause,
          }).pipe(Effect.as(null)),
        ),
      );
      if (child === null) {
        return null;
      }

      const settled = yield* Effect.all([
        collect(child.stdout),
        collect(child.stderr),
        child.exitCode.pipe(
          Effect.map(Number),
          Effect.catchCause(() => Effect.succeed(-1)),
        ),
      ]).pipe(Effect.timeoutOption(ADVISOR_INFERENCE_TIMEOUT_MS));

      if (settled._tag === "None") {
        yield* Effect.logWarning("advisor inference timed out", {
          provider: input.modelSelection.provider,
          timeoutMs: ADVISOR_INFERENCE_TIMEOUT_MS,
        });
        if (invocation.outputPath !== null) {
          yield* safeRemove(invocation.outputPath);
        }
        return null;
      }

      const [stdout, stderr, exitCode] = settled.value;
      const reply =
        invocation.outputPath === null
          ? stdout
          : yield* fileSystem
              .readFileString(invocation.outputPath)
              .pipe(Effect.catchCause(() => Effect.succeed("")));
      if (invocation.outputPath !== null) {
        yield* safeRemove(invocation.outputPath);
      }

      if (exitCode !== 0) {
        yield* Effect.logWarning("advisor inference exited non-zero", {
          provider: input.modelSelection.provider,
          binaryPath: invocation.binaryPath,
          exitCode,
          stderr: stderr.slice(0, STDERR_PREVIEW_CHARS),
        });
        return null;
      }

      const trimmed = reply.trim();
      if (trimmed.length === 0) {
        yield* Effect.logWarning("advisor inference returned nothing", {
          provider: input.modelSelection.provider,
          stderr: stderr.slice(0, STDERR_PREVIEW_CHARS),
        });
        return null;
      }
      return trimmed;
      // Scoped so the child process is reaped with the evaluation that spawned
      // it, however that evaluation ends.
    }).pipe(Effect.scoped);

  return { run } satisfies AdvisorInferenceShape;
});

export const AdvisorInferenceLive = Layer.effect(AdvisorInference, make);

// FILE: CheckpointStore.test.ts
// Purpose: Verifies filesystem checkpoint store behavior around expensive Git capture work.
// Layer: Checkpointing tests.
// Exports: Vitest coverage for CheckpointStoreLive.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  chmodSync,
  renameSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Fiber, FileSystem, Layer, ManagedRuntime, Option } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckpointStoreLive } from "./CheckpointStore.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { GitCommandError } from "../../git/Errors.ts";
import { ServerConfig } from "../../config.ts";
import { CheckpointRef, ThreadId, TurnId } from "@synara/contracts";
import { checkpointRefForThreadTurn, checkpointRefForThreadTurnLive } from "../Utils.ts";

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition");
}

describe("CheckpointStoreLive", () => {
  let runtime: ManagedRuntime.ManagedRuntime<CheckpointStore, unknown> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("deduplicates concurrent captures for the same checkpoint ref", async () => {
    let releaseAdd: (() => void) | undefined;
    const addGate = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --git-path synara-checkpoint-index") {
        return Effect.succeed({
          code: 0,
          stdout: "/repo/.git/synara-checkpoint-index\n",
          stderr: "",
        });
      }
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: "/repo/.git/index\n", stderr: "" });
      }
      if (args === "rev-parse --verify HEAD") {
        return Effect.succeed({ code: 1, stdout: "", stderr: "" });
      }
      if (args === "add -A -- .") {
        return Effect.promise(() => addGate).pipe(Effect.as({ code: 0, stdout: "", stderr: "" }));
      }
      if (args === "write-tree") {
        return Effect.succeed({ code: 0, stdout: "tree-oid\n", stderr: "" });
      }
      if (args.startsWith("commit-tree ")) {
        return Effect.succeed({ code: 0, stdout: "commit-oid\n", stderr: "" });
      }
      if (args.startsWith("update-ref ")) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        const input = {
          cwd: "/repo",
          checkpointRef: CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/message"),
        };

        const first = yield* store.captureCheckpoint(input).pipe(Effect.forkChild);
        yield* Effect.promise(() =>
          waitFor(() => execute.mock.calls.some(([call]) => call.args.join(" ") === "add -A -- .")),
        );
        const second = yield* store.captureCheckpoint(input).pipe(Effect.forkChild);
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)));

        expect(
          execute.mock.calls.filter(([call]) => call.args.join(" ") === "add -A -- ."),
        ).toHaveLength(1);

        releaseAdd?.();
        yield* Fiber.join(first);
        yield* Fiber.join(second);
      }),
    );
  });

  it("seeds a durable checkpoint index once and reuses it on later captures", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "synara-checkpoint-index-test-"));
    const workingIndexPath = join(tempDir, "index");
    const checkpointIndexPath = join(tempDir, "synara-checkpoint-index");
    writeFileSync(workingIndexPath, "working-index-stat-cache");
    const workingIndexTime = new Date("2020-01-02T03:04:05.000Z");
    utimesSync(workingIndexPath, workingIndexTime, workingIndexTime);
    const seenByAdd: Array<{ path: string; contents: string; mtimeMs: number }> = [];

    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --git-path synara-checkpoint-index") {
        return Effect.succeed({ code: 0, stdout: `${checkpointIndexPath}\n`, stderr: "" });
      }
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: `${workingIndexPath}\n`, stderr: "" });
      }
      if (args === "add -A -- .") {
        const capturePath = input.env?.GIT_INDEX_FILE ?? "";
        seenByAdd.push({
          path: capturePath,
          contents: readFileSync(capturePath, "utf8"),
          mtimeMs: statSync(capturePath).mtimeMs,
        });
        // Stand in for Git rewriting the index with a fresh stat cache.
        writeFileSync(capturePath, `refreshed-stat-cache-${seenByAdd.length}`);
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "write-tree") {
        return Effect.succeed({ code: 0, stdout: "tree-oid\n", stderr: "" });
      }
      if (args.startsWith("commit-tree ")) {
        return Effect.succeed({ code: 0, stdout: "commit-oid\n", stderr: "" });
      }
      if (args.startsWith("update-ref ")) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;
          yield* store.captureCheckpoint({
            cwd: tempDir,
            checkpointRef: CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/first"),
          });
          yield* store.captureCheckpoint({
            cwd: tempDir,
            checkpointRef: CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/second"),
          });
        }),
      );

      expect(seenByAdd).toHaveLength(2);
      // First capture seeds from the working index, preserving Git's stat cache
      // and the timestamp that decides which entries are racily clean.
      expect(seenByAdd[0]?.path).toBe(checkpointIndexPath);
      expect(seenByAdd[0]?.contents).toBe("working-index-stat-cache");
      expect(seenByAdd[0]?.mtimeMs).toBe(workingIndexTime.getTime());
      // The second capture must reuse what the first one left behind rather
      // than re-seeding, otherwise every turn re-hashes the whole worktree.
      expect(seenByAdd[1]?.path).toBe(checkpointIndexPath);
      expect(seenByAdd[1]?.contents).toBe("refreshed-stat-cache-1");
      // The durable index makes the throwaway-copy compensation unnecessary.
      expect(
        execute.mock.calls.some(
          ([call]) => call.args.join(" ") === "update-index --really-refresh",
        ),
      ).toBe(false);
      expect(
        execute.mock.calls.some(([call]) => call.args.join(" ") === "rev-parse --verify HEAD"),
      ).toBe(false);
      // The git-path probe is memoized per repository, not repeated per turn.
      expect(
        execute.mock.calls.filter(
          ([call]) => call.args.join(" ") === "rev-parse --git-path synara-checkpoint-index",
        ),
      ).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("discards the durable checkpoint index when a capture fails", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "synara-checkpoint-index-fail-"));
    const workingIndexPath = join(tempDir, "index");
    const checkpointIndexPath = join(tempDir, "synara-checkpoint-index");
    writeFileSync(workingIndexPath, "working-index-stat-cache");

    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --git-path synara-checkpoint-index") {
        return Effect.succeed({ code: 0, stdout: `${checkpointIndexPath}\n`, stderr: "" });
      }
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: `${workingIndexPath}\n`, stderr: "" });
      }
      if (args === "add -A -- .") {
        return Effect.fail(
          new GitCommandError({
            operation: "CheckpointStore.captureCheckpoint",
            command: "git add -A -- .",
            cwd: tempDir,
            detail: "index is locked",
          }),
        );
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;
          const result = yield* store
            .captureCheckpoint({
              cwd: tempDir,
              checkpointRef: CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/fails"),
            })
            .pipe(Effect.result);
          expect(result._tag).toBe("Failure");
        }),
      );

      expect(existsSync(checkpointIndexPath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("clears in-flight capture state when the owner is interrupted", async () => {
    let addCalls = 0;
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --git-path synara-checkpoint-index") {
        return Effect.succeed({
          code: 0,
          stdout: "/repo/.git/synara-checkpoint-index\n",
          stderr: "",
        });
      }
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: "/repo/.git/index\n", stderr: "" });
      }
      if (args === "rev-parse --verify HEAD") {
        return Effect.succeed({ code: 1, stdout: "", stderr: "" });
      }
      if (args === "add -A -- .") {
        addCalls += 1;
        if (addCalls === 1) {
          return Effect.never;
        }
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "write-tree") {
        return Effect.succeed({ code: 0, stdout: "tree-oid\n", stderr: "" });
      }
      if (args.startsWith("commit-tree ")) {
        return Effect.succeed({ code: 0, stdout: "commit-oid\n", stderr: "" });
      }
      if (args.startsWith("update-ref ")) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        const input = {
          cwd: "/repo",
          checkpointRef: CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/message"),
        };

        const first = yield* store.captureCheckpoint(input).pipe(Effect.forkChild);
        yield* Effect.promise(() => waitFor(() => addCalls === 1));
        const waiter = yield* store.captureCheckpoint(input).pipe(
          Effect.map(() => "completed" as const),
          Effect.catch((error) => Effect.succeed(error._tag)),
          Effect.forkChild,
        );
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)));

        yield* Fiber.interrupt(first);
        // The owner's interruption must surface to waiters as a typed store
        // error, not replay as the waiter's own fiber being interrupted.
        const waiterResult = yield* Fiber.join(waiter);
        expect(waiterResult).toBe("CheckpointInvariantError");

        const thirdResult = yield* store
          .captureCheckpoint(input)
          .pipe(Effect.timeoutOption("100 millis"));
        expect(Option.isSome(thirdResult)).toBe(true);
        expect(addCalls).toBe(2);
      }),
    );
  });

  it("skips the capture when skipIfExists is set and the ref already exists", async () => {
    const existingRef = "refs/synara-checkpoints/thread/existing";
    const missingRef = "refs/synara-checkpoints/thread/missing";
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === `for-each-ref --format=%(refname)%09%(objectname) ${existingRef}`) {
        return Effect.succeed({
          code: 0,
          stdout: `${existingRef}\texisting-commit\n`,
          stderr: "",
        });
      }
      if (args === `for-each-ref --format=%(refname)%09%(objectname) ${missingRef}`) {
        // A missing ref is an empty result, NOT a non-zero exit.
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "rev-parse --git-path synara-checkpoint-index") {
        return Effect.succeed({
          code: 0,
          stdout: "/repo/.git/synara-checkpoint-index\n",
          stderr: "",
        });
      }
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: "/repo/.git/index\n", stderr: "" });
      }
      if (args === "rev-parse --verify HEAD") {
        return Effect.succeed({ code: 1, stdout: "", stderr: "" });
      }
      if (args === "add -A -- .") {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "write-tree") {
        return Effect.succeed({ code: 0, stdout: "tree-oid\n", stderr: "" });
      }
      if (args.startsWith("commit-tree ")) {
        return Effect.succeed({ code: 0, stdout: "commit-oid\n", stderr: "" });
      }
      if (args.startsWith("update-ref ")) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        const captureArgs = (args: string) =>
          execute.mock.calls.filter(([call]) => call.args.join(" ") === args);

        yield* store.captureCheckpoint({
          cwd: "/repo",
          checkpointRef: CheckpointRef.makeUnsafe(existingRef),
          skipIfExists: true,
        });
        expect(captureArgs("add -A -- .")).toHaveLength(0);

        yield* store.captureCheckpoint({
          cwd: "/repo",
          checkpointRef: CheckpointRef.makeUnsafe(missingRef),
          skipIfExists: true,
        });
        expect(captureArgs("add -A -- .")).toHaveLength(1);
        expect(captureArgs(`update-ref ${missingRef} commit-oid`)).toHaveLength(1);
      }),
    );
  });

  it("keeps a/ and b/ prefixes on turn diffs and file undo under diff.noprefix", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "synara-checkpoint-prefix-test-"));
    const git = (args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
    try {
      git(["init", "--initial-branch=main"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test User"]);
      git(["config", "core.autocrlf", "false"]);
      git(["config", "diff.noprefix", "true"]);
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, "src", "file.ts"), "before\n");
      git(["add", "."]);
      git(["commit", "-m", "Initial"]);
      runtime = ManagedRuntime.make(
        CheckpointStoreLive.pipe(
          Layer.provide(
            GitCoreLive.pipe(
              Layer.provide(ServerConfig.layerTest(cwd, { prefix: "synara-checkpoint-prefix-" })),
            ),
          ),
          Layer.provide(NodeServices.layer),
        ),
      );
      const fromRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/turn/start");
      const toRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/turn/end");

      const diff = await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;
          yield* store.captureCheckpoint({ cwd, checkpointRef: fromRef });
          writeFileSync(join(cwd, "src", "file.ts"), "after\n");
          yield* store.captureCheckpoint({ cwd, checkpointRef: toRef });
          const range = { cwd, fromCheckpointRef: fromRef, toCheckpointRef: toRef };
          const diff = yield* store.diffCheckpoints({ ...range, ignoreWhitespace: false });
          yield* store.reverseCheckpointDiff(range);
          return diff;
        }),
      );

      expect(diff).toContain("diff --git a/src/file.ts b/src/file.ts");
      expect(readFileSync(join(cwd, "src", "file.ts"), "utf8")).toBe("before\n");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("restores the worktree patch when resetting the index fails during file undo", async () => {
    const fromRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/turn/start");
    const toRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/turn/end");
    const commands: string[] = [];
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      commands.push(args);
      if (args === `for-each-ref --format=%(refname)%09%(objectname) ${fromRef}`) {
        return Effect.succeed({ code: 0, stdout: `${fromRef}\tfrom-oid\n`, stderr: "" });
      }
      if (args === `for-each-ref --format=%(refname)%09%(objectname) ${toRef}`) {
        return Effect.succeed({ code: 0, stdout: `${toRef}\tto-oid\n`, stderr: "" });
      }
      if (args.startsWith("diff --patch --binary --full-index")) {
        return Effect.succeed({ code: 0, stdout: "turn patch", stderr: "" });
      }
      if (args === "diff --name-only --no-renames -z from-oid to-oid") {
        return Effect.succeed({ code: 0, stdout: "src/file.ts\0", stderr: "" });
      }
      if (input.args[0] === "apply" && input.args[1] === "--reverse") {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "reset --quiet from-oid -- src/file.ts") {
        return Effect.fail(
          new GitCommandError({
            operation: input.operation,
            command: args,
            cwd: input.cwd,
            detail: "reset failed",
          }),
        );
      }
      if (input.args[0] === "apply" && input.args[1] === "--whitespace=nowarn") {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        return yield* store
          .reverseCheckpointDiff({
            cwd: "/repo",
            fromCheckpointRef: fromRef,
            toCheckpointRef: toRef,
          })
          .pipe(
            Effect.map(() => "success" as const),
            Effect.catch((error) => Effect.succeed(error._tag)),
          );
      }),
    );

    expect(result).toBe("GitCommandError");
    expect(commands.filter((command) => command.startsWith("apply "))).toHaveLength(2);
    expect(commands.at(-1)).toMatch(/^apply --whitespace=nowarn -- /);
  });

  it("reconstructs provider patches from the captured baseline in a private index", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "synara-raw-patch-"));
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      git(["init", "--initial-branch=main"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test User"]);
      writeFileSync(join(cwd, "internal.txt"), "hello world\n");
      writeFileSync(join(cwd, "edges.txt"), "\t leading trailing\n");
      writeFileSync(join(cwd, "crlf.txt"), "windows\r\n");
      writeFileSync(join(cwd, "real.txt"), "before\n");
      writeFileSync(join(cwd, "old name.txt"), "renamed content\n");
      writeFileSync(join(cwd, "delete.txt"), "delete me\n");
      writeFileSync(join(cwd, "no-newline.txt"), "before");
      writeFileSync(join(cwd, "binary.dat"), Buffer.from([0, 1, 2]));
      git(["add", "."]);
      git(["commit", "-m", "Captured baseline"]);
      const baseline = CheckpointRef.makeUnsafe("refs/synara/checkpoints/raw/turn-start/exact");
      git(["update-ref", baseline, "HEAD"]);
      writeFileSync(join(cwd, "internal.txt"), "hello  world\n");
      writeFileSync(join(cwd, "edges.txt"), " leading trailing\t \n");
      writeFileSync(join(cwd, "crlf.txt"), "windows \t\r\n");
      writeFileSync(join(cwd, "real.txt"), "after\n");
      writeFileSync(join(cwd, "no-newline.txt"), "after");
      renameSync(join(cwd, "old name.txt"), join(cwd, "new name.txt"));
      chmodSync(join(cwd, "new name.txt"), 0o755);
      rmSync(join(cwd, "delete.txt"));
      writeFileSync(join(cwd, "unicode-π.txt"), "added\n");
      writeFileSync(join(cwd, "binary.dat"), Buffer.from([0, 3, 2]));
      git(["add", "."]);
      const providerPatch = git(["diff", "--cached", "--binary", "--full-index", baseline]);
      // Real staged/working content can diverge after the selected provider event.
      writeFileSync(join(cwd, "real.txt"), "another session\n");
      writeFileSync(join(cwd, "peer.txt"), "unrelated staged work\n");
      git(["add", "peer.txt", "real.txt"]);
      const index = readFileSync(join(cwd, ".git", "index"));
      const refs = git(["for-each-ref", "--format=%(refname)"]);
      runtime = ManagedRuntime.make(
        CheckpointStoreLive.pipe(
          Layer.provide(
            GitCoreLive.pipe(
              Layer.provide(ServerConfig.layerTest(cwd, { prefix: "synara-raw-store-" })),
            ),
          ),
          Layer.provide(NodeServices.layer),
        ),
      );
      const store = await runtime.runPromise(Effect.service(CheckpointStore));
      for (const ignoreWhitespace of [false, true]) {
        const patch = await runtime.runPromise(
          store.diffCheckpoints({
            cwd,
            fromCheckpointRef: baseline,
            toCheckpointRef: CheckpointRef.makeUnsafe("provider-diff:raw"),
            providerPatch,
            ignoreWhitespace,
          }),
        );
        expect(patch).toContain("+after");
        expect(patch).toContain("delete.txt");
        expect(patch).toContain("rename from old name.txt");
        expect(patch).toContain("rename to new name.txt");
        expect(patch).toContain("new mode 100755");
        expect(patch).toContain("No newline at end of file");
        expect(patch).toContain("binary.dat");
        for (const file of ["internal.txt", "edges.txt", "crlf.txt"])
          expect(patch.includes(file)).toBe(!ignoreWhitespace);
        expect(patch).not.toContain("another session");
        expect(patch).not.toContain("peer.txt");
      }
      await expect(
        runtime.runPromise(
          store.diffCheckpoints({
            cwd,
            fromCheckpointRef: baseline,
            toCheckpointRef: CheckpointRef.makeUnsafe("provider-diff:bad"),
            providerPatch: "not a patch",
            ignoreWhitespace: false,
          }),
        ),
      ).rejects.toThrow();
      await expect(
        runtime.runPromise(
          store.diffCheckpoints({
            cwd,
            fromCheckpointRef: baseline,
            toCheckpointRef: CheckpointRef.makeUnsafe("provider-diff:mismatch"),
            providerPatch: providerPatch.replace("-before", "-wrong baseline"),
            ignoreWhitespace: false,
          }),
        ),
      ).rejects.toThrow();
      expect(readFileSync(join(cwd, ".git", "index"))).toEqual(index);
      expect(readFileSync(join(cwd, "real.txt"), "utf8")).toBe("another session\n");
      expect(git(["for-each-ref", "--format=%(refname)"])).toBe(refs);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("purges published and crash-orphaned live refs without touching another thread or final checkpoints", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "synara-live-ref-cleanup-"));
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    try {
      git(["init", "--initial-branch=main"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test User"]);
      writeFileSync(join(cwd, "file.txt"), "before\n");
      git(["add", "."]);
      git(["commit", "-m", "Initial"]);
      const threadId = ThreadId.makeUnsafe("owned-thread");
      const turnId = TurnId.makeUnsafe("owned-turn");
      const ownRefs = ["published", "crashed-before-publish"].map((revision) =>
        checkpointRefForThreadTurnLive(threadId, turnId, revision),
      );
      const keptRefs = [
        checkpointRefForThreadTurn(threadId, 1),
        checkpointRefForThreadTurnLive(ThreadId.makeUnsafe("peer-thread"), turnId, "peer"),
      ];
      for (const ref of [...ownRefs, ...keptRefs]) git(["update-ref", ref, "HEAD"]);
      writeFileSync(join(cwd, "file.txt"), "working changes\n");
      const index = readFileSync(join(cwd, ".git", "index"));
      // Linux/macOS Git emits LF; retain the same real Git deletion proof while
      // exercising the Windows-style command-output boundary as well.
      const crlfGit = Layer.effect(
        GitCore,
        Effect.map(Effect.service(GitCore), (core) => ({
          ...core,
          execute: (input: Parameters<GitCoreShape["execute"]>[0]) =>
            core
              .execute(input)
              .pipe(
                Effect.map((result) =>
                  input.args[0] === "for-each-ref"
                    ? { ...result, stdout: result.stdout.replaceAll("\n", "\r\n") }
                    : result,
                ),
              ),
        })),
      ).pipe(
        Layer.provide(
          GitCoreLive.pipe(
            Layer.provide(ServerConfig.layerTest(cwd, { prefix: "synara-live-cleanup-" })),
          ),
        ),
      );
      runtime = ManagedRuntime.make(
        CheckpointStoreLive.pipe(Layer.provide(crlfGit), Layer.provide(NodeServices.layer)),
      );
      await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;
          yield* store.deleteCheckpointRefs({ cwd, checkpointRefs: [], liveThreadId: threadId });
        }),
      );
      const refs = git(["for-each-ref", "--format=%(refname)"]);
      for (const ref of ownRefs) expect(refs).not.toContain(ref);
      for (const ref of keptRefs) expect(refs).toContain(ref);
      expect(readFileSync(join(cwd, ".git", "index"))).toEqual(index);
      expect(readFileSync(join(cwd, "file.txt"), "utf8")).toBe("working changes\n");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fails when a checkpoint ref cannot be deleted", async () => {
    const lockedRef = CheckpointRef.makeUnsafe("refs/synara/checkpoints/thread/turn/locked");
    const deletableRef = CheckpointRef.makeUnsafe("refs/synara/checkpoints/thread/turn/ok");
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === `update-ref -d ${lockedRef}`) {
        return Effect.succeed({ code: 1, stdout: "", stderr: "cannot lock ref\n" });
      }
      if (args === `update-ref -d ${deletableRef}`) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        return yield* store
          .deleteCheckpointRefs({ cwd: "/repo", checkpointRefs: [deletableRef, lockedRef] })
          .pipe(
            Effect.map(() => "success" as const),
            Effect.catch((error) => Effect.succeed(error.message)),
          );
      }),
    );

    // Every ref is still attempted; one loser must not abandon the batch.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).not.toBe("success");
    expect(result).toContain(lockedRef);
    expect(result).toContain("cannot lock ref");
    expect(result).not.toContain(deletableRef);
  });

  it("tolerates deleting checkpoint refs that are already absent", async () => {
    // `git update-ref -d` exits 0 for a ref that does not exist, so the
    // exit-code check must not turn best-effort cleanup into a hard failure.
    const missingRef = CheckpointRef.makeUnsafe("refs/synara/checkpoints/thread/turn/gone");
    const execute = vi.fn<GitCoreShape["execute"]>(() =>
      Effect.succeed({ code: 0, stdout: "", stderr: "" }),
    );
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        return yield* store
          .deleteCheckpointRefs({ cwd: "/repo", checkpointRefs: [missingRef] })
          .pipe(
            Effect.map(() => "success" as const),
            Effect.catch((error) => Effect.succeed(error.message)),
          );
      }),
    );

    expect(result).toBe("success");
  });

  it("serializes concurrent captures for the same cwd across different checkpoint refs", async () => {
    // Both concurrency tests above reuse a single checkpointRef, so they only
    // exercise the outer (cwd, ref) single-flight map. This drives two
    // DIFFERENT refs for the SAME cwd, which share nothing but the per-repo
    // checkpoint-index lock -- the only thing standing between them and two
    // git processes fighting over the same GIT_INDEX_FILE.
    let releaseAdd: (() => void) | undefined;
    const addGate = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });
    const addEvents: string[] = [];
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --git-path synara-checkpoint-index") {
        return Effect.succeed({
          code: 0,
          stdout: "/repo/.git/synara-checkpoint-index\n",
          stderr: "",
        });
      }
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: "/repo/.git/index\n", stderr: "" });
      }
      if (args === "rev-parse --verify HEAD") {
        return Effect.succeed({ code: 1, stdout: "", stderr: "" });
      }
      if (args === "add -A -- .") {
        addEvents.push("add-start");
        return Effect.promise(() => addGate).pipe(
          Effect.as({ code: 0, stdout: "", stderr: "" }),
          Effect.tap(() => Effect.sync(() => addEvents.push("add-end"))),
        );
      }
      if (args === "write-tree") {
        return Effect.succeed({ code: 0, stdout: "tree-oid\n", stderr: "" });
      }
      if (args.startsWith("commit-tree ")) {
        return Effect.succeed({ code: 0, stdout: "commit-oid\n", stderr: "" });
      }
      if (args.startsWith("update-ref ")) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        const first = yield* store
          .captureCheckpoint({
            cwd: "/repo",
            checkpointRef: CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/first"),
          })
          .pipe(Effect.forkChild);
        yield* Effect.promise(() => waitFor(() => addEvents.includes("add-start")));

        const second = yield* store
          .captureCheckpoint({
            cwd: "/repo",
            checkpointRef: CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/second"),
          })
          .pipe(Effect.forkChild);
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)));

        // The second ref's capture must be blocked behind the shared index
        // lock: only the first ref's "add -A" has been allowed to start.
        expect(addEvents).toEqual(["add-start"]);

        releaseAdd?.();
        yield* Fiber.join(first);
        yield* Fiber.join(second);

        // The second ref's "add -A" only started once the first's had fully
        // finished -- the two never overlapped on the shared index.
        expect(addEvents).toEqual(["add-start", "add-end", "add-start", "add-end"]);
      }),
    );
  });

  it("completes a failed capture's index cleanup before a queued sibling (different ref, same cwd) starts driving git", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "synara-checkpoint-cleanup-order-"));
    const checkpointIndexPath = join(tempDir, "synara-checkpoint-index");
    const lockPath = `${checkpointIndexPath}.lock`;

    let releaseCleanup: (() => void) | undefined;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const events: string[] = [];

    // Wrap the real Node FileSystem so the two `fs.remove` calls the failure
    // cleanup issues (index + `.lock`) are observable and can be held open,
    // without faking away real filesystem semantics for everything else.
    const instrumentedFsLayer = Layer.effect(
      FileSystem.FileSystem,
      Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        return {
          ...real,
          remove: (removePath: string, options?: Parameters<typeof real.remove>[1]) => {
            if (removePath !== checkpointIndexPath && removePath !== lockPath) {
              return real.remove(removePath, options);
            }
            events.push(`remove-start:${removePath}`);
            return Effect.promise(() => cleanupGate).pipe(
              Effect.flatMap(() => real.remove(removePath, options)),
              // Record completion on ANY outcome. The cleanup is best-effort in
              // production, so recording only success would make the ordering
              // assertion depend on whether the files happened to exist.
              Effect.onExit(() => Effect.sync(() => events.push(`remove-end:${removePath}`))),
            );
          },
        };
      }),
    ).pipe(Layer.provide(NodeServices.layer));

    const failingRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/fails");
    const siblingRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/sibling");
    let addSeenFailing = false;

    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --git-path synara-checkpoint-index") {
        return Effect.succeed({ code: 0, stdout: `${checkpointIndexPath}\n`, stderr: "" });
      }
      if (args === "rev-parse --git-path index") {
        // No working index to seed from: keep this test focused on the
        // cleanup-vs-sibling ordering instead of the seeding path.
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "rev-parse --verify HEAD") {
        return Effect.succeed({ code: 1, stdout: "", stderr: "" });
      }
      if (args === "add -A -- .") {
        if (!addSeenFailing) {
          addSeenFailing = true;
          return Effect.fail(
            new GitCommandError({
              operation: "CheckpointStore.captureCheckpoint",
              command: "git add -A -- .",
              cwd: tempDir,
              detail: "index is locked",
            }),
          );
        }
        events.push("sibling-add");
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "write-tree") {
        return Effect.succeed({ code: 0, stdout: "tree-oid\n", stderr: "" });
      }
      if (args.startsWith("commit-tree ")) {
        return Effect.succeed({ code: 0, stdout: "commit-oid\n", stderr: "" });
      }
      if (args.startsWith("update-ref ")) {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(instrumentedFsLayer),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;

          const failing = yield* store
            .captureCheckpoint({ cwd: tempDir, checkpointRef: failingRef })
            .pipe(
              Effect.map(() => "success" as const),
              Effect.catch((error) => Effect.succeed(error._tag)),
              Effect.forkChild,
            );
          // Wait until the failed capture's cleanup has started (and is now
          // held open on `cleanupGate`) before racing the sibling in.
          yield* Effect.promise(() =>
            waitFor(() => events.some((event) => event.startsWith("remove-start:"))),
          );

          const sibling = yield* store
            .captureCheckpoint({ cwd: tempDir, checkpointRef: siblingRef })
            .pipe(
              Effect.map(() => "success" as const),
              Effect.catch((error) => Effect.succeed(error._tag)),
              Effect.forkChild,
            );
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)));

          // The sibling must not have been allowed to drive git yet: the
          // failed capture's cleanup is still holding the shared index lock.
          expect(events).not.toContain("sibling-add");

          releaseCleanup?.();
          expect(yield* Fiber.join(failing)).toBe("GitCommandError");
          expect(yield* Fiber.join(sibling)).toBe("success");

          // The sibling's "add -A" only ran after both cleanup removals had
          // fully completed.
          const siblingAddIndex = events.indexOf("sibling-add");
          const removeEndIndices = events
            .map((event, index) => (event.startsWith("remove-end:") ? index : -1))
            .filter((index) => index !== -1);
          expect(removeEndIndices).toHaveLength(2);
          expect(siblingAddIndex).toBeGreaterThan(Math.max(...removeEndIndices));
        }),
      );

      expect(existsSync(checkpointIndexPath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("removes the durable checkpoint index when a capture is interrupted mid-flight", async () => {
    // The existing "discards the durable checkpoint index when a capture
    // fails" test only exercises a typed GitCommandError, which
    // `Effect.tapError` would also catch -- so a regression from
    // `Effect.onError` to `Effect.tapError` on the cleanup would still pass
    // it. `onError` additionally covers interruption and defects; this test
    // pins that by interrupting the capture mid-flight instead of failing it.
    const tempDir = mkdtempSync(join(tmpdir(), "synara-checkpoint-interrupt-"));
    const checkpointIndexPath = join(tempDir, "synara-checkpoint-index");
    // Seed a stale index up front so a passing assertion proves the
    // interrupted capture's cleanup actually removed it, not merely that one
    // was never created.
    writeFileSync(checkpointIndexPath, "stale-checkpoint-index");

    let addCalled = false;
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --git-path synara-checkpoint-index") {
        return Effect.succeed({ code: 0, stdout: `${checkpointIndexPath}\n`, stderr: "" });
      }
      if (args === "rev-parse --git-path index") {
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      }
      if (args === "rev-parse --verify HEAD") {
        return Effect.succeed({ code: 1, stdout: "", stderr: "" });
      }
      if (args === "add -A -- .") {
        addCalled = true;
        return Effect.never;
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;
          const fiber = yield* store
            .captureCheckpoint({
              cwd: tempDir,
              checkpointRef: CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/interrupted"),
            })
            .pipe(Effect.forkChild);
          yield* Effect.promise(() => waitFor(() => addCalled));
          yield* Fiber.interrupt(fiber);
        }),
      );

      expect(existsSync(checkpointIndexPath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves checkpoint refs without provoking a non-zero exit, and matches the ref exactly", async () => {
    // A non-zero exit is expensive: the process spawner reacts to one by
    // shelling out to `taskkill /pid <pid> /T /F`, ~560ms on Windows. This
    // probe runs on every turn via `skipIfExists`, so "ref is absent" must be
    // signalled by empty output, never by the exit code.
    const wantedRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/message");
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === `for-each-ref --format=%(refname)%09%(objectname) ${wantedRef}`) {
        // `for-each-ref` takes a PATTERN, so a caller must not assume the
        // output describes only the ref it asked for.
        return Effect.succeed({
          code: 0,
          stdout: `refs/synara-checkpoints/thread/message-other\tdecoy-oid\n${wantedRef}\twanted-oid\n`,
          stderr: "",
        });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        expect(yield* store.hasCheckpointRef({ cwd: "/repo", checkpointRef: wantedRef })).toBe(
          true,
        );
      }),
    );

    expect(
      execute.mock.calls.some(([call]) => call.args.join(" ").startsWith("rev-parse --verify")),
    ).toBe(false);
    expect(execute.mock.calls.every(([call]) => call.allowNonZeroExit !== true)).toBe(true);
  });

  it("re-probes a non-Git workspace only after the negative cache expires", async () => {
    // Outside a repository `rev-parse` exits non-zero, and a non-zero exit
    // costs a `taskkill` spawn. Without a negative cache a project with no Git
    // pays that on every single turn; caching it forever would be wrong too,
    // because the user can `git init` while the server is running.
    const execute = vi.fn<GitCoreShape["execute"]>((input) => {
      const args = input.args.join(" ");
      if (args === "rev-parse --is-inside-work-tree") {
        return Effect.succeed({ code: 128, stdout: "", stderr: "not a git repository" });
      }
      throw new Error(`Unexpected git args: ${args}`);
    });
    const layer = CheckpointStoreLive.pipe(
      Layer.provide(Layer.succeed(GitCore, { execute } as unknown as GitCoreShape)),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    const nowSpy = vi.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(1_000_000);
      await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;
          expect(yield* store.isGitRepository("/not-a-repo")).toBe(false);
          expect(yield* store.isGitRepository("/not-a-repo")).toBe(false);
          expect(yield* store.isGitRepository("/not-a-repo")).toBe(false);
        }),
      );
      expect(execute).toHaveBeenCalledTimes(1);

      // Past the TTL the answer is re-probed, so a freshly `git init`-ed
      // project is picked up instead of being pinned to "not a repo" forever.
      nowSpy.mockReturnValue(1_000_000 + 30_001);
      await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;
          expect(yield* store.isGitRepository("/not-a-repo")).toBe(false);
        }),
      );
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  // Every other test in this file mocks GitCore, which cannot prove anything
  // about how real Git treats the durable checkpoint index. This one runs
  // actual git against a real repository, because the property at stake is
  // silent data loss: a missed change does not fail anything, it just produces
  // a checkpoint tree that disagrees with the worktree, which then corrupts the
  // turn diff and anything restored from it.
  it("captures a same-size rewrite made immediately after the previous capture (real git)", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "synara-checkpoint-realgit-"));
    const filePath = join(tempDir, "tracked.txt");
    const git = (...args: readonly string[]) =>
      execFileSync("git", args, { cwd: tempDir, encoding: "utf8" });

    const layer = CheckpointStoreLive.pipe(
      Layer.provideMerge(GitCoreLive),
      Layer.provideMerge(ServerConfig.layerTest(tempDir, { prefix: "checkpoint-realgit-" })),
      Layer.provideMerge(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    try {
      git("init", "--quiet");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      writeFileSync(filePath, "AAAA");
      git("add", "-A");
      git("commit", "--quiet", "-m", "initial");

      const firstRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/realgit/first");
      const secondRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/realgit/second");

      const readCheckpointBlob = (ref: CheckpointRef) => git("show", `${ref}:tracked.txt`).trim();

      await runtime.runPromise(
        Effect.gen(function* () {
          const store = yield* CheckpointStore;
          yield* store.captureCheckpoint({ cwd: tempDir, checkpointRef: firstRef });

          // The worst case for Git's stat cache: same byte length, rewritten
          // as fast as possible after the index that recorded it was written,
          // so the mtime can be indistinguishable at filesystem granularity.
          writeFileSync(filePath, "BBBB");

          yield* store.captureCheckpoint({ cwd: tempDir, checkpointRef: secondRef });
        }),
      );

      expect(readCheckpointBlob(firstRef)).toBe("AAAA");
      // If the durable index ever reported the rewrite as cached-clean, this
      // would still read "AAAA" and the change would be silently lost.
      expect(readCheckpointBlob(secondRef)).toBe("BBBB");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

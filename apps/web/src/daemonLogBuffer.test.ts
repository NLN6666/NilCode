import { describe, expect, it } from "vitest";

import {
  appendDaemonLogChunk,
  applyDaemonLogBacklog,
  beginDaemonLogHydration,
  DAEMON_LOG_BUFFER_MAX_CHARS,
  DAEMON_LOG_PENDING_MAX_CHUNKS,
  emptyDaemonLogBuffer,
  resolveDaemonLogWritePlan,
  type DaemonLogBuffer,
} from "./daemonLogBuffer";

const backlog = (content: string, nextCursor: number) => ({
  content,
  nextCursor,
  droppedBytes: 0,
  truncated: false,
});

const hydrated = (content: string, nextCursor = content.length): DaemonLogBuffer =>
  applyDaemonLogBacklog(
    beginDaemonLogHydration(emptyDaemonLogBuffer()),
    backlog(content, nextCursor),
  );

describe("hydration ordering", () => {
  it("queues live output until the backlog lands", () => {
    const queued = appendDaemonLogChunk(beginDaemonLogHydration(emptyDaemonLogBuffer()), {
      chunk: "live\n",
      cursor: 120,
    });

    expect(queued.text).toBe("");
    expect(queued.pending).toHaveLength(1);
  });

  it("replays only the chunks the backlog did not already contain", () => {
    let buffer = beginDaemonLogHydration(emptyDaemonLogBuffer());
    // Cursor is the count *after* the chunk, so 100 is covered by a backlog ending at 100.
    buffer = appendDaemonLogChunk(buffer, { chunk: "covered\n", cursor: 100 });
    buffer = appendDaemonLogChunk(buffer, { chunk: "fresh\n", cursor: 140 });

    const result = applyDaemonLogBacklog(buffer, backlog("history\n", 100));

    expect(result.text).toBe("history\nfresh\n");
    expect(result.pending).toEqual([]);
    expect(result.status).toBe("ready");
  });

  it("carries the furthest cursor it has seen after a replay", () => {
    let buffer = beginDaemonLogHydration(emptyDaemonLogBuffer());
    buffer = appendDaemonLogChunk(buffer, { chunk: "fresh\n", cursor: 140 });

    expect(applyDaemonLogBacklog(buffer, backlog("history\n", 100)).cursor).toBe(140);
  });

  it("reports rotation loss instead of presenting the log as continuous", () => {
    const buffer = applyDaemonLogBacklog(beginDaemonLogHydration(emptyDaemonLogBuffer()), {
      content: "tail\n",
      nextCursor: 9_000,
      droppedBytes: 4_096,
      truncated: true,
    });

    expect(buffer).toMatchObject({ droppedBytes: 4_096, truncated: true });
  });

  it("bounds the queue for a daemon nobody has opened", () => {
    let buffer = beginDaemonLogHydration(emptyDaemonLogBuffer());
    for (let index = 0; index < DAEMON_LOG_PENDING_MAX_CHUNKS + 25; index += 1) {
      buffer = appendDaemonLogChunk(buffer, { chunk: `${index}\n`, cursor: index });
    }

    expect(buffer.pending).toHaveLength(DAEMON_LOG_PENDING_MAX_CHUNKS);
    // Oldest-first: the newest output is what a reader wants when they finally look.
    expect(buffer.pending.at(-1)?.chunk).toBe(`${DAEMON_LOG_PENDING_MAX_CHUNKS + 24}\n`);
  });
});

describe("trimming", () => {
  it("keeps the buffer bounded and records what it dropped", () => {
    const buffer = appendDaemonLogChunk(hydrated(""), {
      chunk: "x".repeat(DAEMON_LOG_BUFFER_MAX_CHARS + 1_000),
      cursor: 1,
    });

    expect(buffer.text.length).toBeLessThanOrEqual(DAEMON_LOG_BUFFER_MAX_CHARS);
    expect(buffer.droppedChars).toBeGreaterThan(0);
  });

  it("drops in blocks so a rewrite is rare rather than per-chunk", () => {
    let buffer = appendDaemonLogChunk(hydrated(""), {
      chunk: "x".repeat(DAEMON_LOG_BUFFER_MAX_CHARS),
      cursor: 1,
    });
    buffer = appendDaemonLogChunk(buffer, { chunk: "y", cursor: 2 });
    const afterFirstTrim = buffer.droppedChars;

    buffer = appendDaemonLogChunk(buffer, { chunk: "z", cursor: 3 });

    expect(afterFirstTrim).toBeGreaterThan(1);
    expect(buffer.droppedChars).toBe(afterFirstTrim);
  });
});

describe("resolveDaemonLogWritePlan", () => {
  it("writes everything into a terminal that has seen nothing", () => {
    const plan = resolveDaemonLogWritePlan(null, hydrated("hello\n"));

    expect(plan).toMatchObject({ clear: true, append: "hello\n" });
  });

  it("appends only the new tail on the common path", () => {
    const first = hydrated("hello\n");
    const shown = resolveDaemonLogWritePlan(null, first).mark;

    const plan = resolveDaemonLogWritePlan(
      shown,
      appendDaemonLogChunk(first, { chunk: "world\n", cursor: 20 }),
    );

    expect(plan).toMatchObject({ clear: false, append: "world\n" });
  });

  it("rewrites when the text was replaced by a fresh backlog", () => {
    const first = hydrated("old\n");
    const shown = resolveDaemonLogWritePlan(null, first).mark;

    const plan = resolveDaemonLogWritePlan(
      shown,
      applyDaemonLogBacklog(first, backlog("new\n", 4)),
    );

    // Same length, different content: only the generation bump catches this.
    expect(plan).toMatchObject({ clear: true, append: "new\n" });
  });

  it("rewrites when the front of the buffer was trimmed away", () => {
    let buffer = appendDaemonLogChunk(hydrated(""), {
      chunk: "x".repeat(DAEMON_LOG_BUFFER_MAX_CHARS),
      cursor: 1,
    });
    const shown = resolveDaemonLogWritePlan(null, buffer).mark;
    buffer = appendDaemonLogChunk(buffer, { chunk: "tail", cursor: 2 });

    // What is on screen is no longer a prefix of the buffer, so appending would splice
    // the new tail onto text that has already scrolled out of the model.
    expect(resolveDaemonLogWritePlan(shown, buffer).clear).toBe(true);
  });

  it("writes nothing when the buffer has not moved", () => {
    const buffer = hydrated("hello\n");
    const shown = resolveDaemonLogWritePlan(null, buffer).mark;

    expect(resolveDaemonLogWritePlan(shown, buffer)).toMatchObject({ clear: false, append: "" });
  });
});

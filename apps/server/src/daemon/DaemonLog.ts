// FILE: DaemonLog.ts
// Purpose: File-backed daemon output log with rotation and byte-cursor reads.
// Layer: Daemon infrastructure
// Depends on: node:fs/promises, shared history cursor slicing.
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md. The current/previous
// file pair, the `outputBytes` cursor, and head/tail/grep read shaping follow that
// project's DaemonLog.
//
// A detached daemon writes straight into this file through an inherited fd, so the log
// has to survive the server exiting and be readable again on the next boot. That rules
// out an in-memory ring buffer: the file *is* the buffer.

import { open, readFile, rename, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import { sliceHistorySince } from "@synara/shared/backgroundServiceSession";

export const LOG_FILE = "output.log";
export const PREVIOUS_LOG_FILE = "output.prev.log";

/** Rotate once the active file passes this size. */
export const MAX_LOG_BYTES = 4 * 1_024 * 1_024;
/** Ceiling on how much text a single read materializes. */
export const LOG_READ_BYTES = 1_024 * 1_024;

export interface DaemonLogReadInput {
  readonly cursor: number;
  readonly lines: number;
  readonly head: boolean;
  readonly grep: string | null;
}

export interface DaemonLogRead {
  content: string;
  nextCursor: number;
  droppedBytes: number;
  truncated: boolean;
}

export interface DaemonLogOptions {
  readonly maxBytes?: number;
  readonly readBytes?: number;
}

export class DaemonLog {
  private handle: FileHandle | null = null;
  private activeBytes = 0;
  private previousBytes = 0;
  private totalBytes = 0;

  private constructor(
    private readonly dir: string,
    private readonly maxBytes: number,
    private readonly readBytes: number,
  ) {}

  /**
   * Open the log for a daemon directory, moving any log from a previous run aside.
   *
   * Keeping the old run as `output.prev.log` rather than truncating means a crash
   * loop's first failure is still readable after the relaunch overwrote the log.
   */
  static async open(dir: string, options: DaemonLogOptions = {}): Promise<DaemonLog> {
    const log = new DaemonLog(dir, options.maxBytes ?? MAX_LOG_BYTES, options.readBytes ?? LOG_READ_BYTES);
    await log.rotate();
    log.handle = await open(log.activePath, "a");
    return log;
  }

  private get activePath(): string {
    return path.join(this.dir, LOG_FILE);
  }

  private get previousPath(): string {
    return path.join(this.dir, PREVIOUS_LOG_FILE);
  }

  /** Total bytes ever written. Doubles as the read cursor exposed to callers. */
  get outputBytes(): number {
    return this.totalBytes;
  }

  /** File descriptor a detached child inherits for stdout and stderr. */
  get fd(): number {
    if (this.handle === null) throw new Error("daemon log is closed");
    return this.handle.fd;
  }

  async append(text: string): Promise<void> {
    if (text.length === 0) return;
    const bytes = Buffer.byteLength(text, "utf8");

    if (this.activeBytes + bytes > this.maxBytes) {
      await this.rotate();
      this.handle = await open(this.activePath, "a");
    }
    if (this.handle === null) this.handle = await open(this.activePath, "a");

    await this.handle.write(text, null, "utf8");
    this.activeBytes += bytes;
    this.totalBytes += bytes;
  }

  /**
   * Re-measure the files a detached child has been writing behind our back.
   *
   * A detached daemon holds the fd itself, so `append` never runs and the byte
   * counters would otherwise stay frozen at whatever the last supervised write left.
   */
  async refreshFromDisk(): Promise<void> {
    const active = await fileSize(this.activePath);
    const previous = await fileSize(this.previousPath);
    const observed = active + previous;
    this.activeBytes = active;
    this.previousBytes = previous;
    // Only ever grows: rotation drops bytes from disk, but they were still written.
    this.totalBytes = Math.max(this.totalBytes, observed);
  }

  async read(input: DaemonLogReadInput): Promise<DaemonLogRead> {
    const previous = await readFileOrEmpty(this.previousPath);
    const active = await readFileOrEmpty(this.activePath);
    const retained = previous + active;

    const slice = sliceHistorySince({
      retained,
      appendedBytes: Math.max(this.totalBytes, Buffer.byteLength(retained, "utf8")),
      cursor: input.cursor,
      maxBytes: this.readBytes,
    });

    return {
      // Shaping happens after the cursor math so filtering can never strand the
      // cursor: a follow-up read must not replay lines this call already consumed.
      content: shapeLines(slice.content, input),
      nextCursor: slice.nextCursor,
      droppedBytes: slice.droppedBytes,
      truncated: slice.truncated,
    };
  }

  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    await handle?.close();
  }

  private async rotate(): Promise<void> {
    await this.close();
    if (await fileExists(this.activePath)) {
      await rename(this.activePath, this.previousPath);
      this.previousBytes = this.activeBytes;
    }
    this.activeBytes = 0;
  }
}

/**
 * Apply line limits and the grep filter to already-sliced text.
 *
 * An unparseable pattern matches nothing rather than throwing: the pattern comes
 * from the model, and a bad one should return an empty read the agent can react to,
 * not take down the tool call.
 */
function shapeLines(content: string, input: DaemonLogReadInput): string {
  if (content.length === 0) return content;

  const sourceLines = content.split("\n");
  const trailingNewline = sourceLines.at(-1) === "";
  if (trailingNewline) sourceLines.pop();
  const sourceLast = sourceLines.at(-1);

  let lines = sourceLines;
  if (input.grep !== null && input.grep.length > 0) {
    const pattern = compilePattern(input.grep);
    lines = pattern === null ? [] : lines.filter((line) => pattern.test(line));
  }

  const limit = Math.max(0, input.lines);
  if (lines.length > limit) {
    lines = input.head ? lines.slice(0, limit) : lines.slice(-limit);
  }

  if (lines.length === 0) return "";

  // Reproduce the source's trailing newline rather than always adding one: a read
  // that stops mid-line must stay mid-line, or the caller cannot tell a complete
  // line from a partial one the daemon is still writing. A newline is only added
  // back when the kept text ends before the source did, where one really existed.
  const endsEarly = lines.at(-1) !== sourceLast;
  return `${lines.join("\n")}${trailingNewline || endsEarly ? "\n" : ""}`;
}

function compilePattern(source: string): RegExp | null {
  try {
    return new RegExp(source, "u");
  } catch {
    return null;
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(target: string): Promise<number> {
  try {
    return (await stat(target)).size;
  } catch {
    return 0;
  }
}

async function readFileOrEmpty(target: string): Promise<string> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return "";
  }
}

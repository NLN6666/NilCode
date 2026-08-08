// FILE: daemonLogBuffer.ts
// Purpose: Per-daemon scrollback buffer — hydration from the server backlog, live
//          appends, bounded trimming, and the plan for writing it into a terminal.
// Layer: Web UI state helpers
// Exports: DaemonLogBuffer plus the pure transitions and the render write plan.
//
// Kept free of React and of the store so the ordering rules below can be tested as
// plain values. They are the whole reason this module exists: a live feed and a
// backlog read race each other, and getting that wrong duplicates or drops log lines
// in a window the user is using to decide whether their server came up.

/** Ceiling on retained scrollback per daemon. */
export const DAEMON_LOG_BUFFER_MAX_CHARS = 256_000;

/**
 * How much to discard once the ceiling is hit.
 *
 * Trimming one character at a time would keep the buffer exactly at the ceiling and
 * force a full terminal rewrite on every chunk. Dropping a quarter amortizes that into
 * a rewrite every few thousand lines.
 */
export const DAEMON_LOG_TRIM_CHARS = Math.floor(DAEMON_LOG_BUFFER_MAX_CHARS / 4);

/** Cap on live output held while the backlog read is in flight. */
export const DAEMON_LOG_PENDING_MAX_CHUNKS = 512;

export interface DaemonLogChunk {
  readonly chunk: string;
  /** The daemon's `outputBytes` *after* this chunk. */
  readonly cursor: number;
}

export interface DaemonLogBuffer {
  /** `ready` means the backlog has landed and `text` is authoritative. */
  readonly status: "empty" | "hydrating" | "ready";
  readonly text: string;
  /** Characters trimmed off the front. Monotonic; a change means "rewrite the view". */
  readonly droppedChars: number;
  /** Bytes the server rotated away before the backlog read. Reported, never hidden. */
  readonly droppedBytes: number;
  readonly truncated: boolean;
  /** Server byte cursor covered by `text`. */
  readonly cursor: number;
  /** Live output that arrived before the backlog did. */
  readonly pending: readonly DaemonLogChunk[];
  /** Bumped whenever `text` is replaced wholesale rather than appended to. */
  readonly generation: number;
}

export function emptyDaemonLogBuffer(): DaemonLogBuffer {
  return {
    status: "empty",
    text: "",
    droppedChars: 0,
    droppedBytes: 0,
    truncated: false,
    cursor: 0,
    pending: [],
    generation: 0,
  };
}

function trimmed(text: string, droppedChars: number): { text: string; droppedChars: number } {
  if (text.length <= DAEMON_LOG_BUFFER_MAX_CHARS) return { text, droppedChars };
  const cut = text.length - DAEMON_LOG_BUFFER_MAX_CHARS + DAEMON_LOG_TRIM_CHARS;
  return { text: text.slice(cut), droppedChars: droppedChars + cut };
}

/** Mark a daemon as awaiting its backlog so live chunks queue instead of landing early. */
export function beginDaemonLogHydration(buffer: DaemonLogBuffer): DaemonLogBuffer {
  if (buffer.status !== "empty") return buffer;
  return { ...buffer, status: "hydrating" };
}

/**
 * Land the backlog read and replay whatever arrived while it was in flight.
 *
 * A pending chunk is replayed only when its cursor is past the backlog's — the cursor
 * is the count *after* the chunk, so anything at or below `nextCursor` is already in
 * `content` and replaying it would print those lines twice.
 */
export function applyDaemonLogBacklog(
  buffer: DaemonLogBuffer,
  backlog: {
    readonly content: string;
    readonly nextCursor: number;
    readonly droppedBytes: number;
    readonly truncated: boolean;
  },
): DaemonLogBuffer {
  const replayed = buffer.pending.filter((entry) => entry.cursor > backlog.nextCursor);
  const combined = backlog.content + replayed.map((entry) => entry.chunk).join("");
  const { text, droppedChars } = trimmed(combined, buffer.droppedChars);

  return {
    status: "ready",
    text,
    droppedChars,
    droppedBytes: backlog.droppedBytes,
    truncated: backlog.truncated,
    cursor: replayed.at(-1)?.cursor ?? backlog.nextCursor,
    pending: [],
    generation: buffer.generation + 1,
  };
}

/** Append one live chunk, queueing it instead when the backlog has not landed yet. */
export function appendDaemonLogChunk(
  buffer: DaemonLogBuffer,
  entry: DaemonLogChunk,
): DaemonLogBuffer {
  if (buffer.status !== "ready") {
    // Oldest-first drop: a daemon nobody has opened must not grow without bound, and
    // the backlog read will re-supply whatever falls off here.
    const pending = [...buffer.pending, entry].slice(-DAEMON_LOG_PENDING_MAX_CHUNKS);
    return { ...buffer, pending, cursor: entry.cursor };
  }

  const { text, droppedChars } = trimmed(buffer.text + entry.chunk, buffer.droppedChars);
  return { ...buffer, text, droppedChars, cursor: entry.cursor };
}

/** What a terminal has already been shown. Opaque to callers other than the view. */
export interface DaemonLogRenderMark {
  readonly generation: number;
  readonly droppedChars: number;
  readonly textLength: number;
}

export interface DaemonLogWritePlan {
  /** Reset the terminal before writing — the retained text no longer extends what it shows. */
  readonly clear: boolean;
  readonly append: string;
  readonly mark: DaemonLogRenderMark;
}

/**
 * Diff what a terminal has been shown against what the buffer now holds.
 *
 * Appending is the fast path and the common one. A rewrite happens only when the text
 * was replaced (hydration) or trimmed at the front, because in both cases what is on
 * screen is no longer a prefix of the buffer.
 */
export function resolveDaemonLogWritePlan(
  rendered: DaemonLogRenderMark | null,
  buffer: DaemonLogBuffer,
): DaemonLogWritePlan {
  const mark: DaemonLogRenderMark = {
    generation: buffer.generation,
    droppedChars: buffer.droppedChars,
    textLength: buffer.text.length,
  };

  const extendsWhatIsShown =
    rendered !== null &&
    rendered.generation === buffer.generation &&
    rendered.droppedChars === buffer.droppedChars &&
    rendered.textLength <= buffer.text.length;

  if (!extendsWhatIsShown) return { clear: true, append: buffer.text, mark };
  return { clear: false, append: buffer.text.slice(rendered.textLength), mark };
}

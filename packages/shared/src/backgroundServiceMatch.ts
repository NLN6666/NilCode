// FILE: backgroundServiceMatch.ts
// Purpose: Output matching, command-echo stripping, and control-char mapping for
//          background service sessions.
// Layer: Shared runtime utility
// Exports: createOutputMatcher, stripCommandEcho, CONTROL_CHARS.
//
// Substring matching only, never regex. Needles come from the model and cannot be
// audited, and a pathological pattern paired with a server flooding output would
// pin the event loop from inside the PTY drain path. Substring scanning is linear
// and cannot be built into a denial of service.

export interface OutputMatcher {
  /** Feed one chunk of output; returns the needle that hit, or null. */
  push(chunk: string): string | null;
}

export function createOutputMatcher(needles: readonly string[]): OutputMatcher {
  const active = needles.filter((needle) => needle.length > 0);
  if (active.length === 0) {
    return { push: () => null };
  }

  // A needle can straddle a boundary by at most its own length minus one. Carrying
  // that many trailing characters guarantees any split needle re-assembles when the
  // next chunk lands, while keeping the retained window bounded no matter how much
  // output streams through.
  const carrySize = Math.max(...active.map((needle) => needle.length)) - 1;
  let carry = "";

  return {
    push(chunk: string): string | null {
      const window = carry + chunk;
      for (const needle of active) {
        if (window.includes(needle)) return needle;
      }
      carry = carrySize > 0 ? window.slice(-carrySize) : "";
      return null;
    },
  };
}

/**
 * Strip the echo a PTY reflects back for input written to its stdin.
 *
 * Without this the agent reads back the command it just sent and can mistake it
 * for the server's response.
 *
 * Only the leading echo is removed: the same text appearing later in the log
 * body (a player typing the same words in chat, for instance) is real output and
 * must survive.
 */
export function stripCommandEcho(content: string, sentInput: string): string {
  const echo = sentInput.trim();
  if (echo.length === 0) return content;

  const index = content.indexOf(echo);
  if (index === -1) return content;

  // Anything but whitespace ahead of the match means this is log text that merely
  // repeats the command (a player saying the same words in chat), not the echo.
  if (content.slice(0, index).trim().length > 0) return content;

  return content.slice(index + echo.length).replace(/^\r?\n/, "");
}

export const CONTROL_CHARS = {
  "ctrl-c": "\x03",
  "ctrl-d": "\x04",
} as const;

export type ControlCharName = keyof typeof CONTROL_CHARS;

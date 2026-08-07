import { describe, expect, it } from "vitest";

import { isAllowedSignal, resolveTerminalKey, TERMINAL_KEY_NAMES } from "./daemonKeys";

describe("resolveTerminalKey", () => {
  it("maps control keys to their bytes", () => {
    expect(resolveTerminalKey("CTRL_C")).toBe("\x03");
    expect(resolveTerminalKey("CTRL_D")).toBe("\x04");
    expect(resolveTerminalKey("ENTER")).toBe("\r");
    expect(resolveTerminalKey("TAB")).toBe("\t");
    expect(resolveTerminalKey("ESC")).toBe("\x1b");
  });

  it("maps arrow keys to their CSI sequences", () => {
    expect(resolveTerminalKey("UP")).toBe("\x1b[A");
    expect(resolveTerminalKey("DOWN")).toBe("\x1b[B");
    expect(resolveTerminalKey("RIGHT")).toBe("\x1b[C");
    expect(resolveTerminalKey("LEFT")).toBe("\x1b[D");
  });

  it("is case insensitive", () => {
    expect(resolveTerminalKey("ctrl_c")).toBe("\x03");
    expect(resolveTerminalKey("Enter")).toBe("\r");
  });

  it("returns null for an unknown key instead of passing it through", () => {
    // Passing unknown names through would let the model smuggle arbitrary bytes
    // into the PTY under the guise of a key name.
    expect(resolveTerminalKey("CTRL_ALT_DEL")).toBeNull();
    expect(resolveTerminalKey("rm -rf /")).toBeNull();
    expect(resolveTerminalKey("")).toBeNull();
  });

  it("exposes every mapped name for schema generation", () => {
    expect(TERMINAL_KEY_NAMES.length).toBeGreaterThan(0);
    for (const name of TERMINAL_KEY_NAMES) {
      expect(resolveTerminalKey(name)).not.toBeNull();
    }
  });
});

describe("isAllowedSignal", () => {
  it("allows the graceful and forceful termination signals", () => {
    expect(isAllowedSignal("SIGINT")).toBe(true);
    expect(isAllowedSignal("SIGTERM")).toBe(true);
    expect(isAllowedSignal("SIGKILL")).toBe(true);
    expect(isAllowedSignal("SIGHUP")).toBe(true);
  });

  it("rejects anything outside the whitelist", () => {
    expect(isAllowedSignal("SIGSTOP")).toBe(false);
    expect(isAllowedSignal("not-a-signal")).toBe(false);
    expect(isAllowedSignal("")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isAllowedSignal("sigterm")).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  ENABLE_HARDWARE_ACCELERATION_FLAG,
  applyDesktopGraphicsPolicy,
} from "./desktopGraphicsPolicy";

describe("applyDesktopGraphicsPolicy", () => {
  it("disables hardware acceleration on Windows", () => {
    const disableHardwareAcceleration = vi.fn();

    const result = applyDesktopGraphicsPolicy(
      { disableHardwareAcceleration },
      "win32",
      ["Synara.exe"],
    );

    expect(disableHardwareAcceleration).toHaveBeenCalledOnce();
    expect(result).toEqual({
      mode: "software",
      reason: "windows-safety-default",
    });
  });

  it("allows an explicit experimental hardware acceleration override on Windows", () => {
    const disableHardwareAcceleration = vi.fn();

    const result = applyDesktopGraphicsPolicy(
      { disableHardwareAcceleration },
      "win32",
      ["Synara.exe", ENABLE_HARDWARE_ACCELERATION_FLAG],
    );

    expect(disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "hardware-experimental",
      reason: "windows-command-line-override",
    });
  });

  it("requires an exact experimental flag match", () => {
    const disableHardwareAcceleration = vi.fn();

    applyDesktopGraphicsPolicy(
      { disableHardwareAcceleration },
      "win32",
      ["Synara.exe", `${ENABLE_HARDWARE_ACCELERATION_FLAG}=true`],
    );

    expect(disableHardwareAcceleration).toHaveBeenCalledOnce();
  });

  it.each(["darwin", "linux"] as const)(
    "leaves hardware acceleration unchanged on %s",
    (platform) => {
      const disableHardwareAcceleration = vi.fn();

      const result = applyDesktopGraphicsPolicy(
        { disableHardwareAcceleration },
        platform,
        ["Synara", ENABLE_HARDWARE_ACCELERATION_FLAG],
      );

      expect(disableHardwareAcceleration).not.toHaveBeenCalled();
      expect(result).toEqual({
        mode: "unchanged",
        reason: "non-windows",
      });
    },
  );
});

import { describe, expect, it, vi } from "vitest";

import {
  DISABLE_HARDWARE_ACCELERATION_FLAG,
  applyDesktopGraphicsPolicy,
} from "./desktopGraphicsPolicy";

describe("applyDesktopGraphicsPolicy", () => {
  it("leaves hardware acceleration enabled by default on Windows", () => {
    const disableHardwareAcceleration = vi.fn();

    const result = applyDesktopGraphicsPolicy(
      { disableHardwareAcceleration },
      "win32",
      ["Synara.exe"],
    );

    expect(disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "hardware-default",
      reason: "windows-default",
    });
  });

  it("allows users to explicitly disable hardware acceleration on Windows", () => {
    const disableHardwareAcceleration = vi.fn();

    const result = applyDesktopGraphicsPolicy(
      { disableHardwareAcceleration },
      "win32",
      ["Synara.exe", DISABLE_HARDWARE_ACCELERATION_FLAG],
    );

    expect(disableHardwareAcceleration).toHaveBeenCalledOnce();
    expect(result).toEqual({
      mode: "software-user-disabled",
      reason: "windows-command-line-disable",
    });
  });

  it("requires an exact disable flag match", () => {
    const disableHardwareAcceleration = vi.fn();

    applyDesktopGraphicsPolicy(
      { disableHardwareAcceleration },
      "win32",
      ["Synara.exe", `${DISABLE_HARDWARE_ACCELERATION_FLAG}=true`],
    );

    expect(disableHardwareAcceleration).not.toHaveBeenCalled();
  });

  it("treats the former enable flag as the Windows default", () => {
    const disableHardwareAcceleration = vi.fn();

    const result = applyDesktopGraphicsPolicy(
      { disableHardwareAcceleration },
      "win32",
      ["Synara.exe", "--enable-hardware-acceleration"],
    );

    expect(disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "hardware-default",
      reason: "windows-default",
    });
  });

  it.each(["darwin", "linux"] as const)(
    "leaves hardware acceleration unchanged on %s",
    (platform) => {
      const disableHardwareAcceleration = vi.fn();

      const result = applyDesktopGraphicsPolicy(
        { disableHardwareAcceleration },
        platform,
        ["Synara", DISABLE_HARDWARE_ACCELERATION_FLAG],
      );

      expect(disableHardwareAcceleration).not.toHaveBeenCalled();
      expect(result).toEqual({
        mode: "unchanged",
        reason: "non-windows",
      });
    },
  );
});

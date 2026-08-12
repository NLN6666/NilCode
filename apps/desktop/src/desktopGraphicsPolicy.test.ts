import { describe, expect, it, vi } from "vitest";

import { applyDesktopGraphicsPolicy } from "./desktopGraphicsPolicy";

describe("applyDesktopGraphicsPolicy", () => {
  it("disables hardware acceleration on Windows", () => {
    const disableHardwareAcceleration = vi.fn();

    applyDesktopGraphicsPolicy({ disableHardwareAcceleration }, "win32");

    expect(disableHardwareAcceleration).toHaveBeenCalledOnce();
  });

  it.each(["darwin", "linux"] as const)(
    "leaves hardware acceleration unchanged on %s",
    (platform) => {
      const disableHardwareAcceleration = vi.fn();

      applyDesktopGraphicsPolicy({ disableHardwareAcceleration }, platform);

      expect(disableHardwareAcceleration).not.toHaveBeenCalled();
    },
  );
});

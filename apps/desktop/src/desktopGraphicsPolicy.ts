export interface DesktopGraphicsApp {
  disableHardwareAcceleration(): void;
}

export const DISABLE_HARDWARE_ACCELERATION_FLAG = "--disable-hardware-acceleration";

export type DesktopGraphicsPolicyResult =
  | {
      readonly mode: "hardware-default";
      readonly reason: "windows-default";
    }
  | {
      readonly mode: "software-user-disabled";
      readonly reason: "windows-command-line-disable";
    }
  | {
      readonly mode: "unchanged";
      readonly reason: "non-windows";
    };

export function applyDesktopGraphicsPolicy(
  app: DesktopGraphicsApp,
  platform: NodeJS.Platform = process.platform,
  argv: readonly string[] = process.argv,
): DesktopGraphicsPolicyResult {
  if (platform !== "win32") {
    return {
      mode: "unchanged",
      reason: "non-windows",
    };
  }

  if (argv.includes(DISABLE_HARDWARE_ACCELERATION_FLAG)) {
    app.disableHardwareAcceleration();
    return {
      mode: "software-user-disabled",
      reason: "windows-command-line-disable",
    };
  }

  return {
    mode: "hardware-default",
    reason: "windows-default",
  };
}

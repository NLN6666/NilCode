export interface DesktopGraphicsApp {
  disableHardwareAcceleration(): void;
}

export const ENABLE_HARDWARE_ACCELERATION_FLAG = "--enable-hardware-acceleration";

export type DesktopGraphicsPolicyResult =
  | {
      readonly mode: "software";
      readonly reason: "windows-safety-default";
    }
  | {
      readonly mode: "hardware-experimental";
      readonly reason: "windows-command-line-override";
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

  if (argv.includes(ENABLE_HARDWARE_ACCELERATION_FLAG)) {
    return {
      mode: "hardware-experimental",
      reason: "windows-command-line-override",
    };
  }

  app.disableHardwareAcceleration();
  return {
    mode: "software",
    reason: "windows-safety-default",
  };
}

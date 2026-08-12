export interface DesktopGraphicsApp {
  disableHardwareAcceleration(): void;
}

export function applyDesktopGraphicsPolicy(
  app: DesktopGraphicsApp,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") {
    app.disableHardwareAcceleration();
  }
}

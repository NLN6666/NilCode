// FILE: ptySpawnOptions.ts
// Purpose: Shared node-pty spawn options, chiefly which ConPTY backend Windows uses.
// Layer: Server terminal infrastructure
// Exports: platform-conditional node-pty options.

/**
 * Windows-only node-pty options.
 *
 * `useConptyDll` switches from the operating system's ConPTY to the copy node-pty
 * bundles (`conpty.dll` + `OpenConsole.exe`). The OS one goes through conhost,
 * and on Windows 11 conhost hands the new console off to whichever "default
 * terminal application" the user configured — so with Windows Terminal selected,
 * every PTY Synara opened popped a visible Terminal window. The bundled backend
 * has no handoff step, so nothing appears.
 *
 * `windowsHide` cannot address this. The window belongs to a WindowsTerminal.exe
 * that COM activation starts under `svchost.exe`, outside Synara's process tree
 * entirely, so no spawn option on our side can suppress it.
 */
const WINDOWS_PTY_OPTIONS = { useConptyDll: true } as const;

export function ptyPlatformSpawnOptions(
  platform: NodeJS.Platform,
): typeof WINDOWS_PTY_OPTIONS | Record<string, never> {
  return platform === "win32" ? WINDOWS_PTY_OPTIONS : {};
}

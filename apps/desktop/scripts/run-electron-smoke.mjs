import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { SYNARA_DESKTOP_SMOKE_USER_DATA_ENV } from "@synara/shared/desktopIdentity";

const directory = mkdtempSync(join(tmpdir(), "synara-electron-smoke-"));
try {
  const child = spawn(electronPath, [process.argv[2]], {
    stdio: "inherit",
    env: { ...process.env, [SYNARA_DESKTOP_SMOKE_USER_DATA_ENV]: directory },
  });
  const [code] = await once(child, "close");
  process.exitCode = code ?? 1;
} finally {
  // Chromium holds profile files until Electron exits, even after windows close.
  rmSync(directory, { recursive: true, force: true });
}

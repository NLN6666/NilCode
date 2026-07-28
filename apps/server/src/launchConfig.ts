// FILE: launchConfig.ts
// Purpose: Read and write a project's `.nilcode/launch.json`, the source of truth for
//          its actions. Parsing/serialization live in `@synara/shared/launchConfig`;
//          this module owns only filesystem access.
// Layer: Server runtime utility used by the WorkspaceEntries service.
//
// Writes go through a temp file + rename so a crashed or concurrent write can
// never leave a half-written config that would wipe every action on next read.
// Unlike `atomicWrite.ts` this keeps default permissions: launch.json is meant
// to be committed and hand-edited, not treated as a secret.

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  LAUNCH_CONFIG_DIRECTORY_NAME,
  LAUNCH_CONFIG_FILE_MAX_BYTES,
  LAUNCH_CONFIG_FILE_NAME,
  type LaunchConfigState,
  type LaunchConfiguration,
} from "@synara/contracts";
import { parseLaunchConfigFile, serializeLaunchConfigFile } from "@synara/shared/launchConfig";

import { expandHomePath } from "./workspaceEntries";

export function launchConfigFilePath(cwd: string): string {
  return path.join(
    path.resolve(expandHomePath(cwd)),
    LAUNCH_CONFIG_DIRECTORY_NAME,
    LAUNCH_CONFIG_FILE_NAME,
  );
}

function emptyState(filePath: string, issues: LaunchConfigState["issues"] = []): LaunchConfigState {
  return { filePath, exists: false, configurations: [], issues };
}

export async function readProjectLaunchConfig(cwd: string): Promise<LaunchConfigState> {
  const filePath = launchConfigFilePath(cwd);

  let raw: string;
  try {
    const handle = await fs.stat(filePath);
    if (!handle.isFile()) {
      return emptyState(filePath, [
        { index: null, message: `${LAUNCH_CONFIG_FILE_NAME} is not a regular file.` },
      ]);
    }
    if (handle.size > LAUNCH_CONFIG_FILE_MAX_BYTES) {
      return emptyState(filePath, [
        {
          index: null,
          message: `${LAUNCH_CONFIG_FILE_NAME} exceeds ${LAUNCH_CONFIG_FILE_MAX_BYTES} bytes.`,
        },
      ]);
    }
    raw = await fs.readFile(filePath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyState(filePath);
    }
    return emptyState(filePath, [
      { index: null, message: cause instanceof Error ? cause.message : String(cause) },
    ]);
  }

  const parsed = parseLaunchConfigFile(raw);
  return {
    filePath,
    exists: true,
    configurations: parsed.configurations,
    issues: parsed.issues,
  };
}

export async function writeProjectLaunchConfig(input: {
  readonly cwd: string;
  readonly configurations: readonly LaunchConfiguration[];
}): Promise<LaunchConfigState> {
  const filePath = launchConfigFilePath(input.cwd);
  const directoryPath = path.dirname(filePath);
  const contents = serializeLaunchConfigFile(input.configurations);
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  await fs.mkdir(directoryPath, { recursive: true });
  try {
    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (cause) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw cause;
  }

  // Re-read rather than echoing the input so callers observe exactly what a
  // subsequent load will see, including any issue the serialized form triggers.
  return readProjectLaunchConfig(input.cwd);
}

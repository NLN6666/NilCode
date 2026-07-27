// FILE: launchConfig.ts
// Purpose: Schemas for the project-scoped `.nilcode/launch.json` launch configuration file
//          and the RPC/push contracts that keep it mirrored into project actions.
// Layer: Shared contracts (schema-only)

import { Schema } from "effect";

import { LocalServerPort, ProcessEnvRecord, ProjectId, TrimmedNonEmptyString } from "./baseSchemas";
import { MAX_SCRIPT_ID_LENGTH } from "./keybindings";
import { ProjectScriptIcon } from "./orchestration";

/** Directory, relative to the project root, holding NilCode's project-scoped config. */
export const LAUNCH_CONFIG_DIRECTORY_NAME = ".nilcode";
export const LAUNCH_CONFIG_FILE_NAME = "launch.json";
export const LAUNCH_CONFIG_RELATIVE_PATH = `${LAUNCH_CONFIG_DIRECTORY_NAME}/${LAUNCH_CONFIG_FILE_NAME}`;
export const LAUNCH_CONFIG_VERSION = "0.0.1";

export const LAUNCH_CONFIGURATIONS_MAX_COUNT = 50;
export const LAUNCH_CONFIGURATION_NAME_MAX_LENGTH = 64;
export const LAUNCH_CONFIGURATION_ARGS_MAX_COUNT = 64;
export const LAUNCH_CONFIGURATION_ARG_MAX_LENGTH = 1_024;
export const LAUNCH_CONFIG_FILE_MAX_BYTES = 256 * 1024;

/**
 * NilCode-specific configuration state that has no VS Code counterpart. Kept in
 * its own namespace so the top level stays recognizable to anyone who has read a
 * `launch.json` before, and so future VS Code fields cannot collide with ours.
 */
export const LaunchConfigurationNilcodeOptions = Schema.Struct({
  /** Stable action id. Generated from `name` on first write when absent. */
  id: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_SCRIPT_ID_LENGTH))),
  icon: Schema.optional(ProjectScriptIcon),
  runOnWorktreeCreate: Schema.optional(Schema.Boolean),
});
export type LaunchConfigurationNilcodeOptions = typeof LaunchConfigurationNilcodeOptions.Type;

/**
 * One launch configuration. Either `command` (a raw shell line) or
 * `runtimeExecutable` (+ optional `runtimeArgs`) supplies the command to run;
 * validation of that either-or lives in `@synara/shared/launchConfig` so both
 * the server writer and the web importer share one rule.
 */
export const LaunchConfiguration = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(LAUNCH_CONFIGURATION_NAME_MAX_LENGTH)),
  command: Schema.optional(TrimmedNonEmptyString),
  runtimeExecutable: Schema.optional(TrimmedNonEmptyString),
  runtimeArgs: Schema.optional(
    Schema.Array(
      Schema.String.check(Schema.isMaxLength(LAUNCH_CONFIGURATION_ARG_MAX_LENGTH)),
    ).check(Schema.isMaxLength(LAUNCH_CONFIGURATION_ARGS_MAX_COUNT)),
  ),
  /** Working directory, relative to the project root. Defaults to the root. */
  cwd: Schema.optional(TrimmedNonEmptyString),
  env: Schema.optional(ProcessEnvRecord),
  port: Schema.optional(LocalServerPort),
  nilcode: Schema.optional(LaunchConfigurationNilcodeOptions),
});
export type LaunchConfiguration = typeof LaunchConfiguration.Type;

export const LaunchConfigFile = Schema.Struct({
  version: Schema.optional(Schema.String),
  configurations: Schema.Array(LaunchConfiguration).check(
    Schema.isMaxLength(LAUNCH_CONFIGURATIONS_MAX_COUNT),
  ),
});
export type LaunchConfigFile = typeof LaunchConfigFile.Type;

/**
 * A non-fatal problem found while loading the file. Malformed entries are
 * skipped rather than failing the whole load, so one bad configuration cannot
 * strand every action in the project.
 */
export const LaunchConfigIssue = Schema.Struct({
  /** Index in `configurations`, or null when the problem is file-level. */
  index: Schema.NullOr(Schema.Int),
  message: Schema.String,
});
export type LaunchConfigIssue = typeof LaunchConfigIssue.Type;

export const LaunchConfigState = Schema.Struct({
  /** Absolute path of the file, whether or not it currently exists. */
  filePath: TrimmedNonEmptyString,
  exists: Schema.Boolean,
  configurations: Schema.Array(LaunchConfiguration),
  issues: Schema.Array(LaunchConfigIssue),
});
export type LaunchConfigState = typeof LaunchConfigState.Type;

export const ProjectReadLaunchConfigInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /**
   * When supplied, the server also mirrors the loaded configurations onto the
   * project's actions. Omitted for read-only inspection of a directory that is
   * not yet a registered project.
   */
  projectId: Schema.optional(ProjectId),
});
export type ProjectReadLaunchConfigInput = typeof ProjectReadLaunchConfigInput.Type;

export const ProjectReadLaunchConfigResult = LaunchConfigState;
export type ProjectReadLaunchConfigResult = typeof ProjectReadLaunchConfigResult.Type;

/**
 * Replace the whole `configurations` array. Whole-file replacement (rather than
 * per-entry patching) keeps the write path a single atomic rename and makes the
 * caller's intent unambiguous when the file changed underneath it.
 */
export const ProjectWriteLaunchConfigInput = Schema.Struct({
  projectId: ProjectId,
  cwd: TrimmedNonEmptyString,
  configurations: Schema.Array(LaunchConfiguration).check(
    Schema.isMaxLength(LAUNCH_CONFIGURATIONS_MAX_COUNT),
  ),
});
export type ProjectWriteLaunchConfigInput = typeof ProjectWriteLaunchConfigInput.Type;

export const ProjectWriteLaunchConfigResult = LaunchConfigState;
export type ProjectWriteLaunchConfigResult = typeof ProjectWriteLaunchConfigResult.Type;

/** Push payload emitted when a watched `launch.json` is created, changed, or removed. */
export const ProjectLaunchConfigEvent = Schema.Struct({
  projectId: ProjectId,
  state: LaunchConfigState,
});
export type ProjectLaunchConfigEvent = typeof ProjectLaunchConfigEvent.Type;

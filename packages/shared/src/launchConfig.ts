// FILE: launchConfig.ts
// Purpose: Pure translation between `.nilcode/launch.json` configurations and project
//          actions (ProjectScript), plus lenient parsing and canonical serialization.
// Layer: Shared runtime utility consumed by the server mirror and the web importer.
//
// The file is the source of truth for a project's actions, so every round trip
// (file -> action -> file) must be lossless: anything an action carries has to
// have a home in the configuration, or an external edit would silently erase it.

import {
  LAUNCH_CONFIGURATIONS_MAX_COUNT,
  LAUNCH_CONFIG_VERSION,
  LaunchConfigFile,
  LaunchConfiguration,
  type LaunchConfigIssue,
  type ProjectScript,
} from "@synara/contracts";
import { Schema } from "effect";

import { nextProjectScriptId } from "./projectScripts";

export interface ParsedLaunchConfig {
  readonly configurations: readonly LaunchConfiguration[];
  readonly issues: readonly LaunchConfigIssue[];
}

const decodeLaunchConfiguration = Schema.decodeUnknownSync(LaunchConfiguration);
const decodeLaunchConfigFile = Schema.decodeUnknownSync(LaunchConfigFile);

function issueMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// Only quote when the token would otherwise be split or reinterpreted. Leaving
// ordinary tokens bare keeps the generated command line readable and identical
// to what a user would type, which matters because the command is also shown in
// the action editor.
const SHELL_SAFE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function quoteShellToken(token: string): string {
  if (token.length === 0) {
    return '""';
  }
  if (SHELL_SAFE_TOKEN.test(token)) {
    return token;
  }
  return `"${token.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Resolve the shell command a configuration runs. `command` wins when both are
 * present so a hand-written override is never silently ignored.
 */
export function launchConfigurationCommand(configuration: LaunchConfiguration): string | null {
  const command = configuration.command?.trim();
  if (command) {
    return command;
  }
  const executable = configuration.runtimeExecutable?.trim();
  if (!executable) {
    return null;
  }
  const args = (configuration.runtimeArgs ?? []).map(quoteShellToken);
  return [quoteShellToken(executable), ...args].join(" ");
}

/**
 * Parse raw file contents. Malformed entries are dropped with an issue rather
 * than failing the load: one bad configuration must not strand a project's
 * remaining actions.
 */
export function parseLaunchConfigFile(raw: string): ParsedLaunchConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return {
      configurations: [],
      issues: [{ index: null, message: `Invalid JSON: ${issueMessage(cause)}` }],
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      configurations: [],
      issues: [{ index: null, message: "Expected a JSON object at the top level." }],
    };
  }

  const rawConfigurations = (parsed as { configurations?: unknown }).configurations;
  if (rawConfigurations === undefined) {
    return {
      configurations: [],
      issues: [{ index: null, message: 'Missing a "configurations" array.' }],
    };
  }
  if (!Array.isArray(rawConfigurations)) {
    return {
      configurations: [],
      issues: [{ index: null, message: '"configurations" must be an array.' }],
    };
  }

  const configurations: LaunchConfiguration[] = [];
  const issues: LaunchConfigIssue[] = [];
  const seenNames = new Set<string>();

  for (const [index, entry] of rawConfigurations.entries()) {
    if (configurations.length >= LAUNCH_CONFIGURATIONS_MAX_COUNT) {
      issues.push({
        index,
        message: `Ignored: more than ${LAUNCH_CONFIGURATIONS_MAX_COUNT} configurations.`,
      });
      continue;
    }
    let configuration: LaunchConfiguration;
    try {
      configuration = decodeLaunchConfiguration(entry);
    } catch (cause) {
      issues.push({ index, message: issueMessage(cause) });
      continue;
    }
    if (launchConfigurationCommand(configuration) === null) {
      issues.push({
        index,
        message: `"${configuration.name}" needs either "command" or "runtimeExecutable".`,
      });
      continue;
    }
    const nameKey = configuration.name.toLowerCase();
    if (seenNames.has(nameKey)) {
      issues.push({ index, message: `Duplicate configuration name "${configuration.name}".` });
      continue;
    }
    seenNames.add(nameKey);
    configurations.push(configuration);
  }

  return { configurations, issues };
}

/** Canonical on-disk form. Two-space indent and a trailing newline keep diffs clean. */
export function serializeLaunchConfigFile(configurations: readonly LaunchConfiguration[]): string {
  const file = decodeLaunchConfigFile({
    version: LAUNCH_CONFIG_VERSION,
    configurations,
  } satisfies LaunchConfigFile);
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Convert configurations to actions. Ids come from `nilcode.id` when pinned and
 * are otherwise derived from the name, deduplicated across the batch.
 */
export function launchConfigurationsToProjectScripts(
  configurations: readonly LaunchConfiguration[],
): ProjectScript[] {
  const takenIds = new Set<string>();
  const scripts: ProjectScript[] = [];

  for (const configuration of configurations) {
    const command = launchConfigurationCommand(configuration);
    if (command === null) {
      continue;
    }
    const pinnedId = configuration.nilcode?.id;
    const id =
      pinnedId && !takenIds.has(pinnedId)
        ? pinnedId
        : nextProjectScriptId(configuration.name, takenIds);
    takenIds.add(id);
    scripts.push({
      id,
      name: configuration.name,
      command,
      icon: configuration.nilcode?.icon ?? "play",
      runOnWorktreeCreate: configuration.nilcode?.runOnWorktreeCreate ?? false,
      port: configuration.port ?? null,
    });
  }

  return scripts;
}

/**
 * Convert an action back to a configuration, preserving the structured
 * `runtimeExecutable`/`runtimeArgs` shape of the entry it came from when the
 * command is unchanged. Without that, editing an action's name would rewrite a
 * hand-authored argv entry into a flat command string.
 */
export function projectScriptToLaunchConfiguration(
  script: ProjectScript,
  previous?: LaunchConfiguration,
): LaunchConfiguration {
  const nilcode = {
    id: script.id,
    icon: script.icon,
    ...(script.runOnWorktreeCreate ? { runOnWorktreeCreate: true } : {}),
  };
  const base = {
    name: script.name,
    ...(previous?.cwd ? { cwd: previous.cwd } : {}),
    ...(previous?.env ? { env: previous.env } : {}),
    ...(script.port ? { port: script.port } : {}),
    nilcode,
  };

  const keepsStructuredForm =
    previous !== undefined &&
    previous.command === undefined &&
    previous.runtimeExecutable !== undefined &&
    launchConfigurationCommand(previous) === script.command;

  if (keepsStructuredForm) {
    return {
      ...base,
      runtimeExecutable: previous.runtimeExecutable,
      ...(previous.runtimeArgs ? { runtimeArgs: previous.runtimeArgs } : {}),
    };
  }

  return { ...base, command: script.command };
}

/**
 * Project the full action list back onto the file, matching each action to the
 * configuration it came from by id (falling back to name for entries authored
 * by hand without a pinned id).
 */
export function projectScriptsToLaunchConfigurations(input: {
  readonly scripts: readonly ProjectScript[];
  readonly previous?: readonly LaunchConfiguration[];
}): LaunchConfiguration[] {
  const previousById = new Map<string, LaunchConfiguration>();
  const previousByName = new Map<string, LaunchConfiguration>();
  for (const configuration of input.previous ?? []) {
    const id = configuration.nilcode?.id;
    if (id) {
      previousById.set(id, configuration);
    }
    previousByName.set(configuration.name.toLowerCase(), configuration);
  }

  return input.scripts.map((script) => {
    const previous = previousById.get(script.id) ?? previousByName.get(script.name.toLowerCase());
    return projectScriptToLaunchConfiguration(script, previous);
  });
}

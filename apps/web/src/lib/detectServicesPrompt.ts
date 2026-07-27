// FILE: detectServicesPrompt.ts
// Purpose: Build the prompt that asks the coding agent to write a project's
//          `.nilcode/launch.json` by inspecting the project itself.
// Layer: Web prompt construction (pure)
// Exports: buildDetectServicesPrompt, appendPromptToDraft
//
// Kept as a standalone pure module rather than inlined at the call site: the
// prompt is the actual product of this feature and will be tuned repeatedly, so
// it needs to be readable and testable on its own.

import {
  LAUNCH_CONFIG_RELATIVE_PATH,
  LAUNCH_CONFIG_VERSION,
  LAUNCH_CONFIGURATIONS_MAX_COUNT,
  type LaunchConfiguration,
} from "@synara/contracts";

/**
 * The file shape, spelled out for the agent. Inlined rather than referenced by
 * URL or skill name so the prompt works with every provider Synara supports,
 * none of which share a documentation surface.
 */
const FILE_FORMAT_REFERENCE = `{
  "version": "${LAUNCH_CONFIG_VERSION}",
  "configurations": [
    {
      "name": "erp-web",
      "runtimeExecutable": "dotnet",
      "runtimeArgs": ["run", "--project", "src/Erp.Web", "--launch-profile", "http"],
      "port": 5299
    }
  ]
}`;

const FIELD_REFERENCE = [
  "- `name` (required): short, unique, kebab-case. This becomes the action label in the UI.",
  "- `runtimeExecutable` + `runtimeArgs`: preferred form. Argv array, no shell quoting.",
  "- `command`: single-string alternative when the command is genuinely a shell one-liner.",
  "  Provide either `command` or `runtimeExecutable`, not both.",
  "- `cwd` (optional): relative to the project root. Omit when the command runs from the root.",
  "- `env` (optional): object of string values. Never put secrets, tokens, or passwords here —",
  "  this file is meant to be committed.",
  "- `port` (optional): the TCP port this service listens on.",
].join("\n");

function describeExisting(configurations: readonly LaunchConfiguration[]): string {
  if (configurations.length === 0) {
    return "The file does not exist yet. Create it.";
  }
  const names = configurations.map((configuration) => `\`${configuration.name}\``).join(", ");
  return [
    `The file already exists and defines ${configurations.length} configuration(s): ${names}.`,
    "Preserve every existing entry exactly as written — including its `nilcode` block if present —",
    "and only append configurations that are genuinely missing. Do not reorder, rename, or reformat",
    "what is already there.",
  ].join("\n");
}

/**
 * Ask the agent to inspect the project and write its launch configurations.
 *
 * The prompt is deliberately explicit about two things the model otherwise gets
 * wrong: `port` is what drives preview readiness, so a service without it is
 * only half-configured; and the project must be understood by reading its build
 * files, not by starting servers to see what happens.
 */
export function buildDetectServicesPrompt(input: {
  readonly projectCwd: string;
  readonly existingConfigurations?: readonly LaunchConfiguration[];
}): string {
  const existing = input.existingConfigurations ?? [];
  return [
    `Inspect this project and write its runnable services into \`${LAUNCH_CONFIG_RELATIVE_PATH}\`.`,
    "",
    `Project root: ${input.projectCwd}`,
    `Target file: ${input.projectCwd}/${LAUNCH_CONFIG_RELATIVE_PATH}`,
    "",
    "## What to look for",
    "",
    "Long-running services a developer starts while working: dev servers, API hosts, background",
    "workers, docker-compose stacks. Read the project's own build and config files to find them —",
    "`package.json` scripts, `*.csproj` / `Properties/launchSettings.json`, `Makefile`,",
    "`docker-compose.yml`, `pyproject.toml`, `Cargo.toml`, framework config, and the README.",
    "",
    "Skip one-shot commands. Tests, linters, formatters, and build steps do not belong here.",
    "",
    "## Rules",
    "",
    "1. Do NOT start any service to find out what it does. Infer everything from configuration.",
    `2. Set \`port\` on every service that listens on one. Read the real value from the project's`,
    "   config (launchSettings.json, vite.config, application.yml, compose port mappings, ...) —",
    "   do not guess a conventional default. Without an accurate port the preview panel cannot",
    "   tell when the service is ready.",
    "3. Omit `port` entirely for services that listen on nothing.",
    `4. At most ${LAUNCH_CONFIGURATIONS_MAX_COUNT} configurations.`,
    "5. If the project has no runnable services, say so and write nothing.",
    "",
    "## File format",
    "",
    "```json",
    FILE_FORMAT_REFERENCE,
    "```",
    "",
    FIELD_REFERENCE,
    "",
    "## Current state",
    "",
    describeExisting(existing),
    "",
    "When you are done, list each configuration you added and the file you read to determine its port.",
  ].join("\n");
}

/**
 * Place the prompt in the composer without destroying what is already there.
 *
 * Composer drafts are persisted, so overwriting one silently deletes the user's
 * own writing. Appending costs them one keystroke to undo; overwriting costs
 * them their text.
 */
export function appendPromptToDraft(draft: string, prompt: string): string {
  const trimmed = draft.trimEnd();
  return trimmed.length === 0 ? prompt : `${trimmed}\n\n${prompt}`;
}

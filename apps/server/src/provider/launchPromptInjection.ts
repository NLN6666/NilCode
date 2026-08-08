// FILE: launchPromptInjection.ts
// Purpose: Builds the per-turn instructions injected when the user enables the
//          background-service mode via the composer's `@Launch` mention.
// Layer: Server provider helper
// Exports: LAUNCH_INSTRUCTIONS_CORE, buildLaunchInstructions
//
// Two subsystems share the "launch" name and both feed this injection:
//   - the daemon broker (apps/server/src/daemon/) supervises processes at runtime
//     and backs the eight `synara_*_daemon` agent tools;
//   - `.nilcode/launch.json` (packages/contracts/src/launchConfig.ts) is the
//     project's static declaration of what is runnable.
// They are separate systems, but to the user they are one thing — "start my
// server" — so `@Launch` reports both: what is running now, and what this
// project already knows how to run.

import type { DaemonSnapshot, LaunchConfiguration } from "@synara/contracts";
import { LAUNCH_CONFIG_RELATIVE_PATH } from "@synara/contracts";
import { launchConfigurationCommand } from "@synara/shared/launchConfig";

const OPEN_TAG = "<background_service_mode>";
const CLOSE_TAG = "</background_service_mode>";

/**
 * The static half of the injection.
 *
 * Deliberately advisory rather than prohibitive. A user who types `@Launch` is
 * sometimes only asking to read an existing service's log, and a hard "never run
 * a foreground command" rule would make the model refuse reasonable work. What
 * the model actually lacks is not permission but awareness: it defaults to a
 * blocking shell command because that is what it does everywhere else.
 *
 * The two bullets are the failure modes the tool descriptions alone do not
 * prevent — a daemon started without `ready` gives no usable signal, and force
 * stopping a stateful server destroys data.
 */
export const LAUNCH_INSTRUCTIONS_CORE = [
  "The user typed @Launch. Synara can supervise long-running processes for you. A",
  "service started with synara_start_daemon keeps running across turns under a name",
  "you choose; you can then tail its output with synara_read_daemon_logs, drive its",
  "console with synara_send_daemon_input, and stop or restart it later by that name.",
  "Reach for this instead of running a server as a foreground shell command, which",
  "blocks until the process exits and leaves you unable to interact with it.",
  "",
  "Two things the tool schemas do not make obvious:",
  "- Declare `ready` when you start a service — a log regex, a TCP port, or both.",
  "  Without it you have no reliable signal for when the service is actually usable,",
  "  and you end up guessing with sleeps.",
  "- Stateful servers need their own shutdown command before synara_stop_daemon.",
  "  Send `stop` to a Minecraft server through synara_send_daemon_input and wait for",
  "  it to exit; force-killing one can corrupt the world save.",
].join("\n");

function describeDaemon(daemon: DaemonSnapshot): string {
  const details: string[] = [daemon.state];
  if (daemon.pid !== null) {
    details.push(`pid ${daemon.pid}`);
  }
  if (daemon.exitCode !== null) {
    details.push(`exit ${daemon.exitCode}`);
  }
  return `- ${daemon.name} — ${details.join(", ")}`;
}

function renderDaemonSection(daemons: ReadonlyArray<DaemonSnapshot>): string {
  if (daemons.length === 0) {
    return "Nothing is under supervision right now.";
  }
  return ["Currently supervised:", ...daemons.map(describeDaemon)].join("\n");
}

function describeConfiguration(configuration: LaunchConfiguration): string {
  const command = launchConfigurationCommand(configuration);
  const qualifiers: string[] = [];
  if (configuration.cwd !== undefined) {
    qualifiers.push(`cwd: ${configuration.cwd}`);
  }
  if (configuration.port !== undefined) {
    qualifiers.push(`port ${configuration.port}`);
  }
  const suffix = qualifiers.length > 0 ? ` (${qualifiers.join(", ")})` : "";
  return command === null
    ? `- ${configuration.name}${suffix}`
    : `- ${configuration.name} — ${command}${suffix}`;
}

function renderConfigurationSection(
  configurations: ReadonlyArray<LaunchConfiguration>,
): string | null {
  if (configurations.length === 0) {
    return null;
  }
  return [
    `This project already declares these services in \`${LAUNCH_CONFIG_RELATIVE_PATH}\`.`,
    "Reuse a declaration as-is when the user asks for that service rather than",
    "inventing a command line:",
    ...configurations.map(describeConfiguration),
  ].join("\n");
}

function normalizeTargetKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The section that replaces the full listing when the user wrote `@Launch:<name>`.
 *
 * Unmatched names are reported rather than dropped. Silently omitting one would
 * read as "this project declares nothing by that name" only if the model already
 * knew the full list — otherwise it looks like the user named nothing at all,
 * and the model invents a command line for a service it was never shown.
 */
function renderTargetedConfigurationSection(input: {
  readonly targets: ReadonlyArray<string>;
  readonly configurations: ReadonlyArray<LaunchConfiguration>;
}): string {
  const byKey = new Map(
    input.configurations.map((configuration) => [
      normalizeTargetKey(configuration.name),
      configuration,
    ]),
  );
  const matched: LaunchConfiguration[] = [];
  const unmatched: string[] = [];
  for (const target of input.targets) {
    const configuration = byKey.get(normalizeTargetKey(target));
    if (configuration) {
      matched.push(configuration);
    } else {
      unmatched.push(target);
    }
  }

  const lines = [
    input.targets.length === 1
      ? `The user pointed this turn at one service: ${input.targets[0]}.`
      : `The user pointed this turn at these services: ${input.targets.join(", ")}.`,
  ];
  if (matched.length > 0) {
    lines.push(
      "",
      `Declared in \`${LAUNCH_CONFIG_RELATIVE_PATH}\` — run them as written:`,
      ...matched.map(describeConfiguration),
    );
  }
  if (unmatched.length > 0) {
    lines.push(
      "",
      `Not declared in \`${LAUNCH_CONFIG_RELATIVE_PATH}\`: ${unmatched.join(", ")}.`,
      "Work out how to run them from the project itself, and offer to record the",
      "result in that file so the user does not have to explain it again.",
    );
  }
  return lines.join("\n");
}

function render(sections: ReadonlyArray<string>): string {
  return [OPEN_TAG, sections.join("\n\n"), CLOSE_TAG].join("\n");
}

/**
 * Build the background-service instructions for one turn.
 *
 * The core block is all-or-nothing, matching `buildColorPreviewInstructions`: a
 * truncated explanation of how to start a daemon would teach the model a broken
 * procedure. The two snapshot sections degrade independently — dropping them
 * only costs the model information it can recover with a tool call, so they are
 * appended one at a time and the first that does not fit is left out along with
 * everything after it.
 */
export function buildLaunchInstructions(input: {
  readonly maxChars: number;
  readonly daemons: ReadonlyArray<DaemonSnapshot>;
  readonly configurations: ReadonlyArray<LaunchConfiguration>;
  /** Services named by `@Launch:<name>`. Empty means the bare `@Launch` mode. */
  readonly targets?: ReadonlyArray<string>;
}): string {
  const core = render([LAUNCH_INSTRUCTIONS_CORE]);
  if (input.maxChars <= 0 || core.length > input.maxChars) {
    return "";
  }

  const targets = input.targets ?? [];
  // A targeted turn swaps the full catalog for the named services. Listing both
  // would bury the one thing the user actually pointed at.
  const configurationSection =
    targets.length > 0
      ? renderTargetedConfigurationSection({ targets, configurations: input.configurations })
      : renderConfigurationSection(input.configurations);

  const optionalSections = [renderDaemonSection(input.daemons), configurationSection].filter(
    (section): section is string => section !== null,
  );

  const accepted: string[] = [LAUNCH_INSTRUCTIONS_CORE];
  let rendered = core;
  for (const section of optionalSections) {
    const candidate = render([...accepted, section]);
    if (candidate.length > input.maxChars) {
      break;
    }
    accepted.push(section);
    rendered = candidate;
  }
  return rendered;
}

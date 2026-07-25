/**
 * Open - Browser/editor launch service interface.
 *
 * Owns process launch helpers for opening URLs in a browser and workspace
 * paths in a configured editor.
 *
 * @module Open
 */
import { spawn } from "node:child_process";
import { constants, statSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import pathWin32 from "node:path/win32";

import { EDITORS, type EditorId } from "@synara/contracts";
import { prepareWindowsSafeProcess, resolveWindowsSystemRoot } from "@synara/shared/windowsProcess";
import { ServiceMap, Schema, Effect, Layer } from "effect";
import {
  getEditorMacApplications,
  getEditorWindowsStorePackages,
  getEditorWindowsUriScheme,
  resolveAvailableMacApplication,
  resolveWindowsStorePackageInstallLocation,
  type EditorDefinition,
} from "./editorAppDiscovery";

// ==============================
// Definitions
// ==============================

export class OpenError extends Schema.TaggedErrorClass<OpenError>()("OpenError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface OpenInEditorInput {
  readonly cwd: string;
  readonly editor: EditorId;
}

export interface EditorLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

interface CommandAvailabilityOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
}

const TARGET_WITH_POSITION_PATTERN = /^(.*?):(\d+)(?::(\d+))?$/;

function parseTargetPathAndPosition(target: string): {
  path: string;
  line: string | undefined;
  column: string | undefined;
} | null {
  const match = TARGET_WITH_POSITION_PATTERN.exec(target);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    path: match[1],
    line: match[2],
    column: match[3],
  };
}

function resolveCommandEditorArgs(
  editor: EditorDefinition,
  target: string,
  command?: string,
): ReadonlyArray<string> {
  const parsedTarget = parseTargetPathAndPosition(target);

  switch (editor.launchStyle) {
    case "direct-path":
      return [target];
    case "goto":
      return parsedTarget ? ["--goto", target] : [target];
    case "line-column": {
      if (!parsedTarget) {
        return [target];
      }

      const { path, line, column } = parsedTarget;
      return [...(line ? ["--line", line] : []), ...(column ? ["--column", column] : []), path];
    }
    case "terminal-working-directory":
      return resolveTerminalCommandArgs(command ?? editor.commands?.[0] ?? editor.id, target);
  }
}

// Converts the shared launch metadata into `open -a` arguments for macOS-only apps.
function resolveMacApplicationArgs(
  editor: EditorDefinition,
  target: string,
): ReadonlyArray<string> {
  switch (editor.launchStyle) {
    case "terminal-working-directory":
      if (editor.id === "ghostty") {
        return ["--args", `--working-directory=${resolveTerminalWorkingDirectory(target)}`];
      }
      return [resolveTerminalWorkingDirectory(target)];
    case "line-column":
      return ["--args", ...resolveCommandEditorArgs(editor, target)];
    case "direct-path":
    case "goto":
      return [target];
  }
}

function resolveMacOpenArgs(
  editor: EditorDefinition,
  appName: string,
  target: string,
): ReadonlyArray<string> {
  if (editor.id === "ghostty") {
    return ["-a", appName, resolveTerminalWorkingDirectory(target)];
  }

  return ["-a", appName, ...resolveMacApplicationArgs(editor, target)];
}

async function resolveAvailableCommand(
  commands: ReadonlyArray<string>,
  options: CommandAvailabilityOptions = {},
): Promise<string | null> {
  for (const command of commands) {
    if (await isCommandAvailable(command, options)) {
      return command;
    }
  }

  return null;
}

function fileManagerCommandForPlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "open";
    case "win32":
      return "explorer";
    default:
      return "xdg-open";
  }
}

// Terminal integrations should receive a directory even when the source target is file:line:column.
function resolveTerminalWorkingDirectory(target: string): string {
  const targetPath = parseTargetPathAndPosition(target)?.path ?? target;

  try {
    const stat = statSync(targetPath);
    return stat.isDirectory() ? targetPath : dirname(targetPath);
  } catch {
    return extname(targetPath).length > 0 ? dirname(targetPath) : targetPath;
  }
}

function normalizeCommandName(command: string): string {
  const executableName = command.split(/[\\/]/).pop() ?? command;
  return executableName.toLowerCase().replace(/\.(?:bat|cmd|com|exe)$/i, "");
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

type TerminalArgsBuilder = (workingDirectory: string) => ReadonlyArray<string>;

const DEFAULT_TERMINAL_ARGS: TerminalArgsBuilder = (workingDirectory) => [
  `--working-directory=${workingDirectory}`,
];

const TERMINAL_ARGS_BY_COMMAND: Readonly<Record<string, TerminalArgsBuilder>> = {
  wt: (workingDirectory) => ["-d", workingDirectory],
  cmd: (workingDirectory) => ["/K", "cd", "/d", workingDirectory],
  powershell: (workingDirectory) => [
    "-NoExit",
    "-Command",
    `Set-Location -LiteralPath ${quotePowerShellLiteral(workingDirectory)}`,
  ],
  pwsh: (workingDirectory) => [
    "-NoExit",
    "-Command",
    `Set-Location -LiteralPath ${quotePowerShellLiteral(workingDirectory)}`,
  ],
  konsole: (workingDirectory) => ["--workdir", workingDirectory],
  kitty: (workingDirectory) => ["--directory", workingDirectory],
  wezterm: (workingDirectory) => ["start", "--cwd", workingDirectory],
  ghostty: DEFAULT_TERMINAL_ARGS,
  // Muxy's CLI opens a project from a bare path, matching its `muxy .` flow.
  muxy: (workingDirectory) => [workingDirectory],
  warp: DEFAULT_TERMINAL_ARGS,
};

function resolveTerminalCommandArgs(command: string, target: string): ReadonlyArray<string> {
  const workingDirectory = resolveTerminalWorkingDirectory(target);
  const buildArgs =
    TERMINAL_ARGS_BY_COMMAND[normalizeCommandName(command)] ?? DEFAULT_TERMINAL_ARGS;
  return buildArgs(workingDirectory);
}

function shouldPreferMacApplicationLaunch(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
): boolean {
  return platform === "darwin" && editor.launchStyle === "terminal-working-directory";
}

function shouldUseImplicitMacApplicationFallback(editor: EditorDefinition): boolean {
  return editor.id === "ghostty" || editor.id === "terminal";
}

function resolveFallbackEditorCommand(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
): string | null {
  if (editor.id === "terminal") {
    return platform === "win32" ? "cmd" : "x-terminal-emulator";
  }

  return editor.commands?.[0] ?? null;
}

function encodeWindowsEditorUriPath(targetPath: string): string {
  return targetPath
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment).replaceAll("%3A", ":"))
    .join("/");
}

function resolveWindowsEditorUri(scheme: string, target: string): string {
  const parsedTarget = parseTargetPathAndPosition(target);
  const targetPath = parsedTarget?.path ?? target;
  const encodedPath = encodeWindowsEditorUriPath(targetPath);
  // UNC paths normalize to //server/share; adding another slash changes the network path.
  const filePathSeparator = encodedPath.startsWith("//") ? "" : "/";
  const directorySuffix =
    !parsedTarget && statSync(targetPath, { throwIfNoEntry: false })?.isDirectory() === true
      ? "/"
      : "";
  const positionSuffix = parsedTarget?.line
    ? `:${parsedTarget.line}${parsedTarget.column ? `:${parsedTarget.column}` : ""}`
    : "";

  return `${scheme}://file${filePathSeparator}${encodedPath}${directorySuffix}${positionSuffix}`;
}

export function resolveWindowsEditorUriLaunch(
  editor: EditorDefinition,
  target: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): EditorLaunch | null {
  const scheme = getEditorWindowsUriScheme(editor);
  if (platform !== "win32" || !scheme) return null;

  return {
    command: pathWin32.join(resolveWindowsSystemRoot(env), "explorer.exe"),
    args: [resolveWindowsEditorUri(scheme, target)],
  };
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, "");
}

function resolvePathEnvironmentVariable(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? env.Path ?? env.path ?? "";
}

function resolveWindowsPathExtensions(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const rawValue = env.PATHEXT;
  const fallback = [".COM", ".EXE", ".BAT", ".CMD"];
  if (!rawValue) return fallback;

  const parsed = rawValue
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}

function resolveCommandCandidates(
  command: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (platform !== "win32") return [command];
  const extension = extname(command);
  const normalizedExtension = extension.toUpperCase();

  // Only the upper-case spelling is probed: Windows filesystems are
  // case-insensitive, so `foo.EXE` already matches an on-disk `foo.exe`. Probing
  // both spellings doubled the stat count for no additional reach.
  if (extension.length > 0 && windowsPathExtensions.includes(normalizedExtension)) {
    const commandWithoutExtension = command.slice(0, -extension.length);
    return Array.from(new Set([command, `${commandWithoutExtension}${normalizedExtension}`]));
  }

  return Array.from(new Set(windowsPathExtensions.map((extension) => `${command}${extension}`)));
}

async function isExecutableFile(
  filePath: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>,
): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return false;
    if (platform === "win32") {
      const extension = extname(filePath);
      if (extension.length === 0) return false;
      return windowsPathExtensions.includes(extension.toUpperCase());
    }
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePathDelimiter(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

// A miss has to probe every PATH entry, so the probes run in batches rather than
// one await at a time. The bound keeps a long PATH from flooding the libuv
// threadpool and starving unrelated filesystem work on the same event loop.
const PATH_PROBE_CONCURRENCY = 32;

async function anyExecutableFile(
  filePaths: ReadonlyArray<string>,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>,
): Promise<boolean> {
  for (let index = 0; index < filePaths.length; index += PATH_PROBE_CONCURRENCY) {
    const batch = filePaths.slice(index, index + PATH_PROBE_CONCURRENCY);
    const found = await Promise.all(
      batch.map((filePath) => isExecutableFile(filePath, platform, windowsPathExtensions)),
    );
    if (found.includes(true)) return true;
  }
  return false;
}

interface CachedCommandAvailability {
  readonly value: boolean;
  readonly expiresAt: number;
}

// Short enough that installing an editor shows up without a restart, long enough
// that a burst of config reads and reconnects costs one scan instead of dozens.
const COMMAND_AVAILABILITY_CACHE_TTL_MS = 30_000;
const commandAvailabilityCache = new Map<string, CachedCommandAvailability>();

function resolveCommandAvailabilityCacheKey(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string {
  return JSON.stringify({
    command,
    platform,
    path: resolvePathEnvironmentVariable(env),
    pathExt: env.PATHEXT ?? "",
  });
}

function readCommandAvailabilityCache(key: string, now: number): boolean | undefined {
  const cached = commandAvailabilityCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt > now) return cached.value;
  commandAvailabilityCache.delete(key);
  return undefined;
}

export function clearCommandAvailabilityCache(): void {
  commandAvailabilityCache.clear();
}

async function probeCommandAvailability(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const windowsPathExtensions = platform === "win32" ? resolveWindowsPathExtensions(env) : [];
  const commandCandidates = resolveCommandCandidates(command, platform, windowsPathExtensions);

  if (command.includes("/") || command.includes("\\")) {
    return anyExecutableFile(commandCandidates, platform, windowsPathExtensions);
  }

  const pathValue = resolvePathEnvironmentVariable(env);
  if (pathValue.length === 0) return false;
  const pathEntries = pathValue
    .split(resolvePathDelimiter(platform))
    .map((entry) => stripWrappingQuotes(entry.trim()))
    .filter((entry) => entry.length > 0);

  return anyExecutableFile(
    pathEntries.flatMap((pathEntry) =>
      commandCandidates.map((candidate) => join(pathEntry, candidate)),
    ),
    platform,
    windowsPathExtensions,
  );
}

export async function isCommandAvailable(
  command: string,
  options: CommandAvailabilityOptions = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const now = Date.now();
  const cacheKey = resolveCommandAvailabilityCacheKey(command, platform, env);

  const cached = readCommandAvailabilityCache(cacheKey, now);
  if (cached !== undefined) return cached;

  const value = await probeCommandAvailability(command, platform, env);
  commandAvailabilityCache.set(cacheKey, {
    value,
    expiresAt: now + COMMAND_AVAILABILITY_CACHE_TTL_MS,
  });
  return value;
}

export async function resolveAvailableEditors(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadonlyArray<EditorId>> {
  const available: EditorId[] = [];

  for (const editor of EDITORS) {
    if (editor.commands !== null) {
      if ((await resolveAvailableCommand(editor.commands, { platform, env })) !== null) {
        available.push(editor.id);
        continue;
      }
    }

    if (resolveAvailableMacApplication(getEditorMacApplications(editor), platform, env) !== null) {
      available.push(editor.id);
      continue;
    }

    if (
      resolveWindowsStorePackageInstallLocation(
        getEditorWindowsStorePackages(editor),
        platform,
        env,
      ) !== null
    ) {
      available.push(editor.id);
      continue;
    }

    if (editor.id === "file-manager") {
      const command = fileManagerCommandForPlatform(platform);
      if (await isCommandAvailable(command, { platform, env })) {
        available.push(editor.id);
      }
    }
  }

  return available;
}

/**
 * OpenShape - Service API for browser and editor launch actions.
 */
export interface OpenShape {
  /**
   * Open a URL target in the default browser.
   */
  readonly openBrowser: (target: string) => Effect.Effect<void, OpenError>;

  /**
   * Open a workspace path in a selected editor integration.
   *
   * Launches the editor as a detached process so server startup is not blocked.
   */
  readonly openInEditor: (input: OpenInEditorInput) => Effect.Effect<void, OpenError>;
}

/**
 * Open - Service tag for browser/editor launch operations.
 */
export class Open extends ServiceMap.Service<Open, OpenShape>()("synara/open") {}

// ==============================
// Implementations
// ==============================

export const resolveEditorLaunch = Effect.fnUntraced(function* (
  input: OpenInEditorInput,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<EditorLaunch, OpenError> {
  const editorDef = EDITORS.find((editor) => editor.id === input.editor);
  if (!editorDef) {
    return yield* new OpenError({ message: `Unknown editor: ${input.editor}` });
  }

  const preferredMacApplication = shouldPreferMacApplicationLaunch(editorDef, platform)
    ? (resolveAvailableMacApplication(getEditorMacApplications(editorDef), platform, env) ??
      (shouldUseImplicitMacApplicationFallback(editorDef)
        ? (getEditorMacApplications(editorDef)?.[0] ?? null)
        : null))
    : null;
  if (preferredMacApplication) {
    return {
      command: "open",
      args: resolveMacOpenArgs(editorDef, preferredMacApplication, input.cwd),
    };
  }

  if (editorDef.commands) {
    const command = yield* Effect.promise(() =>
      resolveAvailableCommand(editorDef.commands ?? [], { platform, env }),
    );
    if (command) {
      return {
        command,
        args: resolveCommandEditorArgs(editorDef, input.cwd, command),
      };
    }
  }

  const windowsUriLaunch = resolveWindowsEditorUriLaunch(editorDef, input.cwd, platform, env);
  if (windowsUriLaunch) {
    return windowsUriLaunch;
  }

  const macApplication =
    resolveAvailableMacApplication(getEditorMacApplications(editorDef), platform, env) ??
    (platform === "darwin" ? (getEditorMacApplications(editorDef)?.[0] ?? null) : null);
  if (macApplication) {
    return {
      command: "open",
      args: resolveMacOpenArgs(editorDef, macApplication, input.cwd),
    };
  }

  if (editorDef.commands) {
    const fallbackCommand = resolveFallbackEditorCommand(editorDef, platform);
    if (!fallbackCommand) {
      return yield* new OpenError({ message: `Unsupported editor: ${input.editor}` });
    }
    return {
      command: fallbackCommand,
      args: resolveCommandEditorArgs(editorDef, input.cwd, fallbackCommand),
    };
  }

  if (editorDef.id !== "file-manager") {
    return yield* new OpenError({ message: `Unsupported editor: ${input.editor}` });
  }

  return { command: fileManagerCommandForPlatform(platform), args: [input.cwd] };
});

function editorLaunchesEqual(left: EditorLaunch, right: EditorLaunch): boolean {
  return left.command === right.command && left.args.join("\0") === right.args.join("\0");
}

function launchDetachedWithEditorFallback(
  input: OpenInEditorInput,
  launch: EditorLaunch,
): Effect.Effect<void, OpenError> {
  return launchDetached(launch).pipe(
    Effect.catch((primaryError) => {
      const editorDef = EDITORS.find((editor) => editor.id === input.editor);
      const fallbackLaunch = editorDef ? resolveWindowsEditorUriLaunch(editorDef, input.cwd) : null;

      if (!fallbackLaunch || editorLaunchesEqual(launch, fallbackLaunch)) {
        return Effect.fail(primaryError);
      }

      return launchDetached(fallbackLaunch);
    }),
  );
}

export const launchDetached = (launch: EditorLaunch) =>
  Effect.gen(function* () {
    if (!(yield* Effect.promise(() => isCommandAvailable(launch.command)))) {
      return yield* new OpenError({ message: `Editor command not found: ${launch.command}` });
    }

    yield* Effect.callback<void, OpenError>((resume) => {
      let child;
      try {
        const prepared = prepareWindowsSafeProcess(launch.command, launch.args);
        child = spawn(prepared.command, prepared.args, {
          detached: true,
          stdio: "ignore",
          shell: prepared.shell,
          windowsHide: prepared.windowsHide,
          windowsVerbatimArguments: prepared.windowsVerbatimArguments,
        });
      } catch (error) {
        return resume(
          Effect.fail(new OpenError({ message: "failed to spawn detached process", cause: error })),
        );
      }

      const handleSpawn = () => {
        child.unref();
        resume(Effect.void);
      };

      child.once("spawn", handleSpawn);
      child.once("error", (cause) =>
        resume(Effect.fail(new OpenError({ message: "failed to spawn detached process", cause }))),
      );
    });
  });

const make = Effect.gen(function* () {
  const open = yield* Effect.tryPromise({
    try: () => import("open"),
    catch: (cause) => new OpenError({ message: "failed to load browser opener", cause }),
  });

  return {
    openBrowser: (target) =>
      Effect.tryPromise({
        try: () => open.default(target),
        catch: (cause) => new OpenError({ message: "Browser auto-open failed", cause }),
      }),
    openInEditor: (input) =>
      // The "system-default" pseudo-editor opens the target with the OS default
      // application (Preview for PDFs on macOS, the registered viewer elsewhere).
      // Reuse the already-loaded cross-platform `open` package instead of guessing
      // per-platform launch commands.
      input.editor === "system-default"
        ? Effect.tryPromise({
            try: () => open.default(input.cwd),
            catch: (cause) => new OpenError({ message: "Failed to open with default app", cause }),
          })
        : Effect.flatMap(resolveEditorLaunch(input), (launch) =>
            launchDetachedWithEditorFallback(input, launch),
          ),
  } satisfies OpenShape;
});

export const OpenLive = Layer.effect(Open, make);

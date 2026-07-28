// FILE: launchConfigReactQuery.ts
// Purpose: Load and persist a project's `.nilcode/launch.json`, the source of truth
//          for its actions, and surface write failures the user must know about.
// Layer: Web data-access helpers
// Exports: projectLaunchConfigQueryOptions, persistProjectLaunchConfig

import type {
  NativeApi,
  ProjectId,
  ProjectReadLaunchConfigResult,
  ProjectScript,
} from "@synara/contracts";
import { projectScriptsToLaunchConfigurations } from "@synara/shared/launchConfig";
import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { toastManager } from "~/components/ui/toast";
import { ensureNativeApi } from "~/nativeApi";

const LAUNCH_CONFIG_STALE_TIME = 5_000;

export const launchConfigQueryKeys = {
  read: (cwd: string | null) => ["projects", "launch-config", cwd] as const,
};

/**
 * Reading also asks the server to mirror the file onto the project's actions, so
 * refetching on window focus is what picks up an external edit or a `git pull`.
 */
export function projectLaunchConfigQueryOptions(input: {
  readonly projectId: ProjectId | null;
  readonly cwd: string | null;
  readonly enabled?: boolean;
}) {
  const cwd = input.cwd;
  return queryOptions({
    queryKey: launchConfigQueryKeys.read(cwd),
    enabled: (input.enabled ?? true) && cwd !== null && cwd.length > 0,
    staleTime: LAUNCH_CONFIG_STALE_TIME,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ProjectReadLaunchConfigResult> => {
      const api = await ensureNativeApi();
      return api.projects.readLaunchConfig({
        cwd: cwd as string,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      });
    },
  });
}

/**
 * Write the project's actions back to `.nilcode/launch.json`.
 *
 * Structural fields of the previous file (`runtimeExecutable`/`runtimeArgs`,
 * `cwd`, `env`) are carried over for entries whose command is unchanged, so
 * editing an action's name never flattens a hand-authored argv into a string.
 */
export async function persistProjectLaunchConfig(input: {
  readonly api: NativeApi;
  readonly queryClient: QueryClient;
  readonly projectId: ProjectId;
  readonly projectCwd: string;
  readonly scripts: readonly ProjectScript[];
}): Promise<void> {
  const queryKey = launchConfigQueryKeys.read(input.projectCwd);
  const previous =
    input.queryClient.getQueryData<ProjectReadLaunchConfigResult>(queryKey) ??
    (await input.api.projects.readLaunchConfig({ cwd: input.projectCwd }).catch(() => null));

  try {
    const state = await input.api.projects.writeLaunchConfig({
      projectId: input.projectId,
      cwd: input.projectCwd,
      configurations: projectScriptsToLaunchConfigurations({
        scripts: input.scripts,
        ...(previous ? { previous: previous.configurations } : {}),
      }),
    });
    input.queryClient.setQueryData(queryKey, state);
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Could not save .nilcode/launch.json",
      description:
        error instanceof Error
          ? error.message
          : "The action was applied for this session but was not written to disk.",
    });
  }
}

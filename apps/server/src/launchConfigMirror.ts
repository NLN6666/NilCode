// FILE: launchConfigMirror.ts
// Purpose: Mirror a project's `.nilcode/launch.json` onto its projected actions.
// Layer: Server runtime utility used by the WebSocket RPC layer.
//
// The file is the source of truth; `project.scripts` is a derived mirror kept in
// the projection so every existing action consumer (chat header, sidebar run,
// worktree setup, keybindings) keeps reading one place. Mirroring runs on the
// read and write RPCs, and the resulting `project.meta.update` broadcasts over
// the orchestration domain-event stream, so all connected clients converge
// without a second push channel.

import {
  CommandId,
  type LaunchConfigState,
  type OrchestrationProject,
  type ProjectId,
  type ProjectScript,
} from "@synara/contracts";
import { launchConfigurationsToProjectScripts } from "@synara/shared/launchConfig";
import { Effect } from "effect";

import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "./orchestration/Services/ProjectionSnapshotQuery.ts";

export function launchConfigScripts(state: LaunchConfigState): ProjectScript[] {
  return launchConfigurationsToProjectScripts(state.configurations);
}

function sameScripts(left: readonly ProjectScript[], right: readonly ProjectScript[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((script, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      script.id === other.id &&
      script.name === other.name &&
      script.command === other.command &&
      script.icon === other.icon &&
      script.runOnWorktreeCreate === other.runOnWorktreeCreate &&
      (script.port ?? null) === (other.port ?? null)
    );
  });
}

/**
 * Push the file's configurations onto the project's actions.
 *
 * Skipped entirely when the file does not exist: a project that has never been
 * migrated keeps its database-only actions rather than being emptied by an
 * absent file. Also skipped when the mirror already matches, so a routine
 * refetch does not churn `updatedAt` for every connected client.
 */
export const mirrorLaunchConfigIntoProject = Effect.fnUntraced(function* (input: {
  readonly orchestrationEngine: Pick<OrchestrationEngineShape, "dispatch">;
  readonly projectionSnapshotQuery: Pick<ProjectionSnapshotQueryShape, "getCommandReadModel">;
  readonly projectId: ProjectId;
  readonly state: LaunchConfigState;
}) {
  if (!input.state.exists) {
    return false;
  }

  const scripts = launchConfigScripts(input.state);
  const readModel = yield* input.projectionSnapshotQuery.getCommandReadModel();
  const project = readModel.projects.find(
    (candidate: OrchestrationProject) => candidate.id === input.projectId,
  );
  if (!project || project.deletedAt !== null || sameScripts(project.scripts, scripts)) {
    return false;
  }

  yield* input.orchestrationEngine.dispatch({
    type: "project.meta.update",
    commandId: CommandId.makeUnsafe(
      `server:launch-config:${input.projectId}:${crypto.randomUUID()}`,
    ),
    projectId: input.projectId,
    scripts,
  });
  return true;
});

import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CommandId,
  ProjectId,
  type LaunchConfigState,
  type OrchestrationCommand,
  type OrchestrationProject,
  type OrchestrationReadModel,
} from "@synara/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  launchConfigFilePath,
  readProjectLaunchConfig,
  writeProjectLaunchConfig,
} from "./launchConfig";
import { mirrorLaunchConfigIntoProject } from "./launchConfigMirror";
import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine";
import type { ProjectionSnapshotQueryShape } from "./orchestration/Services/ProjectionSnapshotQuery";

const temporaryRoots: string[] = [];

async function temporaryProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synara-launch-config-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const PROJECT_ID = ProjectId.makeUnsafe("project-1");

function recordingEngine(
  commands: OrchestrationCommand[],
): Pick<OrchestrationEngineShape, "dispatch"> {
  return {
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: commands.length };
      }),
  };
}

function readModelWith(
  project: Partial<OrchestrationProject> & Pick<OrchestrationProject, "scripts">,
): Pick<ProjectionSnapshotQueryShape, "getCommandReadModel"> {
  const full = {
    id: PROJECT_ID,
    kind: "project" as const,
    title: "Project",
    workspaceRoot: "/tmp/project",
    defaultModelSelection: null,
    isPinned: false,
    spaceId: null,
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T00:00:00Z",
    deletedAt: null,
    ...project,
  } as OrchestrationProject;
  return {
    getCommandReadModel: () =>
      Effect.succeed({ projects: [full] } as unknown as OrchestrationReadModel),
  };
}

describe("readProjectLaunchConfig", () => {
  it("reports a missing file without inventing configurations", async () => {
    const root = await temporaryProjectRoot();

    const state = await readProjectLaunchConfig(root);

    expect(state.exists).toBe(false);
    expect(state.configurations).toEqual([]);
    expect(state.issues).toEqual([]);
    expect(state.filePath).toBe(launchConfigFilePath(root));
  });

  it("loads configurations from disk", async () => {
    const root = await temporaryProjectRoot();
    await mkdir(path.join(root, ".nilcode"), { recursive: true });
    await writeFile(
      launchConfigFilePath(root),
      JSON.stringify({
        configurations: [
          {
            name: "erp-web",
            runtimeExecutable: "dotnet",
            runtimeArgs: ["run", "--project", "src/Erp.Web"],
            port: 5299,
          },
        ],
      }),
    );

    const state = await readProjectLaunchConfig(root);

    expect(state.exists).toBe(true);
    expect(state.configurations[0]?.name).toBe("erp-web");
    expect(state.issues).toEqual([]);
  });

  it("surfaces malformed JSON as an issue instead of throwing", async () => {
    const root = await temporaryProjectRoot();
    await mkdir(path.join(root, ".nilcode"), { recursive: true });
    await writeFile(launchConfigFilePath(root), "{ broken");

    const state = await readProjectLaunchConfig(root);

    expect(state.exists).toBe(true);
    expect(state.configurations).toEqual([]);
    expect(state.issues[0]?.message).toContain("Invalid JSON");
  });
});

describe("writeProjectLaunchConfig", () => {
  it("creates .nilcode and returns the state a reload would observe", async () => {
    const root = await temporaryProjectRoot();

    const state = await writeProjectLaunchConfig({
      cwd: root,
      configurations: [{ name: "dev", command: "bun run dev", port: 5173 }],
    });

    expect(state.exists).toBe(true);
    expect(state.configurations).toEqual([{ name: "dev", command: "bun run dev", port: 5173 }]);
    expect(JSON.parse(await readFile(launchConfigFilePath(root), "utf8"))).toEqual({
      version: "0.0.1",
      configurations: [{ name: "dev", command: "bun run dev", port: 5173 }],
    });
  });

  it("leaves no temp files behind", async () => {
    const root = await temporaryProjectRoot();
    await writeProjectLaunchConfig({ cwd: root, configurations: [{ name: "a", command: "x" }] });
    await writeProjectLaunchConfig({ cwd: root, configurations: [{ name: "b", command: "y" }] });

    const { readdir } = await import("node:fs/promises");
    expect(await readdir(path.join(root, ".nilcode"))).toEqual(["launch.json"]);
  });
});

function launchConfigState(
  exists: boolean,
  configurations: { name: string; command: string }[],
): LaunchConfigState {
  return {
    filePath: "/tmp/project/.nilcode/launch.json",
    exists,
    configurations,
    issues: [],
  };
}

describe("mirrorLaunchConfigIntoProject", () => {
  it("does not touch actions when the file does not exist", async () => {
    const commands: OrchestrationCommand[] = [];

    const mirrored = await Effect.runPromise(
      mirrorLaunchConfigIntoProject({
        orchestrationEngine: recordingEngine(commands),
        projectionSnapshotQuery: readModelWith({
          scripts: [
            {
              id: "dev",
              name: "dev",
              command: "bun run dev",
              icon: "play",
              runOnWorktreeCreate: false,
              port: null,
            },
          ],
        }),
        projectId: PROJECT_ID,
        state: launchConfigState(false, []),
      }),
    );

    expect(mirrored).toBe(false);
    expect(commands).toEqual([]);
  });

  it("dispatches the file's configurations when they differ from the projection", async () => {
    const commands: OrchestrationCommand[] = [];

    const mirrored = await Effect.runPromise(
      mirrorLaunchConfigIntoProject({
        orchestrationEngine: recordingEngine(commands),
        projectionSnapshotQuery: readModelWith({ scripts: [] }),
        projectId: PROJECT_ID,
        state: launchConfigState(true, [{ name: "dev", command: "bun run dev" }]),
      }),
    );

    expect(mirrored).toBe(true);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "project.meta.update",
      projectId: PROJECT_ID,
      scripts: [
        {
          id: "dev",
          name: "dev",
          command: "bun run dev",
          icon: "play",
          runOnWorktreeCreate: false,
          port: null,
        },
      ],
    });
    expect(CommandId.makeUnsafe((commands[0] as { commandId: string }).commandId)).toContain(
      "server:launch-config:",
    );
  });

  it("skips a routine refetch that would only churn updatedAt", async () => {
    const commands: OrchestrationCommand[] = [];

    const mirrored = await Effect.runPromise(
      mirrorLaunchConfigIntoProject({
        orchestrationEngine: recordingEngine(commands),
        projectionSnapshotQuery: readModelWith({
          scripts: [
            {
              id: "dev",
              name: "dev",
              command: "bun run dev",
              icon: "play",
              runOnWorktreeCreate: false,
              port: null,
            },
          ],
        }),
        projectId: PROJECT_ID,
        state: launchConfigState(true, [{ name: "dev", command: "bun run dev" }]),
      }),
    );

    expect(mirrored).toBe(false);
    expect(commands).toEqual([]);
  });

  it("ignores a deleted project", async () => {
    const commands: OrchestrationCommand[] = [];

    const mirrored = await Effect.runPromise(
      mirrorLaunchConfigIntoProject({
        orchestrationEngine: recordingEngine(commands),
        projectionSnapshotQuery: readModelWith({
          scripts: [],
          deletedAt: "2026-07-27T00:00:00Z",
        }),
        projectId: PROJECT_ID,
        state: launchConfigState(true, [{ name: "dev", command: "bun run dev" }]),
      }),
    );

    expect(mirrored).toBe(false);
    expect(commands).toEqual([]);
  });
});

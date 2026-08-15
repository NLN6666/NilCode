// FILE: OhMyPiAcpSupport.test.ts
// Purpose: Verifies stock Oh My Pi ACP spawn, auth, configuration, and discovery behavior.
// Layer: Provider ACP support tests

import { Effect } from "effect";
import type * as Acp from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";

import * as AcpErrors from "./AcpErrors.ts";
import { OH_MY_PI_ACP_17_3_3_FIXTURE } from "./fixtures/ohMyPiAcp17_3_3.ts";
import {
  applyOhMyPiAcpSessionConfiguration,
  buildOhMyPiAcpSpawnInput,
  discoverOhMyPiAcpModels,
  OH_MY_PI_ACP_CLIENT_CAPABILITIES,
  resolveOhMyPiAcpAuthMethodId,
} from "./OhMyPiAcpSupport.ts";

const fixtureInitialize =
  OH_MY_PI_ACP_17_3_3_FIXTURE.initializeResponse as unknown as Acp.InitializeResponse;
const fixtureConfigOptions = OH_MY_PI_ACP_17_3_3_FIXTURE.sessionNewResponse
  .configOptions as unknown as ReadonlyArray<Acp.SessionConfigOption>;
const fixtureModes = OH_MY_PI_ACP_17_3_3_FIXTURE.sessionNewResponse
  .modes as unknown as Acp.SessionModeState;

describe("buildOhMyPiAcpSpawnInput", () => {
  it("passes the Synara overlay as a distinct argv even when Windows paths contain spaces", () => {
    const spawn = buildOhMyPiAcpSpawnInput(
      {
        binaryPath: "C:/Program Files/Oh My Pi/omp.exe",
        overlayPath: "C:/Users/Test User/.omp/synara/acp-provider.yml",
      },
      "C:/Work Trees/project",
    );

    expect(spawn.command).toBe("C:/Program Files/Oh My Pi/omp.exe");
    expect(spawn.args).toEqual([
      "acp",
      "--config",
      "C:/Users/Test User/.omp/synara/acp-provider.yml",
    ]);
    expect(spawn.cwd).toBe("C:/Work Trees/project");
    expect(spawn.env).toBeDefined();
    expect(spawn.env?.PI_CODING_AGENT_DIR).toBeUndefined();
    expect(spawn.env?.SYNARA_AUTH_TOKEN).toBeUndefined();
  });

  it("advertises only client capabilities Synara implements", () => {
    expect(OH_MY_PI_ACP_CLIENT_CAPABILITIES).toEqual({
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
      elicitation: { form: {} },
    });
  });
});

describe("resolveOhMyPiAcpAuthMethodId", () => {
  it("selects the fixture's existing-agent credentials method", async () => {
    await expect(Effect.runPromise(resolveOhMyPiAcpAuthMethodId(fixtureInitialize))).resolves.toBe(
      "agent",
    );
  });

  it("fails clearly when agent auth is not advertised", async () => {
    const error = await Effect.runPromise(
      resolveOhMyPiAcpAuthMethodId({
        protocolVersion: 1,
        authMethods: [{ id: "browser", name: "Browser" }],
      }).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(AcpErrors.AcpRequestError);
    expect(error.message).toContain("Run `omp`");
    expect(error.message).toContain("browser");
  });
});

describe("applyOhMyPiAcpSessionConfiguration", () => {
  function recordingRuntime(input?: {
    readonly modes?: Acp.SessionModeState;
    readonly options?: ReadonlyArray<Acp.SessionConfigOption>;
  }) {
    let options = [...(input?.options ?? fixtureConfigOptions)];
    const calls: Array<{ kind: "mode" | "config"; id: string; value?: string | boolean }> = [];
    return {
      calls,
      runtime: {
        getModeState: Effect.succeed(input?.modes ?? fixtureModes),
        getConfigOptions: Effect.sync(() => options),
        setMode: (modeId: string) => {
          calls.push({ kind: "mode", id: modeId });
          return Effect.succeed({});
        },
        setConfigOption: (configId: string, value: string | boolean) => {
          calls.push({ kind: "config", id: configId, value });
          options = options.map((option) =>
            option.id === configId
              ? ({ ...option, currentValue: value } as Acp.SessionConfigOption)
              : option,
          );
          return Effect.succeed({ configOptions: options });
        },
      },
    };
  }

  it("applies native mode before model and thinking", async () => {
    const { calls, runtime } = recordingRuntime();
    await Effect.runPromise(
      applyOhMyPiAcpSessionConfiguration({
        runtime,
        interactionMode: "plan",
        model: "fixture/model-b",
        thinkingLevel: "max",
        mapError: ({ cause }) => cause,
      }),
    );

    expect(calls).toEqual([
      { kind: "mode", id: "plan" },
      { kind: "config", id: "model", value: "fixture/model-b" },
      { kind: "config", id: "thinking", value: "max" },
    ]);
  });

  it("retains OMP's current model and thinking when neither is requested", async () => {
    const { calls, runtime } = recordingRuntime();
    await Effect.runPromise(
      applyOhMyPiAcpSessionConfiguration({
        runtime,
        interactionMode: "default",
        mapError: ({ cause }) => cause,
      }),
    );

    expect(calls).toEqual([{ kind: "mode", id: "default" }]);
  });

  it("fails closed when native Plan mode is missing", async () => {
    const { runtime } = recordingRuntime({
      modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] },
    });
    const error = await Effect.runPromise(
      applyOhMyPiAcpSessionConfiguration({
        runtime,
        interactionMode: "plan",
        mapError: ({ cause }) => cause,
      }).pipe(Effect.flip),
    );

    expect(error.message).toContain("Plan mode");
  });

  it("rejects unknown models without silently selecting another model", async () => {
    const { calls, runtime } = recordingRuntime();
    const error = await Effect.runPromise(
      applyOhMyPiAcpSessionConfiguration({
        runtime,
        model: "fixture/unknown",
        mapError: ({ cause }) => cause,
      }).pipe(Effect.flip),
    );

    expect(error.message).toContain("fixture/unknown");
    expect(calls).toEqual([]);
  });

  it("rejects unsupported thinking after reading the selected model's current options", async () => {
    const { calls, runtime } = recordingRuntime();
    const error = await Effect.runPromise(
      applyOhMyPiAcpSessionConfiguration({
        runtime,
        model: "fixture/model-b",
        thinkingLevel: "ultra",
        mapError: ({ cause }) => cause,
      }).pipe(Effect.flip),
    );

    expect(error.message).toContain("ultra");
    expect(calls).toEqual([{ kind: "config", id: "model", value: "fixture/model-b" }]);
  });

  it("rejects malformed config options", async () => {
    const { runtime } = recordingRuntime({ options: [] });
    const error = await Effect.runPromise(
      applyOhMyPiAcpSessionConfiguration({
        runtime,
        model: "fixture/model-a",
        mapError: ({ cause }) => cause,
      }).pipe(Effect.flip),
    );

    expect(error.message).toContain("model configuration option");
  });
});

describe("discoverOhMyPiAcpModels", () => {
  it("projects fixture models and restores the original model and thinking", async () => {
    let currentModel = "fixture/model-a";
    let currentThinking = "high";
    const calls: Array<{ id: string; value: string | boolean }> = [];
    const configOptions = (): ReadonlyArray<Acp.SessionConfigOption> =>
      fixtureConfigOptions.map((option) => {
        if (option.id === "model") return { ...option, currentValue: currentModel };
        if (option.id === "thinking") {
          const modelB = currentModel === "fixture/model-b";
          return {
            ...option,
            currentValue: modelB ? "max" : currentThinking,
            options: modelB
              ? [
                  { value: "high", name: "High" },
                  { value: "max", name: "Max" },
                ]
              : option.options,
          };
        }
        return option;
      });
    const runtime = {
      getConfigOptions: Effect.sync(configOptions),
      setConfigOption: (id: string, value: string | boolean) => {
        calls.push({ id, value });
        if (id === "model") currentModel = String(value);
        if (id === "thinking") currentThinking = String(value);
        return Effect.succeed({ configOptions: configOptions() });
      },
    };

    const result = await Effect.runPromise(discoverOhMyPiAcpModels(runtime));

    expect(result.source).toBe("omp-acp");
    expect(result.models).toEqual([
      expect.objectContaining({
        slug: "fixture/model-a",
        optionDescriptors: [expect.objectContaining({ id: "thinkingLevel" })],
      }),
      expect.objectContaining({
        slug: "fixture/model-b",
        optionDescriptors: [
          expect.objectContaining({
            id: "thinkingLevel",
            options: [
              { id: "high", label: "High" },
              { id: "max", label: "Max" },
            ],
          }),
        ],
      }),
    ]);
    expect(currentModel).toBe("fixture/model-a");
    expect(currentThinking).toBe("high");
    expect(calls.at(-2)).toEqual({ id: "model", value: "fixture/model-a" });
    expect(calls.at(-1)).toEqual({ id: "thinking", value: "high" });
  });

  it("fails on an empty or malformed model selector", async () => {
    const error = await Effect.runPromise(
      discoverOhMyPiAcpModels({
        getConfigOptions: Effect.succeed([]),
        setConfigOption: () => Effect.succeed({ configOptions: [] }),
      }).pipe(Effect.flip),
    );

    expect(error.message).toContain("model configuration option");
  });
});

/**
 * Oh My Pi ACP support - the stock `omp acp` boundary and standard ACP configuration semantics.
 *
 * Phase 1 intentionally contains no OMP-private extensions or configuration overlay.
 *
 * @module OhMyPiAcpSupport
 */
import type {
  OhMyPiModelOptions,
  ProviderInteractionMode,
  ProviderListModelsResult,
  ProviderModelDescriptor,
} from "@synara/contracts";
import { Effect, Layer, Scope, ServiceMap } from "effect";
import type * as Acp from "@agentclientprotocol/sdk";
import { ChildProcessSpawner } from "effect/unstable/process";

import { resolveExecutable } from "../../executableLookup.ts";
import { buildProviderChildEnvironment } from "../../providerChildEnvironment.ts";
import * as AcpErrors from "./AcpErrors.ts";
import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
  type AcpSpawnInput,
} from "./AcpSessionRuntime.ts";

const OH_MY_PI_AUTH_METHOD_ID = "agent";
const OH_MY_PI_MODE_CONFIG_ID = "mode";
const OH_MY_PI_MODEL_CONFIG_ID = "model";
const OH_MY_PI_THINKING_CONFIG_ID = "thinking";
const OH_MY_PI_DEFAULT_MODE_ID = "default";
const OH_MY_PI_PLAN_MODE_ID = "plan";

export const OH_MY_PI_ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: true,
  elicitation: { form: {} },
} satisfies NonNullable<Acp.InitializeRequest["clientCapabilities"]>;

export interface OhMyPiAcpRuntimeSettings {
  readonly binaryPath?: string;
  readonly overlayPath?: string;
}

export interface OhMyPiAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "resolveAuthMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly ohMyPiSettings: OhMyPiAcpRuntimeSettings | null | undefined;
}

export interface OhMyPiAcpConfigurationErrorContext {
  readonly cause: AcpErrors.AcpError;
  readonly method: "session/set_config_option";
}

export function resolveOhMyPiCliBinaryPath(binaryPath?: string | null): string {
  const configured = binaryPath?.trim() || "omp";
  return resolveExecutable(configured) ?? configured;
}

export function buildOhMyPiAcpSpawnInput(
  settings: OhMyPiAcpRuntimeSettings | null | undefined,
  cwd: string,
): AcpSpawnInput {
  const overlayPath = settings?.overlayPath?.trim();
  if (!overlayPath) {
    throw new Error("Oh My Pi ACP requires the Synara process overlay before spawn.");
  }
  const env = buildProviderChildEnvironment({ provider: "acp" });
  delete env.PI_CODING_AGENT_DIR;
  return {
    command: resolveOhMyPiCliBinaryPath(settings?.binaryPath),
    args: ["acp", "--config", overlayPath],
    cwd,
    env,
  };
}

export const resolveOhMyPiAcpAuthMethodId = (
  initializeResult: Acp.InitializeResponse,
): Effect.Effect<string, AcpErrors.AcpError> => {
  const authMethodIds = (initializeResult.authMethods ?? [])
    .map((method) => method.id.trim())
    .filter((methodId) => methodId.length > 0);
  if (authMethodIds.includes(OH_MY_PI_AUTH_METHOD_ID)) {
    return Effect.succeed(OH_MY_PI_AUTH_METHOD_ID);
  }
  return Effect.fail(
    new AcpErrors.AcpRequestError({
      code: -32602,
      errorMessage: `Oh My Pi is not authenticated for headless ACP. Run \`omp\` and complete local authentication, then retry. Oh My Pi advertised: ${authMethodIds.join(", ") || "none"}.`,
      data: { authMethods: authMethodIds, reason: "credentials_missing" },
    }),
  );
};

export const makeOhMyPiAcpRuntime = (
  input: OhMyPiAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntimeShape, AcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildOhMyPiAcpSpawnInput(input.ohMyPiSettings, input.cwd),
        clientCapabilities: OH_MY_PI_ACP_CLIENT_CAPABILITIES,
        resolveAuthMethodId: resolveOhMyPiAcpAuthMethodId,
        authenticateMeta: { headless: true },
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return ServiceMap.getUnsafe(acpContext, AcpSessionRuntime);
  });

type OhMyPiConfigurationRuntime = Pick<
  AcpSessionRuntimeShape,
  "getConfigOptions" | "getModeState" | "setConfigOption" | "setMode"
>;

type SelectConfigOption = Extract<Acp.SessionConfigOption, { readonly type: "select" }>;

function flattenSelectOptions(
  options: Acp.SessionConfigSelectOptions,
): ReadonlyArray<Acp.SessionConfigSelectOption> {
  return options.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

function findSelectConfig(
  options: ReadonlyArray<Acp.SessionConfigOption>,
  input: { readonly id: string; readonly category: string },
): SelectConfigOption | undefined {
  return options.find(
    (option): option is SelectConfigOption =>
      option.type === "select" && (option.id === input.id || option.category === input.category),
  );
}

function invalidConfiguration(message: string, data?: Record<string, unknown>): AcpErrors.AcpError {
  return new AcpErrors.AcpRequestError({
    code: -32602,
    errorMessage: message,
    ...(data ? { data } : {}),
  });
}

function requireSupportedSelectValue(
  config: SelectConfigOption | undefined,
  input: { readonly label: string; readonly value: string },
): Effect.Effect<SelectConfigOption, AcpErrors.AcpError> {
  if (!config) {
    return Effect.fail(
      invalidConfiguration(`Oh My Pi ACP did not advertise a ${input.label} configuration option.`),
    );
  }
  const allowedValues = flattenSelectOptions(config.options).map((option) => option.value);
  if (!allowedValues.includes(input.value)) {
    return Effect.fail(
      invalidConfiguration(
        `Oh My Pi ACP does not support ${input.label} ${JSON.stringify(input.value)} for this session. Available values: ${allowedValues.join(", ") || "none"}.`,
        { configId: config.id, allowedValues, receivedValue: input.value },
      ),
    );
  }
  return Effect.succeed(config);
}

export function applyOhMyPiAcpSessionConfiguration<E>(input: {
  readonly runtime: OhMyPiConfigurationRuntime;
  readonly interactionMode?: ProviderInteractionMode;
  readonly model?: string | null;
  readonly thinkingLevel?: OhMyPiModelOptions["thinkingLevel"] | null;
  readonly mapError: (context: OhMyPiAcpConfigurationErrorContext) => E;
}): Effect.Effect<void, E> {
  const configure = Effect.gen(function* () {
    if (input.interactionMode !== undefined) {
      const requestedMode =
        input.interactionMode === "plan" ? OH_MY_PI_PLAN_MODE_ID : OH_MY_PI_DEFAULT_MODE_ID;
      const modeState = yield* input.runtime.getModeState;
      const supported =
        modeState?.availableModes.some((mode) => mode.id === requestedMode) === true;
      if (!supported) {
        return yield* invalidConfiguration(
          input.interactionMode === "plan"
            ? "Oh My Pi ACP did not advertise native Plan mode; Synara refused to emulate it without a read-only guarantee."
            : "Oh My Pi ACP did not advertise its default session mode.",
          { requestedMode, availableModes: modeState?.availableModes ?? [] },
        );
      }
      yield* input.runtime.setMode(requestedMode);
    }

    const model = input.model?.trim();
    if (model) {
      const options = yield* input.runtime.getConfigOptions;
      const modelConfig = yield* requireSupportedSelectValue(
        findSelectConfig(options, { id: OH_MY_PI_MODEL_CONFIG_ID, category: "model" }),
        { label: "model", value: model },
      );
      yield* input.runtime.setConfigOption(modelConfig.id, model);
    }

    const thinkingLevel = input.thinkingLevel?.trim();
    if (thinkingLevel) {
      // Model selection changes this ladder, so this read must happen after the model RPC.
      const options = yield* input.runtime.getConfigOptions;
      const thinkingConfig = yield* requireSupportedSelectValue(
        findSelectConfig(options, {
          id: OH_MY_PI_THINKING_CONFIG_ID,
          category: "thought_level",
        }),
        { label: "thinking level", value: thinkingLevel },
      );
      yield* input.runtime.setConfigOption(thinkingConfig.id, thinkingLevel);
    }
  });

  return configure.pipe(
    Effect.mapError((cause) => input.mapError({ cause, method: "session/set_config_option" })),
  );
}

function modelDescriptor(
  model: Acp.SessionConfigSelectOption,
  thinkingConfig: SelectConfigOption | undefined,
): ProviderModelDescriptor {
  const thinkingOptions = thinkingConfig ? flattenSelectOptions(thinkingConfig.options) : [];
  return {
    slug: model.value,
    name: model.name,
    ...(model.description ? { description: model.description } : {}),
    optionDescriptors: thinkingConfig
      ? [
          {
            id: "thinkingLevel",
            label: thinkingConfig.name,
            type: "select",
            options: thinkingOptions.map((option) => ({
              id: option.value,
              label: option.name,
              ...(option.description ? { description: option.description } : {}),
            })),
            ...(thinkingConfig.currentValue
              ? { currentValue: String(thinkingConfig.currentValue) }
              : {}),
          },
        ]
      : [],
    supportedReasoningEfforts: thinkingOptions.map((option) => ({
      value: option.value,
      label: option.name,
      ...(option.description ? { description: option.description } : {}),
    })),
    supportsFastMode: false,
    supportsThinkingToggle: thinkingOptions.some((option) => option.value === "off"),
  };
}

/** Reads the stock ACP selectors and restores the disposable session before its scope closes. */
export function discoverOhMyPiAcpModels(
  runtime: Pick<AcpSessionRuntimeShape, "getConfigOptions" | "setConfigOption">,
): Effect.Effect<ProviderListModelsResult, AcpErrors.AcpError> {
  let originalModel: string | undefined;
  let originalThinking: string | undefined;
  let modelConfigId = OH_MY_PI_MODEL_CONFIG_ID;
  let thinkingConfigId = OH_MY_PI_THINKING_CONFIG_ID;

  const restore = Effect.suspend(() => {
    if (!originalModel) return Effect.void;
    return runtime
      .setConfigOption(modelConfigId, originalModel)
      .pipe(
        Effect.andThen(
          originalThinking
            ? runtime.setConfigOption(thinkingConfigId, originalThinking).pipe(Effect.asVoid)
            : Effect.void,
        ),
        Effect.ignore,
      );
  });

  return Effect.gen(function* () {
    const initialOptions = yield* runtime.getConfigOptions;
    const modelConfig = findSelectConfig(initialOptions, {
      id: OH_MY_PI_MODEL_CONFIG_ID,
      category: "model",
    });
    if (!modelConfig) {
      return yield* invalidConfiguration(
        "Oh My Pi ACP did not advertise a model configuration option.",
      );
    }
    const models = flattenSelectOptions(modelConfig.options);
    if (models.length === 0) {
      return yield* invalidConfiguration("Oh My Pi ACP advertised an empty model selector.");
    }

    modelConfigId = modelConfig.id;
    originalModel =
      typeof modelConfig.currentValue === "string" ? modelConfig.currentValue : undefined;
    const initialThinking = findSelectConfig(initialOptions, {
      id: OH_MY_PI_THINKING_CONFIG_ID,
      category: "thought_level",
    });
    if (initialThinking) {
      thinkingConfigId = initialThinking.id;
      originalThinking =
        typeof initialThinking.currentValue === "string" ? initialThinking.currentValue : undefined;
    }

    const descriptors = yield* Effect.forEach(
      models,
      (model) =>
        runtime.setConfigOption(modelConfig.id, model.value).pipe(
          Effect.andThen(runtime.getConfigOptions),
          Effect.map((updatedOptions) =>
            modelDescriptor(
              model,
              findSelectConfig(updatedOptions, {
                id: OH_MY_PI_THINKING_CONFIG_ID,
                category: "thought_level",
              }),
            ),
          ),
        ),
      { concurrency: 1 },
    );

    return {
      models: descriptors,
      source: "omp-acp",
      cached: false,
    } satisfies ProviderListModelsResult;
  }).pipe(Effect.ensuring(restore));
}

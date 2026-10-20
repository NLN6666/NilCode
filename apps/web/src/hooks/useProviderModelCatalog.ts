// FILE: useProviderModelCatalog.ts
// Purpose: Shared provider→model option catalog (static + custom + runtime-discovered)
//          for composer-like surfaces outside ChatView, e.g. the kanban new-task dialog.
// Layer: Web hooks
// Exports: useProviderModelCatalog, ProviderModelCatalog, modelQueryOptionsForProviderInstance

import type {
  CloudModelDescriptor,
  ProviderAgentDescriptor,
  ProviderInstanceId,
  ProviderKind,
  ProviderListModelsResult,
  ProviderModelDescriptor,
} from "@synara/contracts";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

import {
  getAppModelOptions,
  getCustomModelsForProviderInstance,
  getCustomModelsByProvider,
  getProviderInstanceOptions,
  getProviderStartOptions,
  useAppSettings,
} from "../appSettings";
import { setComposerAgentMentionCatalog } from "../lib/agentMentionCatalog";
import { filterModelOptionsByVisibility } from "../providerOrdering";
import { resolveRuntimeModelDescriptor } from "../components/chat/runtimeModelCapabilities";
import { collapseCursorModelVariants } from "../cursorModelVariants";
import {
  isInitialModelDiscoveryPending,
  prioritizeProviderModelDiscovery,
  providerAgentsQueryOptions,
  providerCloudModelsQueryOptions,
  providerDiscoveryQueryKeys,
  providerModelsQueryOptions,
} from "../lib/providerDiscoveryReactQuery";
import {
  getOmpModelSelectionIssue,
  mergeDynamicModelOptions,
  sortProviderModelOptions,
  withCloudModelDescriptors,
  type ProviderModelOption,
} from "../providerModelOptions";
import type { ProviderModelOptionsByProviderInstance } from "../components/chat/ProviderModelPicker";

export interface ProviderModelCatalog {
  refreshModels: (
    provider: ProviderKind,
    instanceId: ProviderInstanceId,
    refresh: "if-stale" | "now",
  ) => Promise<void>;
  customModelsByProvider: ReturnType<typeof getCustomModelsByProvider>;
  modelOptionsByProvider: Record<
    ProviderKind,
    ReadonlyArray<ProviderModelOption & { isCustom?: boolean }>
  >;
  /**
   * The same catalog before `hiddenModels` is applied. Settings UI must read
   * this — filtering there would hide the very rows used to unhide a model.
   */
  allModelOptionsByProvider: Record<
    ProviderKind,
    ReadonlyArray<ProviderModelOption & { isCustom?: boolean }>
  >;
  modelOptionsByProviderInstance: ProviderModelOptionsByProviderInstance;
  /** Providers whose runtime model discovery is still pending (no usable list yet). */
  loadingModelProviders: Partial<Record<ProviderKind, boolean>>;
  /**
   * Runtime-discovered model descriptors per provider. Composer-style trait
   * controls (effort, fast mode, thinking, context window) are sourced from
   * these for cursor/codex/etc., so any surface that wants the effort picker
   * must feed them through (see {@link selectedRuntimeModel}).
   */
  runtimeModelsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelDescriptor>>;
  /** Account-local runtime descriptors; known accounts are empty until discovery resolves. */
  runtimeModelsByProviderInstance: Partial<
    Record<ProviderInstanceId, ReadonlyArray<ProviderModelDescriptor>>
  >;
  /** The runtime descriptor matching `selectedProvider` + its selected-model hint. */
  selectedRuntimeModel: ProviderModelDescriptor | undefined;
  /** Runtime-discovered agents/modes for the selected provider (opencode/claude/codex). */
  selectedRuntimeAgents: ReadonlyArray<ProviderAgentDescriptor>;
  /** Loading state used by the selected provider's bootstrap skeleton. */
  selectedProviderModelsLoading: boolean;
  /** Whether the selected provider requires and is still waiting on runtime models. */
  selectedProviderRuntimeModelDiscoveryPending: boolean;
  /** Discovery failure detail per provider (268 passthrough). */
  discoveryErrorsByProvider: Partial<Record<ProviderKind, string | undefined>>;
}

const EMPTY_PROVIDER_AGENTS: ReadonlyArray<ProviderAgentDescriptor> = [];

// Module scope: `useQueries` recombines whenever this function's identity changes.
function selectQueryData<Data>(
  results: ReadonlyArray<{ data: Data | undefined }>,
): Array<Data | undefined> {
  return results.map((result) => result.data);
}

const CWD_SCOPED_MODEL_DISCOVERY_PROVIDERS: ReadonlySet<ProviderKind> = new Set([
  "antigravity",
  "droid",
  "opencode",
  "omp",
  "pi",
  "devin",
]);

function readProviderOptionString(options: unknown, key: string): string | null {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return null;
  }
  const value = (options as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function modelQueryOptionsForProviderInstance(input: {
  readonly settings: Parameters<typeof getProviderStartOptions>[0];
  readonly provider: ProviderKind;
  readonly instanceId: ProviderInstanceId;
  readonly cwd: string | null;
  readonly enabled: boolean;
  readonly refresh?: "if-stale" | "now";
}) {
  const providerOptions = getProviderStartOptions(input.settings, input.instanceId)?.[
    input.provider
  ];
  return providerModelsQueryOptions({
    provider: input.provider,
    instanceId: input.instanceId,
    binaryPath: readProviderOptionString(providerOptions, "binaryPath"),
    homePath: readProviderOptionString(providerOptions, "homePath"),
    shadowHomePath: readProviderOptionString(providerOptions, "shadowHomePath"),
    accountId: readProviderOptionString(providerOptions, "accountId"),
    apiEndpoint: readProviderOptionString(providerOptions, "apiEndpoint"),
    agentDir: readProviderOptionString(providerOptions, "agentDir"),
    cwd: CWD_SCOPED_MODEL_DISCOVERY_PROVIDERS.has(input.provider) ? input.cwd : null,
    enabled: input.enabled,
    ...(input.refresh ? { refresh: input.refresh, priority: "foreground" } : {}),
  });
}

function modelDiscoveryError(
  resultError: string | undefined,
  queryError: unknown,
): string | undefined {
  if (resultError) {
    return resultError;
  }
  if (queryError instanceof Error) {
    return queryError.message;
  }
  return typeof queryError === "string" ? queryError : undefined;
}

export function useProviderModelCatalog(input: {
  selectedProvider: ProviderKind;
  selectedProviderInstanceId?: ProviderInstanceId | null;
  /**
   * Enables discovery for the on-demand providers (cursor/grok/droid/opencode/omp/pi/devin)
   * even when they are not selected — pass the picker's open state so their lists
   * are warm by the time the user browses them.
   */
  discoveryEnabled: boolean;
  /** Effective cwd for providers whose model catalog can be extended by project resources. */
  cwd?: string | null;
  /** Per-provider selected-model hints so an unknown selection still lists itself. */
  modelHintByProvider?: Partial<Record<ProviderKind, string | null>>;
  /**
   * Restrict background discovery to the providers used by a non-picker surface.
   * Picker surfaces can omit this — or pass undefined — to use the
   * visible-provider list from settings.
   */
  prefetchProviders?: ReadonlyArray<ProviderKind> | undefined;
  /** Preserve eager Claude/Codex agent discovery on surfaces that already prefetch both. */
  agentDiscoveryPolicy?: "selected" | "eager-core";
}): ProviderModelCatalog {
  const { selectedProvider, selectedProviderInstanceId, discoveryEnabled, modelHintByProvider } =
    input;
  const agentDiscoveryPolicy = input.agentDiscoveryPolicy ?? "selected";
  const discoveryCwd = input.cwd ?? null;
  const { settings, serverSettings } = useAppSettings();
  const queryClient = useQueryClient();
  const refreshModels = useCallback<ProviderModelCatalog["refreshModels"]>(
    async (provider, instanceId, refresh) => {
      const options = modelQueryOptionsForProviderInstance({
        settings,
        provider,
        instanceId,
        cwd: discoveryCwd,
        enabled: true,
        refresh,
      });
      const releasePriority = prioritizeProviderModelDiscovery(options.queryKey);
      try {
        // A prefetch already running may return a stale snapshot or fail. Wait
        // for it without losing the interactive read's priority or refresh intent.
        const wasFetching = queryClient.getQueryState(options.queryKey)?.fetchStatus === "fetching";
        if (wasFetching) {
          await queryClient.fetchQuery({ ...options, retry: false }).catch(() => undefined);
        }
        const result = await queryClient.fetchQuery({
          ...options,
          // A recent client snapshot may still be stale on the server. Explicit
          // reads must reach its freshness/single-flight gate, which owns reuse.
          staleTime: 0,
          retry: false,
        });
        if (result.error) throw new Error(result.error);
      } finally {
        releasePriority?.();
      }
    },
    [queryClient, settings, discoveryCwd],
  );
  const customModelsByProvider = useMemo(() => getCustomModelsByProvider(settings), [settings]);
  const providerInstances = useMemo(() => getProviderInstanceOptions(settings), [settings]);
  // Callers without an explicit instance selection route to the provider's
  // default instance, so that is the only instance discovery must warm.
  const effectiveSelectedInstanceId = (selectedProviderInstanceId?.trim() ||
    selectedProvider) as ProviderInstanceId;
  const hiddenProviderSet = useMemo(
    () => new Set<ProviderKind>(settings.hiddenProviders),
    [settings.hiddenProviders],
  );
  const selectedInstanceQueryOption = (
    provider: ProviderKind,
  ): { readonly instanceId: ProviderInstanceId } => {
    const instanceId =
      selectedProvider === provider ? selectedProviderInstanceId?.trim() : undefined;
    return { instanceId: instanceId || provider };
  };
  const prefetchProviderSet = useMemo(
    () =>
      input.prefetchProviders === undefined ? null : new Set<ProviderKind>(input.prefetchProviders),
    [input.prefetchProviders],
  );
  const shouldDiscoverProvider = (
    provider: ProviderKind,
    prefetchRequested = discoveryEnabled,
  ): boolean => {
    // The enabled flag is a short-circuit, not a precondition. `serverSettings` is
    // undefined while the settings query is in flight and stays undefined if it
    // fails — and it never refetches on its own (`staleTime: Infinity`). Treating
    // that as "disabled" would silence discovery for every provider, including the
    // selected one, which is precisely the "my model disappeared" symptom. Mirrors
    // the server-side fallback in ProviderDiscoveryService.listModels.
    if (serverSettings?.providers[provider]?.enabled === false) {
      return false;
    }
    if (provider === selectedProvider) {
      return true;
    }
    if (!prefetchRequested) {
      return false;
    }
    return prefetchProviderSet?.has(provider) ?? !hiddenProviderSet.has(provider);
  };

  const claudeModelDiscoveryEnabled = shouldDiscoverProvider("claudeAgent");
  const codexModelDiscoveryEnabled = shouldDiscoverProvider("codex");
  const cursorModelDiscoveryEnabled = shouldDiscoverProvider("cursor");
  const antigravityModelDiscoveryEnabled = shouldDiscoverProvider("antigravity");
  const grokModelDiscoveryEnabled = shouldDiscoverProvider("grok");
  // ponytail: explicit prefetch only; picker surfaces stay cold (see droid query comment below).
  const droidPrefetchRequested = discoveryEnabled && (prefetchProviderSet?.has("droid") ?? false);
  const droidModelDiscoveryEnabled = shouldDiscoverProvider("droid", droidPrefetchRequested);
  const openCodeModelDiscoveryEnabled = shouldDiscoverProvider("opencode");
  const piModelDiscoveryEnabled = shouldDiscoverProvider("pi");
  const devinModelDiscoveryEnabled = shouldDiscoverProvider("devin");
  const ompModelDiscoveryEnabled = shouldDiscoverProvider("omp");

  const instanceModelData = useQueries({
    queries: providerInstances.map((instance) =>
      modelQueryOptionsForProviderInstance({
        settings,
        provider: instance.provider,
        instanceId: instance.instanceId,
        cwd: discoveryCwd,
        enabled:
          instance.enabled &&
          shouldDiscoverProvider(
            instance.provider,
            instance.provider === "droid" ? droidPrefetchRequested : discoveryEnabled,
          ) &&
          (discoveryEnabled || effectiveSelectedInstanceId === instance.instanceId),
      }),
    ),
    // Subscribe to data only so streaming tokens do not rebuild account catalogs.
    combine: selectQueryData,
  });
  const dynamicModelsByProviderInstance = useMemo(() => {
    const byInstance: Partial<Record<ProviderInstanceId, ProviderListModelsResult>> = {};
    providerInstances.forEach((instance, index) => {
      const data = instanceModelData[index];
      if (data) {
        byInstance[instance.instanceId] =
          instance.provider === "cursor"
            ? { ...data, models: collapseCursorModelVariants(data.models) }
            : data;
      }
    });
    return byInstance;
  }, [instanceModelData, providerInstances]);

  const queryOptionsForProvider = (provider: ProviderKind, enabled: boolean) => {
    const selectedInstanceId =
      selectedProvider === provider ? selectedProviderInstanceId?.trim() : undefined;
    const instanceId = selectedInstanceId || provider;
    const instance = providerInstances.find(
      (candidate) => candidate.provider === provider && candidate.instanceId === instanceId,
    );
    return modelQueryOptionsForProviderInstance({
      settings,
      provider,
      instanceId,
      cwd: discoveryCwd,
      enabled: enabled && instance?.enabled === true,
    });
  };

  const modelQueryOptionsByProvider = {
    claudeAgent: queryOptionsForProvider("claudeAgent", claudeModelDiscoveryEnabled),
    codex: queryOptionsForProvider("codex", codexModelDiscoveryEnabled),
    cursor: queryOptionsForProvider("cursor", cursorModelDiscoveryEnabled),
    antigravity: queryOptionsForProvider("antigravity", antigravityModelDiscoveryEnabled),
    grok: queryOptionsForProvider("grok", grokModelDiscoveryEnabled),
    droid: queryOptionsForProvider("droid", droidModelDiscoveryEnabled),
    opencode: queryOptionsForProvider("opencode", openCodeModelDiscoveryEnabled),
    pi: queryOptionsForProvider("pi", piModelDiscoveryEnabled),
    devin: queryOptionsForProvider("devin", devinModelDiscoveryEnabled),
    omp: queryOptionsForProvider("omp", ompModelDiscoveryEnabled),
  } as const;

  const claudeDynamicModelsQuery = useQuery(modelQueryOptionsByProvider.claudeAgent);
  const codexDynamicModelsQuery = useQuery(modelQueryOptionsByProvider.codex);
  const cursorDynamicModelsQuery = useQuery(modelQueryOptionsByProvider.cursor);
  const antigravityModelsQuery = useQuery(modelQueryOptionsByProvider.antigravity);
  const grokDynamicModelsQuery = useQuery(modelQueryOptionsByProvider.grok);
  const droidDynamicModelsQuery = useQuery(modelQueryOptionsByProvider.droid);
  const openCodeDynamicModelsQuery = useQuery(modelQueryOptionsByProvider.opencode);
  const piDynamicModelsQuery = useQuery(modelQueryOptionsByProvider.pi);
  const devinDynamicModelsQuery = useQuery(modelQueryOptionsByProvider.devin);

  const [
    ,
    ,
    modelProvider,
    modelInstanceId,
    modelBinaryPath,
    modelApiEndpoint,
    modelAgentDir,
    modelCwd,
    modelHomePath,
    modelShadowHomePath,
    modelAccountId,
  ] = modelQueryOptionsByProvider[selectedProvider].queryKey;
  const selectedProviderModelsQueryKey = useMemo(
    () =>
      providerDiscoveryQueryKeys.models(
        modelProvider,
        modelBinaryPath,
        modelApiEndpoint,
        modelAgentDir,
        modelCwd,
        modelHomePath,
        modelShadowHomePath,
        modelAccountId,
        modelInstanceId,
      ),
    [
      modelProvider,
      modelInstanceId,
      modelBinaryPath,
      modelHomePath,
      modelShadowHomePath,
      modelAccountId,
      modelApiEndpoint,
      modelAgentDir,
      modelCwd,
    ],
  );
  const ompDynamicModelsQuery = useQuery(modelQueryOptionsByProvider.omp);

  const selectedProviderModelsEnabled = modelQueryOptionsByProvider[selectedProvider].enabled;

  // Keep foreground ownership out of queryFn options: retries can outlive
  // the selection that started them. The effect owns the current priority.
  useEffect(() => {
    if (!selectedProviderModelsEnabled) return;
    return prioritizeProviderModelDiscovery(selectedProviderModelsQueryKey);
  }, [selectedProviderModelsQueryKey, selectedProviderModelsEnabled]);

  // Agent/mode discovery (opencode "Agent" picker, claude/codex subagents).
  // cwd matters here: project-level `.claude/agents` / `.codex/agents` definitions
  // take precedence over the user's home ones.
  const claudeDynamicAgentsQuery = useQuery(
    providerAgentsQueryOptions({
      provider: "claudeAgent",
      ...selectedInstanceQueryOption("claudeAgent"),
      enabled: shouldDiscoverProvider("claudeAgent", agentDiscoveryPolicy === "eager-core"),
    }),
  );
  const codexDynamicAgentsQuery = useQuery(
    providerAgentsQueryOptions({
      provider: "codex",
      ...selectedInstanceQueryOption("codex"),
      enabled: shouldDiscoverProvider("codex", agentDiscoveryPolicy === "eager-core"),
    }),
  );
  const openCodeDynamicAgentsQuery = useQuery(
    providerAgentsQueryOptions({
      provider: "opencode",
      ...selectedInstanceQueryOption("opencode"),
      binaryPath: readProviderOptionString(
        getProviderStartOptions(settings, selectedInstanceQueryOption("opencode").instanceId)
          ?.opencode,
        "binaryPath",
      ),
      cwd: discoveryCwd,
      enabled: openCodeModelDiscoveryEnabled,
    }),
  );

  // Only the providers the server maps onto the cloud catalog are queried;
  // router-style runtimes (cursor/droid/opencode/omp/pi/devin) get their roster from
  // their own CLI, which knows what it can actually start a session with.
  const codexCloudModelsQuery = useQuery(providerCloudModelsQueryOptions("codex"));
  const claudeCloudModelsQuery = useQuery(providerCloudModelsQueryOptions("claudeAgent"));
  const grokCloudModelsQuery = useQuery(providerCloudModelsQueryOptions("grok"));

  const cursorRuntimeModels = useMemo(
    () => collapseCursorModelVariants(cursorDynamicModelsQuery.data?.models ?? []),
    [cursorDynamicModelsQuery.data?.models],
  );

  const hasResolvedCursorModelDiscovery =
    (cursorDynamicModelsQuery.data?.source === "cursor.cli" ||
      cursorDynamicModelsQuery.data?.source === "cursor.acp") &&
    (cursorDynamicModelsQuery.data.models.length ?? 0) > 0;
  const cursorModelDiscoveryPending =
    cursorModelDiscoveryEnabled &&
    !hasResolvedCursorModelDiscovery &&
    isInitialModelDiscoveryPending(cursorDynamicModelsQuery);
  const hasResolvedDroidModelDiscovery =
    droidDynamicModelsQuery.data?.source === "droid-acp" &&
    (droidDynamicModelsQuery.data.models.length ?? 0) > 0;
  const droidModelDiscoveryPending =
    droidModelDiscoveryEnabled &&
    !hasResolvedDroidModelDiscovery &&
    isInitialModelDiscoveryPending(droidDynamicModelsQuery);
  const hasResolvedOpenCodeModelDiscovery =
    (openCodeDynamicModelsQuery.data?.source === "opencode-cli" ||
      openCodeDynamicModelsQuery.data?.source === "opencode") &&
    (openCodeDynamicModelsQuery.data.models.length ?? 0) > 0;
  const openCodeModelDiscoveryPending =
    openCodeModelDiscoveryEnabled &&
    !hasResolvedOpenCodeModelDiscovery &&
    isInitialModelDiscoveryPending(openCodeDynamicModelsQuery);
  const hasResolvedPiModelDiscovery =
    piDynamicModelsQuery.data?.source?.startsWith("pi.sdk") === true &&
    (piDynamicModelsQuery.data.models.length ?? 0) > 0;
  const piModelDiscoveryPending =
    piModelDiscoveryEnabled &&
    !hasResolvedPiModelDiscovery &&
    isInitialModelDiscoveryPending(piDynamicModelsQuery);
  const hasResolvedDevinModelDiscovery =
    (devinDynamicModelsQuery.data?.source === "devin-cli" ||
      // Static fallback descriptors are a valid resolved catalog: the adapter
      // serves its built-in matrix when CLI discovery is unavailable, so the
      // picker must render them instead of spinning (or banner-ing) forever.
      devinDynamicModelsQuery.data?.source === "devin.static") &&
    (devinDynamicModelsQuery.data.models.length ?? 0) > 0;
  const devinModelDiscoveryPending =
    devinModelDiscoveryEnabled &&
    !hasResolvedDevinModelDiscovery &&
    isInitialModelDiscoveryPending(devinDynamicModelsQuery);
  const hasResolvedOmpModelDiscovery =
    (ompDynamicModelsQuery.data?.source === "omp-cli" ||
      ompDynamicModelsQuery.data?.source === "omp-acp") &&
    (ompDynamicModelsQuery.data.models.length ?? 0) > 0;
  // OMP has no static model fallback. A terminal discovery failure (retries
  // exhausted — isError true) must NOT park the picker on the loading skeleton:
  // isInitialModelDiscoveryPending's contract is "a failed provider must not
  // park the model control on a skeleton" (see providerDiscoveryReactQuery).
  // Instead modelOptionsByProvider clears OMP's options on failure so the picker
  // surfaces a load-failure message rather than the hint-only static list
  // (previously-selected model shown as the sole OMP entry — the "collapsed to
  // one model" symptom). Pending stays true only while the first fetch is
  // outstanding or retrying; transient cold-start failures retry under the
  // skeleton before this flag ever flips.
  const ompDiscoveryFailed =
    ompModelDiscoveryEnabled &&
    !hasResolvedOmpModelDiscovery &&
    !isInitialModelDiscoveryPending(ompDynamicModelsQuery);
  const ompModelDiscoveryPending =
    ompModelDiscoveryEnabled && !hasResolvedOmpModelDiscovery && !ompDiscoveryFailed;
  const antigravityModelDiscoveryPending =
    antigravityModelDiscoveryEnabled &&
    !(
      antigravityModelsQuery.data?.source === "antigravity.cli" &&
      (antigravityModelsQuery.data.models.length ?? 0) > 0
    ) &&
    isInitialModelDiscoveryPending(antigravityModelsQuery);

  const modelOptionsByProvider = useMemo(() => {
    const staticOptions: Record<ProviderKind, ReturnType<typeof getAppModelOptions>> = {
      codex: getAppModelOptions("codex", customModelsByProvider.codex, modelHintByProvider?.codex),
      claudeAgent: getAppModelOptions(
        "claudeAgent",
        customModelsByProvider.claudeAgent,
        modelHintByProvider?.claudeAgent,
      ),
      cursor: getAppModelOptions(
        "cursor",
        customModelsByProvider.cursor,
        modelHintByProvider?.cursor,
      ),
      antigravity: getAppModelOptions(
        "antigravity",
        customModelsByProvider.antigravity,
        modelHintByProvider?.antigravity,
      ),
      grok: getAppModelOptions("grok", customModelsByProvider.grok, modelHintByProvider?.grok),
      droid: getAppModelOptions("droid", customModelsByProvider.droid, modelHintByProvider?.droid),
      opencode: getAppModelOptions(
        "opencode",
        customModelsByProvider.opencode,
        modelHintByProvider?.opencode,
      ),
      pi: getAppModelOptions("pi", customModelsByProvider.pi, modelHintByProvider?.pi),
      devin: getAppModelOptions("devin", customModelsByProvider.devin, modelHintByProvider?.devin),
      // Old role picker slugs are internal routing, not custom models. Never
      // promote a persisted role selection back into a selectable placeholder.
      omp: getAppModelOptions(
        "omp",
        customModelsByProvider.omp,
        modelHintByProvider?.omp?.trim().startsWith("role:") ? null : modelHintByProvider?.omp,
      ),
    };
    const result: Record<
      ProviderKind,
      ReadonlyArray<ProviderModelOption & { isCustom?: boolean }>
    > = { ...staticOptions };
    const dynamicSources: Record<ProviderKind, typeof claudeDynamicModelsQuery.data> = {
      claudeAgent: claudeDynamicModelsQuery.data,
      codex: codexDynamicModelsQuery.data,
      cursor:
        cursorDynamicModelsQuery.data === undefined
          ? undefined
          : { ...cursorDynamicModelsQuery.data, models: cursorRuntimeModels },
      antigravity: antigravityModelsQuery.data,
      grok: grokDynamicModelsQuery.data,
      droid: droidDynamicModelsQuery.data,
      opencode: openCodeDynamicModelsQuery.data,
      pi: piDynamicModelsQuery.data,
      devin: devinDynamicModelsQuery.data,
      omp: ompDynamicModelsQuery.data,
    };
    // The cloud catalog is folded into the static baseline first, so a model it
    // publishes survives whether or not runtime discovery answers. Runtime still
    // wins on conflicts: it reflects what the installed CLI actually supports.
    const cloudSources: Partial<
      Record<ProviderKind, ReadonlyArray<CloudModelDescriptor> | undefined>
    > = {
      codex: codexCloudModelsQuery.data?.models,
      claudeAgent: claudeCloudModelsQuery.data?.models,
      grok: grokCloudModelsQuery.data?.models,
    };
    for (const provider of [
      "claudeAgent",
      "codex",
      "cursor",
      "antigravity",
      "grok",
      "droid",
      "opencode",
      "pi",
      "devin",
      "omp",
    ] as const) {
      const cloudModels = cloudSources[provider];
      const baseOptions =
        cloudModels && cloudModels.length > 0
          ? mergeDynamicModelOptions({
              provider,
              staticOptions: staticOptions[provider],
              dynamicModels: cloudModels,
            })
          : staticOptions[provider];
      result[provider] = baseOptions;

      const discovery = dynamicSources[provider];
      const dynamicModels = discovery?.models;
      const hasCodexCatalog =
        provider === "codex" &&
        discovery?.source === "codex-app-server" &&
        discovery.error === undefined;
      if (dynamicModels && (dynamicModels.length > 0 || hasCodexCatalog)) {
        result[provider] = mergeDynamicModelOptions({
          provider,
          staticOptions: baseOptions,
          dynamicModels,
        });
      }
      // Concatenating built-in, catalog, and CLI lists leaves an order nobody
      // chose; rank the result so the strongest models stay on top.
      result[provider] = sortProviderModelOptions(provider, result[provider]);
    }
    // Terminal OMP discovery failure: drop the hint placeholder but keep
    // user-configured custom models — the picker still renders the
    // discovery error line above whatever options remain.
    if (ompDiscoveryFailed) {
      result.omp = staticOptions.omp.filter((option) => option.isCustom === true);
    }
    // Stored custom entries cannot make picker-only role keys into real models.
    // Keep opaque selectors, including exact discovery-proven role: ids.
    result.omp = result.omp.filter((option) => !getOmpModelSelectionIssue(option.slug, result.omp));
    return result;
  }, [
    antigravityModelsQuery.data,
    claudeCloudModelsQuery.data,
    claudeDynamicModelsQuery.data,
    codexCloudModelsQuery.data,
    codexDynamicModelsQuery.data,
    cursorDynamicModelsQuery.data,
    cursorRuntimeModels,
    customModelsByProvider,
    droidDynamicModelsQuery.data,
    grokCloudModelsQuery.data,
    grokDynamicModelsQuery.data,
    modelHintByProvider,
    openCodeDynamicModelsQuery.data,
    piDynamicModelsQuery.data,
    devinDynamicModelsQuery.data,
    ompDynamicModelsQuery.data,
    ompDiscoveryFailed,
  ]);

  const modelOptionsByProviderInstance = useMemo<ProviderModelOptionsByProviderInstance>(() => {
    const selectedInstanceId = (selectedProviderInstanceId?.trim() ||
      selectedProvider) as ProviderInstanceId;
    const byInstance: ProviderModelOptionsByProviderInstance = {};
    for (const instance of providerInstances) {
      const customModels = getCustomModelsForProviderInstance(settings, instance);
      const selectedModelHint =
        instance.provider === selectedProvider && instance.instanceId === selectedInstanceId
          ? modelHintByProvider?.[instance.provider]
          : null;
      let staticOptions: ReadonlyArray<ProviderModelOption & { isCustom?: boolean }> =
        getAppModelOptions(
          instance.provider,
          customModels,
          instance.provider === "omp" && selectedModelHint?.trim().startsWith("role:")
            ? null
            : selectedModelHint,
        );
      const cloudModels =
        instance.provider === "codex"
          ? codexCloudModelsQuery.data?.models
          : instance.provider === "claudeAgent"
            ? claudeCloudModelsQuery.data?.models
            : instance.provider === "grok"
              ? grokCloudModelsQuery.data?.models
              : undefined;
      if (cloudModels?.length) {
        staticOptions = mergeDynamicModelOptions({
          provider: instance.provider,
          staticOptions,
          dynamicModels: cloudModels,
        });
      }
      const discovery = dynamicModelsByProviderInstance[instance.instanceId];
      const dynamicModels = discovery?.models;
      const hasCodexCatalog =
        instance.provider === "codex" &&
        discovery?.source === "codex-app-server" &&
        discovery.error === undefined;
      byInstance[instance.instanceId] =
        dynamicModels && (dynamicModels.length > 0 || hasCodexCatalog)
          ? mergeDynamicModelOptions({
              provider: instance.provider,
              staticOptions,
              dynamicModels,
            })
          : staticOptions;
      if (instance.provider === "omp") {
        const options = dynamicModels?.length
          ? byInstance[instance.instanceId]!
          : staticOptions.filter((option) => option.isCustom === true);
        byInstance[instance.instanceId] = options.filter(
          (option) => !getOmpModelSelectionIssue(option.slug, options),
        );
      }
      byInstance[instance.instanceId] = filterModelOptionsByVisibility(
        instance.provider,
        sortProviderModelOptions(instance.provider, byInstance[instance.instanceId]!),
        settings.hiddenModels,
        selectedModelHint,
      );
    }
    return byInstance;
  }, [
    dynamicModelsByProviderInstance,
    claudeCloudModelsQuery.data?.models,
    codexCloudModelsQuery.data?.models,
    grokCloudModelsQuery.data?.models,
    modelHintByProvider,
    providerInstances,
    selectedProvider,
    selectedProviderInstanceId,
    settings,
  ]);

  const loadingModelProviders = useMemo<Partial<Record<ProviderKind, boolean>>>(
    () => ({
      antigravity: antigravityModelDiscoveryPending,
      cursor: cursorModelDiscoveryPending,
      droid: droidModelDiscoveryPending,
      opencode: openCodeModelDiscoveryPending,
      pi: piModelDiscoveryPending,
      devin: devinModelDiscoveryPending,
      omp: ompModelDiscoveryPending,
    }),
    [
      antigravityModelDiscoveryPending,
      cursorModelDiscoveryPending,
      droidModelDiscoveryPending,
      openCodeModelDiscoveryPending,
      piModelDiscoveryPending,
      devinModelDiscoveryPending,
      ompModelDiscoveryPending,
    ],
  );

  const runtimeModelsByProvider = useMemo<
    Record<ProviderKind, ReadonlyArray<ProviderModelDescriptor>>
  >(
    () => ({
      // Cloud entries fill the gaps so a model newer than this build still
      // reaches the trait picker with its real effort ladder.
      claudeAgent: withCloudModelDescriptors(
        claudeDynamicModelsQuery.data?.models ?? [],
        claudeCloudModelsQuery.data?.models,
      ),
      codex: withCloudModelDescriptors(
        codexDynamicModelsQuery.data?.models ?? [],
        codexCloudModelsQuery.data?.models,
      ),
      cursor: cursorRuntimeModels,
      antigravity: antigravityModelsQuery.data?.models ?? [],
      grok: withCloudModelDescriptors(
        grokDynamicModelsQuery.data?.models ?? [],
        grokCloudModelsQuery.data?.models,
      ),
      droid: droidDynamicModelsQuery.data?.models ?? [],
      opencode: openCodeDynamicModelsQuery.data?.models ?? [],
      pi: piDynamicModelsQuery.data?.models ?? [],
      devin: devinDynamicModelsQuery.data?.models ?? [],
      omp: ompDynamicModelsQuery.data?.models ?? [],
    }),
    [
      antigravityModelsQuery.data?.models,
      claudeCloudModelsQuery.data?.models,
      claudeDynamicModelsQuery.data?.models,
      codexCloudModelsQuery.data?.models,
      codexDynamicModelsQuery.data?.models,
      cursorRuntimeModels,
      droidDynamicModelsQuery.data?.models,
      grokCloudModelsQuery.data?.models,
      grokDynamicModelsQuery.data?.models,
      openCodeDynamicModelsQuery.data?.models,
      piDynamicModelsQuery.data?.models,
      devinDynamicModelsQuery.data?.models,
      ompDynamicModelsQuery.data?.models,
    ],
  );

  // Applied in one place so every surface hides the same models, and so the
  // model a surface is already using is always kept visible.
  const visibleModelOptionsByProvider = useMemo(() => {
    if (settings.hiddenModels.length === 0) {
      return modelOptionsByProvider;
    }
    const result = { ...modelOptionsByProvider };
    for (const provider of Object.keys(result) as ProviderKind[]) {
      result[provider] = filterModelOptionsByVisibility(
        provider,
        result[provider],
        settings.hiddenModels,
        modelHintByProvider?.[provider] ?? null,
      );
    }
    return result;
  }, [modelOptionsByProvider, modelHintByProvider, settings.hiddenModels]);
  const runtimeModelsByProviderInstance = useMemo(() => {
    const byInstance: Partial<Record<ProviderInstanceId, ReadonlyArray<ProviderModelDescriptor>>> =
      {};
    for (const instance of providerInstances) {
      // A configured account without discovery must not fall back to a sibling's
      // runtime metadata. Its static/custom model options remain available above.
      const cloudModels =
        instance.provider === "codex"
          ? codexCloudModelsQuery.data?.models
          : instance.provider === "claudeAgent"
            ? claudeCloudModelsQuery.data?.models
            : instance.provider === "grok"
              ? grokCloudModelsQuery.data?.models
              : undefined;
      byInstance[instance.instanceId] = withCloudModelDescriptors(
        dynamicModelsByProviderInstance[instance.instanceId]?.models ?? [],
        cloudModels,
      );
    }
    return byInstance;
  }, [
    dynamicModelsByProviderInstance,
    providerInstances,
    claudeCloudModelsQuery.data?.models,
    codexCloudModelsQuery.data?.models,
    grokCloudModelsQuery.data?.models,
  ]);

  const selectedRuntimeModel = useMemo(
    () =>
      resolveRuntimeModelDescriptor({
        provider: selectedProvider,
        model: modelHintByProvider?.[selectedProvider] ?? null,
        runtimeModels: runtimeModelsByProvider[selectedProvider],
      }),
    [modelHintByProvider, runtimeModelsByProvider, selectedProvider],
  );

  const selectedDynamicAgents =
    selectedProvider === "claudeAgent"
      ? (claudeDynamicAgentsQuery.data?.agents ?? EMPTY_PROVIDER_AGENTS)
      : selectedProvider === "opencode"
        ? (openCodeDynamicAgentsQuery.data?.agents ?? EMPTY_PROVIDER_AGENTS)
        : (codexDynamicAgentsQuery.data?.agents ?? EMPTY_PROVIDER_AGENTS);
  const selectedRuntimeAgents = useMemo<ReadonlyArray<ProviderAgentDescriptor>>(
    () =>
      selectedDynamicAgents.map((agent) =>
        agent.description
          ? { name: agent.name, displayName: agent.displayName, description: agent.description }
          : { name: agent.name, displayName: agent.displayName },
      ),
    [selectedDynamicAgents],
  );

  // Prompt tokenizing has to know which subagents exist before it can draw an
  // `@alias(...)` chip, and it runs from places with no React context (cursor
  // math). Publishing here — rather than threading the list to each tokenizer
  // call site — keeps the composer, the caret, and the sent-message echo from
  // ever disagreeing about where an agent token starts and ends.
  useEffect(() => {
    setComposerAgentMentionCatalog(selectedRuntimeAgents);
  }, [selectedRuntimeAgents]);

  // Discovery failures per provider, surfaced as a subtle inline note by the
  // model pickers.
  const discoveryErrorsByProvider = useMemo(
    () => ({
      claudeAgent: claudeDynamicModelsQuery.data?.error,
      codex: codexDynamicModelsQuery.data?.error,
      cursor: modelDiscoveryError(
        cursorDynamicModelsQuery.data?.error,
        cursorDynamicModelsQuery.error,
      ),
      devin: modelDiscoveryError(
        devinDynamicModelsQuery.data?.error,
        devinDynamicModelsQuery.error,
      ),
      antigravity: modelDiscoveryError(
        antigravityModelsQuery.data?.error,
        antigravityModelsQuery.error,
      ),
      grok: modelDiscoveryError(grokDynamicModelsQuery.data?.error, grokDynamicModelsQuery.error),
      droid: modelDiscoveryError(
        droidDynamicModelsQuery.data?.error,
        droidDynamicModelsQuery.error,
      ),
      opencode: modelDiscoveryError(
        openCodeDynamicModelsQuery.data?.error,
        openCodeDynamicModelsQuery.error,
      ),
      pi: modelDiscoveryError(piDynamicModelsQuery.data?.error, piDynamicModelsQuery.error),
      omp: modelDiscoveryError(ompDynamicModelsQuery.data?.error, ompDynamicModelsQuery.error),
    }),
    [
      antigravityModelsQuery.data?.error,
      antigravityModelsQuery.error,
      claudeDynamicModelsQuery.data?.error,
      codexDynamicModelsQuery.data?.error,
      cursorDynamicModelsQuery.data?.error,
      cursorDynamicModelsQuery.error,
      devinDynamicModelsQuery.data?.error,
      devinDynamicModelsQuery.error,
      droidDynamicModelsQuery.data?.error,
      droidDynamicModelsQuery.error,
      grokDynamicModelsQuery.data?.error,
      grokDynamicModelsQuery.error,
      openCodeDynamicModelsQuery.data?.error,
      openCodeDynamicModelsQuery.error,
      piDynamicModelsQuery.data?.error,
      piDynamicModelsQuery.error,
      ompDynamicModelsQuery.data?.error,
      ompDynamicModelsQuery.error,
    ],
  );

  const selectedProviderRuntimeModelDiscoveryPending =
    loadingModelProviders[selectedProvider] ?? false;
  const selectedProviderModelsQuery =
    selectedProvider === "claudeAgent"
      ? claudeDynamicModelsQuery
      : selectedProvider === "codex"
        ? codexDynamicModelsQuery
        : selectedProvider === "cursor"
          ? cursorDynamicModelsQuery
          : selectedProvider === "antigravity"
            ? antigravityModelsQuery
            : selectedProvider === "grok"
              ? grokDynamicModelsQuery
              : selectedProvider === "droid"
                ? droidDynamicModelsQuery
                : selectedProvider === "opencode"
                  ? openCodeDynamicModelsQuery
                  : selectedProvider === "omp"
                    ? ompDynamicModelsQuery
                    : selectedProvider === "pi"
                      ? piDynamicModelsQuery
                      : devinDynamicModelsQuery;
  const selectedProviderModelsLoading =
    selectedProviderRuntimeModelDiscoveryPending ||
    (loadingModelProviders[selectedProvider] === undefined &&
      (selectedProviderModelsQuery.isLoading ||
        (selectedProviderModelsQuery.isFetching &&
          selectedProviderModelsQuery.data === undefined)));

  return useMemo(
    () => ({
      refreshModels,
      customModelsByProvider,
      modelOptionsByProvider: visibleModelOptionsByProvider,
      allModelOptionsByProvider: modelOptionsByProvider,
      modelOptionsByProviderInstance,
      loadingModelProviders,
      runtimeModelsByProvider,
      runtimeModelsByProviderInstance,
      selectedRuntimeModel,
      selectedRuntimeAgents,
      selectedProviderModelsLoading,
      selectedProviderRuntimeModelDiscoveryPending,
      discoveryErrorsByProvider,
    }),
    [
      refreshModels,
      customModelsByProvider,
      discoveryErrorsByProvider,
      loadingModelProviders,
      modelOptionsByProvider,
      visibleModelOptionsByProvider,
      modelOptionsByProviderInstance,
      runtimeModelsByProvider,
      runtimeModelsByProviderInstance,
      selectedProviderModelsLoading,
      selectedProviderRuntimeModelDiscoveryPending,
      selectedRuntimeAgents,
      selectedRuntimeModel,
    ],
  );
}

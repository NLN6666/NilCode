// FILE: ModelsSettingsPanel.tsx
// Purpose: Own model-setting discovery, selection, and custom-model editing workflows.
// Layer: Settings panel

import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  GIT_TEXT_GENERATION_PROVIDERS,
  PROVIDER_DISPLAY_NAMES,
  MAX_SOURCE_CONTROL_CUSTOM_INSTRUCTIONS_LENGTH,
  type GitTextGenerationProvider,
  type ProviderKind,
  type SourceControlWritingStyle,
} from "@synara/contracts";
import { getModelOptions, normalizeModelSlug } from "@synara/shared/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { isBetaFeatureOn } from "~/betaFeatures";
import {
  CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS,
  type AppSettingsBinding,
  DEFAULT_MODEL_PROVIDER_SETTINGS,
  MAX_CUSTOM_MODEL_LENGTH,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  getProviderInstanceOptions,
  isGitTextGenerationSettingsDirty,
  patchCustomModels,
} from "~/appSettings";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { PlusIcon, XIcon } from "~/lib/icons";
import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import {
  patchDefaultModelForProvider,
  resolveDefaultModelRef,
  resolveDefaultModelSlug,
} from "~/providerOrdering";
import { defaultModelTraitOptions } from "~/composerDraftModels";
import { getComposerTraitSelection } from "~/components/chat/composerTraits";
import { resolveRuntimeModelDescriptor } from "~/components/chat/runtimeModelCapabilities";
import type { ProviderOptions } from "~/providerModelOptions";
import { refreshCloudModelCatalog } from "~/lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import {
  SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME,
  SETTINGS_INSET_LIST_CLASS_NAME,
} from "~/settingsPanelStyles";

import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  SettingResetButton,
  SettingsSelectControl,
  useSettingsRestoreSignal,
} from "./SettingControls";
import { AdvisorSettingsSection } from "./AdvisorSettingsSection";
import { SettingsRow, SettingsSection, SettingsSelectPopup } from "./SettingsPanelPrimitives";
import { DebouncedSettingTextarea } from "./DebouncedSettingTextInput";
import { useTranslation } from "~/i18n";

const SOURCE_CONTROL_WRITING_OPTIONS: readonly {
  value: SourceControlWritingStyle;
  label: string;
  description: string;
}[] = [
  {
    value: "repository",
    label: "settings:repositoryConventions",
    description: "settings:inEachProjectMatchesRecentChangeDescriptionsAndChange",
  },
  {
    value: "conventional",
    label: "settings:conventionalCommits",
    description: "settings:useConventionalCommitPrefixesAndKeepChangeRequestText",
  },
  {
    value: "custom",
    label: "settings:customInstructions",
    description: "settings:useYourInstructionsForChangeDescriptionsAndChangeRequests",
  },
];

/** Locale-free translation key for a rejected custom slug. */
export type CustomModelValidationError =
  | "settings:modelSlugRequired"
  | "settings:modelAlreadyBuiltIn"
  | "settings:modelSlugTooLong"
  | "settings:customModelAlreadySaved";

type CustomModelValidationResult =
  | { readonly model: string; readonly error?: never }
  | { readonly model?: never; readonly error: CustomModelValidationError };

const VISIBLE_CUSTOM_MODEL_PROVIDER_SETTINGS = CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.filter(
  (config) => isBetaFeatureOn(config.provider),
);
const VISIBLE_DEFAULT_MODEL_PROVIDER_SETTINGS = DEFAULT_MODEL_PROVIDER_SETTINGS.filter((config) =>
  isBetaFeatureOn(config.provider),
);

export function validateCustomModelInput(input: {
  readonly provider: ProviderKind;
  readonly value: string;
  readonly savedModels: readonly string[];
}): CustomModelValidationResult {
  const normalized = normalizeModelSlug(input.value, input.provider);
  if (!normalized) {
    return { error: "settings:modelSlugRequired" };
  }
  if (getModelOptions(input.provider).some((option) => option.slug === normalized)) {
    return { error: "settings:modelAlreadyBuiltIn" };
  }
  if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
    return { error: "settings:modelSlugTooLong" };
  }
  if (input.savedModels.includes(normalized)) {
    return { error: "settings:customModelAlreadySaved" };
  }
  return { model: normalized };
}

function isCustomModelEditorProvider(value: string | null): value is ProviderKind {
  return VISIBLE_CUSTOM_MODEL_PROVIDER_SETTINGS.some((config) => config.provider === value);
}

export function ModelsSettingsPanel({
  settings,
  defaults,
  updateSettings,
  resetEpoch,
  active,
}: AppSettingsBinding & { readonly resetEpoch: number; readonly active: boolean }) {
  const { t } = useTranslation();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const queryClient = useQueryClient();
  const [selectedCustomModelProvider, setSelectedCustomModelProvider] =
    useState<ProviderKind>("codex");
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Partial<Record<ProviderKind, string>>
  >({});
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, CustomModelValidationError | null>>
  >({});
  const [showAllCustomModels, setShowAllCustomModels] = useState(false);
  const [visibilityProvider, setVisibilityProvider] = useState<ProviderKind>("claudeAgent");
  const [defaultModelProvider, setDefaultModelProvider] = useState<ProviderKind>("codex");
  const enabledCustomModelProviderSettings = useMemo(
    () =>
      CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.filter(
        (config) => !settings.disabledProviders.includes(config.provider),
      ),
    [settings.disabledProviders],
  );

  useSettingsRestoreSignal(resetEpoch, () => {
    setSelectedCustomModelProvider("codex");
    setCustomModelInputByProvider({});
    setCustomModelErrorByProvider({});
    setShowAllCustomModels(false);
    setVisibilityProvider("claudeAgent");
    setDefaultModelProvider("codex");
  });

  const { textGenerationModel, textGenerationProvider, textGenerationProviderInstanceId } =
    settings;
  const currentGitTextGenerationProvider = textGenerationProvider ?? "codex";
  const currentGitTextGenerationInstanceId =
    textGenerationProviderInstanceId ?? currentGitTextGenerationProvider;
  const currentGitTextGenerationModel = textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;
  const gitWritingModelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [currentGitTextGenerationProvider]: currentGitTextGenerationModel }),
    [currentGitTextGenerationModel, currentGitTextGenerationProvider],
  );
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: null,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  // The git-writing picker only needs its own providers, but the visibility list
  // below renders every model of the provider being edited, so that one has to be
  // discovered too — otherwise switching it would only ever show built-in models.
  const discoveryProviders = useMemo<ReadonlyArray<ProviderKind>>(
    () => [...GIT_TEXT_GENERATION_PROVIDERS, visibilityProvider, defaultModelProvider],
    [defaultModelProvider, visibilityProvider],
  );
  const {
    modelOptionsByProviderInstance: gitWritingCatalogOptionsByInstance,
    modelOptionsByProvider: defaultModelOptionsByProvider,
    allModelOptionsByProvider,
    runtimeModelsByProvider,
  } = useProviderModelCatalog({
    selectedProvider: currentGitTextGenerationProvider,
    selectedProviderInstanceId: currentGitTextGenerationInstanceId,
    discoveryEnabled: active,
    cwd: providerModelDiscoveryCwd,
    modelHintByProvider: gitWritingModelHintByProvider,
    prefetchProviders: discoveryProviders,
  });
  const providerInstanceOptions = useMemo(() => getProviderInstanceOptions(settings), [settings]);
  const gitTextGenerationPickerOptions = useMemo(
    () =>
      providerInstanceOptions.flatMap((instance) =>
        !settings.disabledProviders.includes(instance.provider) &&
        (instance.enabled || instance.instanceId === currentGitTextGenerationInstanceId) &&
        GIT_TEXT_GENERATION_PROVIDERS.includes(instance.provider as GitTextGenerationProvider)
          ? (gitWritingCatalogOptionsByInstance[instance.instanceId] ?? []).map((option) => ({
              key: `${instance.instanceId}:${instance.provider}:${option.slug}`,
              value: `${instance.instanceId}:${instance.provider}:${option.slug}`,
              instance,
              option: { ...option, provider: instance.provider },
            }))
          : [],
      ),
    [
      currentGitTextGenerationInstanceId,
      gitWritingCatalogOptionsByInstance,
      providerInstanceOptions,
      settings.disabledProviders,
    ],
  );
  const currentGitTextGenerationValue = `${currentGitTextGenerationInstanceId}:${currentGitTextGenerationProvider}:${currentGitTextGenerationModel}`;
  const isGitTextGenerationModelDirty = isGitTextGenerationSettingsDirty(settings, defaults);
  const selectedGitTextGenerationPickerOption = gitTextGenerationPickerOptions.find(
    (entry) => entry.value === currentGitTextGenerationValue,
  );
  const selectedGitTextGenerationModelName =
    selectedGitTextGenerationPickerOption?.option.name ??
    gitWritingCatalogOptionsByInstance[currentGitTextGenerationInstanceId]?.find(
      (option) => option.slug === currentGitTextGenerationModel,
    )?.name ??
    currentGitTextGenerationModel;
  const selectedGitTextGenerationInstanceLabel =
    selectedGitTextGenerationPickerOption?.instance.label ??
    providerInstanceOptions.find(
      (option) => option.instanceId === currentGitTextGenerationInstanceId,
    )?.label;
  const selectedGitTextGenerationModelLabel =
    selectedGitTextGenerationInstanceLabel &&
    selectedGitTextGenerationInstanceLabel !==
      PROVIDER_DISPLAY_NAMES[currentGitTextGenerationProvider]
      ? t("common:symbol9", {
          value0: selectedGitTextGenerationInstanceLabel,
          value1: selectedGitTextGenerationModelName,
        })
      : selectedGitTextGenerationModelName;
  const selectedCustomModelProviderSettings =
    enabledCustomModelProviderSettings.find(
      (config) => config.provider === selectedCustomModelProvider,
    ) ?? enabledCustomModelProviderSettings[0];
  const activeCustomModelProvider =
    selectedCustomModelProviderSettings?.provider ?? selectedCustomModelProvider;
  const selectedCustomModelInput = customModelInputByProvider[activeCustomModelProvider] ?? "";
  const selectedCustomModelErrorKey = customModelErrorByProvider[activeCustomModelProvider] ?? null;
  const selectedCustomModelError =
    selectedCustomModelErrorKey === null
      ? null
      : t(selectedCustomModelErrorKey, { limit: MAX_CUSTOM_MODEL_LENGTH });
  const savedCustomModelRows = useMemo(
    () =>
      enabledCustomModelProviderSettings.flatMap((config) =>
        getCustomModelsForProvider(settings, config.provider).map((slug) => ({
          key: `${config.provider}:${slug}`,
          provider: config.provider,
          providerTitle: config.title,
          slug,
        })),
      ),
    [enabledCustomModelProviderSettings, settings],
  );
  const visibleCustomModelRows = savedCustomModelRows.slice(0, 5);
  const overflowCustomModelRows = savedCustomModelRows.slice(5);

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      const result = validateCustomModelInput({
        provider,
        value: customModelInputByProvider[provider] ?? "",
        savedModels: customModels,
      });
      if ("error" in result) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: result.error,
        }));
        return;
      }

      updateSettings(patchCustomModels(provider, [...customModels, result.model]));
      setCustomModelInputByProvider((existing) => ({ ...existing, [provider]: "" }));
      setCustomModelErrorByProvider((existing) => ({ ...existing, [provider]: null }));
    },
    [customModelInputByProvider, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(
        patchCustomModels(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setCustomModelErrorByProvider((existing) => ({ ...existing, [provider]: null }));
    },
    [settings, updateSettings],
  );

  const resetCustomModels = useCallback(() => {
    const patch = Object.assign(
      {},
      ...enabledCustomModelProviderSettings.map((config) =>
        patchCustomModels(config.provider, [
          ...getDefaultCustomModelsForProvider(defaults, config.provider),
        ]),
      ),
    );
    updateSettings(patch);
    setCustomModelErrorByProvider({});
    setShowAllCustomModels(false);
  }, [defaults, enabledCustomModelProviderSettings, updateSettings]);

  const renderCustomModelRow = (
    row: (typeof savedCustomModelRows)[number],
    removeFirstBorder: boolean,
  ) => (
    <div
      key={row.key}
      className={cn(
        "group grid grid-cols-[minmax(5rem,6rem)_minmax(0,1fr)_auto] items-center gap-3 border-t border-[color:var(--color-border)] px-4 py-2",
        removeFirstBorder && "first:border-t-0",
      )}
    >
      <span className="truncate text-ui leading-snug text-muted-foreground">
        {row.providerTitle}
      </span>
      <code className="min-w-0 truncate text-ui-lg leading-snug text-foreground">{row.slug}</code>
      <button
        type="button"
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
        aria-label={t("workspace:remove", { value0: row.slug })}
        onClick={() => removeCustomModel(row.provider, row.slug)}
      >
        <XIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
      </button>
    </div>
  );

  // Candidates come from the visibility-filtered catalog: a model the user hid
  // must not be selectable as the model every new chat starts on.
  const defaultModelCandidates = defaultModelOptionsByProvider[defaultModelProvider];
  const selectedDefaultModelSlug =
    resolveDefaultModelSlug(settings.defaultModelByProvider, defaultModelProvider) ?? "";
  const selectedDefaultModelLabel =
    selectedDefaultModelSlug.length === 0
      ? t("settings:models_builtInDefault")
      : (defaultModelCandidates.find((option) => option.slug === selectedDefaultModelSlug)?.name ??
        selectedDefaultModelSlug);
  const selectedDefaultRef = resolveDefaultModelRef(
    settings.defaultModelByProvider,
    defaultModelProvider,
  );
  // Reasoning ladders and window options are per-model, so a level carried across a
  // model change could name a rung the new model does not have. Dropping traits
  // returns the new model to its own defaults, which is always a valid state.
  const setDefaultModel = (slug: string) => {
    updateSettings({
      defaultModelByProvider: patchDefaultModelForProvider(
        settings.defaultModelByProvider,
        defaultModelProvider,
        slug.length > 0 ? { slug } : null,
      ),
    });
  };
  const setDefaultModelTrait = (trait: "effort" | "contextWindow", value: string) => {
    if (!selectedDefaultRef) {
      return;
    }
    const next = {
      slug: selectedDefaultRef.slug,
      effort: selectedDefaultRef.effort,
      contextWindow: selectedDefaultRef.contextWindow,
      [trait]: value.length > 0 ? value : undefined,
    };
    updateSettings({
      defaultModelByProvider: patchDefaultModelForProvider(
        settings.defaultModelByProvider,
        defaultModelProvider,
        next,
      ),
    });
  };

  // Read through the same trait resolver the composer uses, fed the runtime-discovered
  // descriptor, so the ladders offered here are the ones the local agent actually
  // reports rather than the static fallback table.
  const defaultRuntimeModel = resolveRuntimeModelDescriptor({
    provider: defaultModelProvider,
    model: selectedDefaultModelSlug,
    runtimeModels: runtimeModelsByProvider[defaultModelProvider],
  });
  const defaultTraits = getComposerTraitSelection(
    defaultModelProvider,
    selectedDefaultModelSlug,
    "",
    defaultModelTraitOptions(defaultModelProvider, selectedDefaultRef) as ProviderOptions,
    defaultRuntimeModel,
  );
  // Prompt-injected rungs (ultrathink) work by prefixing the message, which a stored
  // default has no message to prefix - offering them here would do nothing.
  const defaultEffortLevels = defaultTraits.effortLevels.filter(
    (level) => !defaultTraits.promptInjectedValues.includes(level.value),
  );
  const defaultContextWindowOptions = defaultTraits.contextWindowOptions;
  const showsDefaultTraits =
    selectedDefaultModelSlug.length > 0 &&
    (defaultEffortLevels.length > 0 || defaultContextWindowOptions.length > 1);

  const visibilityModels = allModelOptionsByProvider[visibilityProvider];
  const hiddenSlugsForProvider = new Set(
    settings.hiddenModels
      .filter((entry) => entry.provider === visibilityProvider)
      .map((entry) => entry.slug.toLowerCase()),
  );
  const toggleModelVisibility = (slug: string, visible: boolean) => {
    const others = settings.hiddenModels.filter(
      (entry) =>
        entry.provider !== visibilityProvider || entry.slug.toLowerCase() !== slug.toLowerCase(),
    );
    updateSettings({
      hiddenModels: visible ? others : [...others, { provider: visibilityProvider, slug }],
    });
  };

  // A silent refresh is indistinguishable from a broken button, so both outcomes
  // are reported — including "reached the server but the catalog was empty",
  // which means models.dev is unreachable and only built-in models are on offer.
  const refreshCatalogMutation = useMutation({
    mutationFn: () => refreshCloudModelCatalog(queryClient),
    onSuccess: (modelCount) =>
      toastManager.add(
        modelCount > 0
          ? {
              type: "success",
              title: t("settings:modelCatalog_refreshedTitle"),
              description: t("settings:modelCatalog_refreshedDescription", {
                value0: modelCount,
              }),
            }
          : {
              type: "warning",
              title: t("settings:modelCatalog_unavailableTitle"),
              description: t("settings:modelCatalog_unavailableDescription"),
            },
      ),
    onError: (error: unknown) =>
      toastManager.add({
        type: "error",
        title: t("settings:modelCatalog_refreshFailedTitle"),
        description:
          error instanceof Error
            ? error.message
            : t("settings:modelCatalog_refreshFailedDescription"),
      }),
  });

  if (!active) return null;

  const writingOption = SOURCE_CONTROL_WRITING_OPTIONS.find(
    (option) => option.value === settings.sourceControlWritingStyle,
  )!;
  const isWritingStyleDirty =
    settings.sourceControlWritingStyle !== defaults.sourceControlWritingStyle ||
    settings.sourceControlCustomInstructions !== defaults.sourceControlCustomInstructions;

  return (
    <div className="space-y-6">
      <SettingsSection title="settings:models_generationDefaults">
        <SettingsRow
          id="setting-source-control-writing-style"
          title="settings:sourceControlWritingStyle"
          description={t(writingOption.description)}
          resetAction={
            isWritingStyleDirty ? (
              <SettingResetButton
                label={t("settings:sourceControlWritingStyle2")}
                onClick={() =>
                  updateSettings({
                    sourceControlWritingStyle: defaults.sourceControlWritingStyle,
                    sourceControlCustomInstructions: defaults.sourceControlCustomInstructions,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sourceControlWritingStyle}
              onValueChange={(value) => {
                const option = SOURCE_CONTROL_WRITING_OPTIONS.find(
                  (option) => option.value === value,
                );
                if (option) updateSettings({ sourceControlWritingStyle: option.value });
              }}
              ariaLabel={t("settings:sourceControlWritingStyle")}
              triggerClassName="w-full sm:w-60"
              valueContent={t(writingOption.label)}
            >
              {SOURCE_CONTROL_WRITING_OPTIONS.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  {t(option.label)}
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        >
          <DisclosureRegion open={settings.sourceControlWritingStyle === "custom"}>
            <DebouncedSettingTextarea
              key={resetEpoch}
              className="mt-3 [&_textarea]:min-h-28 [&_textarea]:resize-y"
              aria-label={t("settings:customSourceControlWritingInstructions")}
              placeholder={t("settings:keepTitlesConciseUseShortBulletPointsInDescriptions")}
              maxLength={MAX_SOURCE_CONTROL_CUSTOM_INSTRUCTIONS_LENGTH}
              value={settings.sourceControlCustomInstructions}
              onCommit={(value) => updateSettings({ sourceControlCustomInstructions: value })}
            />
          </DisclosureRegion>
        </SettingsRow>
        <SettingsRow
          id="setting-git-writing-model"
          title="settings:changed_gitWritingModel"
          description="settings:usedForGeneratedCommitMessagesPRTitlesAndBranch"
          resetAction={
            isGitTextGenerationModelDirty ? (
              <SettingResetButton
                label={t("settings:gitWritingModel")}
                onClick={() =>
                  updateSettings({
                    textGenerationProvider: defaults.textGenerationProvider,
                    textGenerationProviderInstanceId: defaults.textGenerationProviderInstanceId,
                    textGenerationModel: defaults.textGenerationModel,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={currentGitTextGenerationValue}
              onValueChange={(value) => {
                if (!value) return;
                const [instanceId, provider, ...modelParts] = value.split(":");
                const model = modelParts.join(":");
                if (!instanceId || !provider || !model) return;
                updateSettings({
                  textGenerationProvider: provider as ProviderKind,
                  textGenerationProviderInstanceId: instanceId,
                  textGenerationModel: model,
                });
              }}
              ariaLabel={t("settings:gitTextGenerationModel")}
              triggerClassName="w-full sm:w-52"
              valueContent={selectedGitTextGenerationModelLabel}
            >
              {gitTextGenerationPickerOptions.map(({ instance, key, option, value }) => (
                <SelectItem hideIndicator key={key} value={value}>
                  {instance.label} / {option.name}
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <AdvisorSettingsSection />

      <SettingsSection title="settings:models_defaultModels">
        <SettingsRow
          title="settings:models_defaultModelPickerTitle"
          anchorKey="models:default-models"
          description="settings:models_defaultModelPickerDescription"
          resetAction={
            settings.defaultModelByProvider.length > 0 ? (
              <SettingResetButton
                label={t("settings:models_defaultModelChoices")}
                onClick={() => updateSettings({ defaultModelByProvider: [] })}
              />
            ) : null
          }
        >
          <div
            className={cn(
              "mt-4 flex flex-col gap-2 pt-4 sm:flex-row sm:items-center",
              SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME,
            )}
          >
            <Select
              value={defaultModelProvider}
              onValueChange={(value) => {
                if (value) setDefaultModelProvider(value as ProviderKind);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings:models_defaultProvider")}
              >
                <SelectValue>{PROVIDER_DISPLAY_NAMES[defaultModelProvider]}</SelectValue>
              </SelectTrigger>
              <SettingsSelectPopup align="start">
                {VISIBLE_DEFAULT_MODEL_PROVIDER_SETTINGS.map((config) => (
                  <SelectItem hideIndicator key={config.provider} value={config.provider}>
                    {PROVIDER_DISPLAY_NAMES[config.provider]}
                  </SelectItem>
                ))}
              </SettingsSelectPopup>
            </Select>

            {defaultModelCandidates.length > 0 ? (
              <SettingsSelectControl
                value={selectedDefaultModelSlug}
                onValueChange={setDefaultModel}
                ariaLabel={t("settings:models_defaultModel")}
                triggerClassName="w-full sm:w-56"
                valueContent={selectedDefaultModelLabel}
              >
                <SelectItem hideIndicator value="">
                  {t("settings:models_builtInDefault")}
                </SelectItem>
                {defaultModelCandidates.map((option) => (
                  <SelectItem hideIndicator key={option.slug} value={option.slug}>
                    {option.name}
                  </SelectItem>
                ))}
              </SettingsSelectControl>
            ) : (
              <p className="text-xs text-muted-foreground">{t("settings:models_noModels")}</p>
            )}
          </div>
          {showsDefaultTraits ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              {defaultEffortLevels.length > 0 ? (
                <SettingsSelectControl
                  value={selectedDefaultRef?.effort ?? ""}
                  onValueChange={(value) => setDefaultModelTrait("effort", value)}
                  ariaLabel={t("settings:models_defaultReasoningLevel")}
                  triggerClassName="w-full sm:w-44"
                  valueContent={
                    defaultEffortLevels.find((level) => level.value === selectedDefaultRef?.effort)
                      ?.label ?? t("settings:models_modelDefault")
                  }
                >
                  <SelectItem hideIndicator value="">
                    {t("settings:models_modelDefault")}
                  </SelectItem>
                  {defaultEffortLevels.map((level) => (
                    <SelectItem hideIndicator key={level.value} value={level.value}>
                      {level.label}
                    </SelectItem>
                  ))}
                </SettingsSelectControl>
              ) : null}
              {defaultContextWindowOptions.length > 1 ? (
                <SettingsSelectControl
                  value={selectedDefaultRef?.contextWindow ?? ""}
                  onValueChange={(value) => setDefaultModelTrait("contextWindow", value)}
                  ariaLabel={t("settings:models_defaultContextWindow")}
                  triggerClassName="w-full sm:w-44"
                  valueContent={
                    defaultContextWindowOptions.find(
                      (option) => option.value === selectedDefaultRef?.contextWindow,
                    )?.label ?? t("settings:models_modelDefault")
                  }
                >
                  <SelectItem hideIndicator value="">
                    {t("settings:models_modelDefault")}
                  </SelectItem>
                  {defaultContextWindowOptions.map((option) => (
                    <SelectItem hideIndicator key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SettingsSelectControl>
              ) : null}
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="settings:models_visibleModels">
        <SettingsRow
          title="settings:models_visibleModelPickerTitle"
          anchorKey="models:visible-models"
          description="settings:models_visibleModelPickerDescription"
          resetAction={
            settings.hiddenModels.length > 0 ? (
              <SettingResetButton
                label={t("settings:models_visibleModelsResetLabel")}
                onClick={() => updateSettings({ hiddenModels: [] })}
              />
            ) : null
          }
        >
          <div className={cn("mt-4 pt-4", SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME)}>
            <Select
              value={visibilityProvider}
              onValueChange={(value) => {
                if (value) setVisibilityProvider(value as ProviderKind);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings:models_provider")}
              >
                <SelectValue>{PROVIDER_DISPLAY_NAMES[visibilityProvider]}</SelectValue>
              </SelectTrigger>
              <SettingsSelectPopup align="start">
                {VISIBLE_CUSTOM_MODEL_PROVIDER_SETTINGS.map((config) => (
                  <SelectItem hideIndicator key={config.provider} value={config.provider}>
                    {PROVIDER_DISPLAY_NAMES[config.provider]}
                  </SelectItem>
                ))}
              </SettingsSelectPopup>
            </Select>

            {visibilityModels.length > 0 ? (
              <div className={cn("mt-3", SETTINGS_INSET_LIST_CLASS_NAME)}>
                {visibilityModels.map((model) => {
                  const visible = !hiddenSlugsForProvider.has(model.slug.toLowerCase());
                  return (
                    <div
                      key={model.slug}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-[color:var(--color-border)] px-4 py-2 first:border-t-0"
                    >
                      <div className="min-w-0">
                        <span className="block truncate text-sm text-foreground">{model.name}</span>
                        <code className="block truncate text-xs text-muted-foreground">
                          {model.slug}
                        </code>
                      </div>
                      <Switch
                        checked={visible}
                        onCheckedChange={(next) => toggleModelVisibility(model.slug, next)}
                        aria-label={t("settings:models_showModel", { value0: model.name })}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{t("settings:models_noModels")}</p>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="settings:changed_customModels">
        <SettingsRow
          id="setting-saved-model-slugs"
          title="settings:models_savedModelSlugs"
          anchorKey="models:saved-model-slugs"
          description="settings:addCustomModelSlugsForSupportedProviders"
          resetAction={
            savedCustomModelRows.length > 0 ? (
              <SettingResetButton label={t("settings:customModels")} onClick={resetCustomModels} />
            ) : null
          }
        >
          <div className={cn("mt-4 pt-4", SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME)}>
            {selectedCustomModelProviderSettings ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  value={activeCustomModelProvider}
                  onValueChange={(value) => {
                    if (isCustomModelEditorProvider(value)) {
                      setSelectedCustomModelProvider(value);
                    }
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-40"
                    aria-label={t("settings:customModelProvider")}
                  >
                    <SelectValue>{selectedCustomModelProviderSettings.title}</SelectValue>
                  </SelectTrigger>
                  <SettingsSelectPopup align="start">
                    {enabledCustomModelProviderSettings.map((config) => (
                      <SelectItem hideIndicator key={config.provider} value={config.provider}>
                        {config.title}
                      </SelectItem>
                    ))}
                  </SettingsSelectPopup>
                </Select>
                <Input
                  id="custom-model-slug"
                  size="sm"
                  variant="soft"
                  value={selectedCustomModelInput}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCustomModelInputByProvider((existing) => ({
                      ...existing,
                      [activeCustomModelProvider]: value,
                    }));
                    if (selectedCustomModelError) {
                      setCustomModelErrorByProvider((existing) => ({
                        ...existing,
                        [activeCustomModelProvider]: null,
                      }));
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    addCustomModel(activeCustomModelProvider);
                  }}
                  placeholder={selectedCustomModelProviderSettings.example}
                  spellCheck={false}
                />
                <Button
                  className="shrink-0"
                  variant="outline"
                  onClick={() => addCustomModel(activeCustomModelProvider)}
                >
                  <PlusIcon className="size-3.5" />
                  {t("workspace:models_add")}
                </Button>
              </div>
            ) : (
              <p className="text-ui text-muted-foreground">
                {t("settings:enableAProviderInSettingsProvidersToAddCustom")}
              </p>
            )}

            {selectedCustomModelError ? (
              <p className="mt-2 text-ui leading-snug text-destructive">
                {t(selectedCustomModelError, { limit: MAX_CUSTOM_MODEL_LENGTH })}
              </p>
            ) : null}

            {savedCustomModelRows.length > 0 ? (
              <div className={cn("mt-3", SETTINGS_INSET_LIST_CLASS_NAME)}>
                {visibleCustomModelRows.map((row) => renderCustomModelRow(row, true))}
                {overflowCustomModelRows.length > 0 ? (
                  <>
                    <DisclosureRegion open={showAllCustomModels}>
                      <div>
                        {overflowCustomModelRows.map((row) => renderCustomModelRow(row, false))}
                      </div>
                    </DisclosureRegion>
                    <button
                      type="button"
                      className="mt-2 text-ui leading-snug text-muted-foreground transition-colors hover:text-foreground"
                      aria-expanded={showAllCustomModels}
                      onClick={() => setShowAllCustomModels((value) => !value)}
                    >
                      {showAllCustomModels
                        ? t("workspace:timeline_showLess")
                        : t("settings:showMore", { value0: overflowCustomModelRows.length })}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

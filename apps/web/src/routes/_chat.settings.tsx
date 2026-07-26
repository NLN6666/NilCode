// FILE: _chat.settings.tsx
// Purpose: Render the dedicated settings experience with its own section sidebar and grouped panels.
// Layer: Route screen
// Exports: Settings route component for `/settings`

import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@synara/contracts";
import { PROVIDER_DESCRIPTORS } from "@synara/shared/providerMetadata";
import { sameAppSnapShortcut } from "@synara/shared/appSnapShortcut";
import { isLocale, SUPPORTED_LOCALES } from "@synara/shared/i18n";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  type AppSettings,
  DEFAULT_UI_DENSITY,
  type UiDensity,
  MAX_CHAT_FONT_SIZE_PX,
  MAX_TERMINAL_FONT_SIZE_PX,
  MIN_CHAT_FONT_SIZE_PX,
  MIN_TERMINAL_FONT_SIZE_PX,
  normalizeChatFontSizePx,
  normalizeTerminalFontFamily,
  normalizeTerminalFontSizePx,
  isGitTextGenerationSettingsDirty,
  TERMINAL_FONT_FAMILY_SUGGESTIONS,
  useAppSettings,
} from "../appSettings";
import { APP_VERSION } from "../branding";
import { AdvancedSettingsPanel } from "~/components/settings/AdvancedSettingsPanel";
import {
  ArchivedSettingsPanel,
  WorktreesSettingsPanel,
} from "~/components/settings/ConversationStorageSettingsPanels";
import {
  AppSnapSettingsPanel,
  NotificationsSettingsPanel,
} from "~/components/settings/DesktopSettingsPanels";
import { ModelsSettingsPanel } from "~/components/settings/ModelsSettingsPanel";
import {
  isProviderInstallSettingsDirty,
  ProvidersSettingsPanel,
} from "~/components/settings/ProvidersSettingsPanel";
import { LOCALE_LABELS } from "../i18n/catalogs";
import { useMessages } from "../i18n/context";
import type { Messages } from "../i18n/locales/en";
import { ProviderOptionLabel } from "../components/ProviderIcon";
import ReleaseHistoryDialog from "../components/ReleaseHistoryDialog";
import { KeyboardShortcutsSettingsPanel } from "../components/settings/KeyboardShortcutsSettingsPanel";
import { ProfileSettingsPanel } from "../components/settings/ProfileSettingsPanel";
import { ProviderUsageSettingsPanel } from "../components/settings/ProviderUsageSettingsPanel";
import { ExternalMcpSettingsPanel } from "../components/settings/ExternalMcpSettingsPanel";
import { AgentMcpSettingsPanel } from "../components/settings/AgentMcpSettingsPanel";
import {
  SettingResetButton,
  SettingsSegmentedControl,
  type SettingsSegmentedOption,
  SettingsSelectControl,
} from "../components/settings/SettingControls";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "../components/settings/SettingsPanelPrimitives";
import { SkillsSettingsPanel } from "../components/settings/SkillsSettingsPanel";
import { ThemePackEditor } from "../components/ThemePackEditor";
import {
  CHAT_CONTENT_CARD_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import {
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "../components/chat/chatHeaderControls";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "../components/ui/autocomplete";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SelectItem } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { RouteInsetSurface } from "../components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "../components/SidebarHeaderNavigationControls";
import { useDesktopTopBarTrafficLightGutterClassName } from "../hooks/useDesktopTopBarGutter";
import { useTheme } from "../hooks/useTheme";
import { isUiDensity } from "../lib/appDensity";
import { DeviceLaptopIcon, MoonIcon, RotateCcwIcon, SunIcon } from "../lib/icons";
import { cn, isMacPlatform } from "../lib/utils";
import { ensureNativeApi, readNativeApi } from "../nativeApi";
import { sameProviderOrder } from "../providerOrdering";
import { normalizeSettingsSection, SETTINGS_TARGETS } from "../settingsNavigation";
import {
  SETTINGS_PAGE_BACKGROUND_CLASS_NAME,
  SETTINGS_PANEL_SECTION_CLASS_NAME,
  SETTINGS_SECTION_LABEL_CLASS_NAME,
} from "../settingsPanelStyles";

// ── Settings taxonomy ──────────────────────────────────────────────────────

const PROVIDER_SELECT_OPTIONS = PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.kind);

// Option rows carry translated labels, so they are derived from the active catalog rather than
// declared as module constants. Icons stay here because they never change with locale.
function themeOptions(
  m: Messages,
): readonly SettingsSegmentedOption<"light" | "dark" | "system">[] {
  return [
    { value: "light", label: m.settings.appearance.theme.options.light, icon: <SunIcon /> },
    { value: "dark", label: m.settings.appearance.theme.options.dark, icon: <MoonIcon /> },
    {
      value: "system",
      label: m.settings.appearance.theme.options.system,
      icon: <DeviceLaptopIcon />,
    },
  ];
}

function uiDensityOptions(m: Messages): readonly SettingsSegmentedOption<UiDensity>[] {
  return [
    { value: "compact", label: m.settings.appearance.uiDensity.options.compact },
    { value: "comfortable", label: m.settings.appearance.uiDensity.options.comfortable },
    { value: "spacious", label: m.settings.appearance.uiDensity.options.spacious },
  ];
}

// ── Settings UI primitives ────────────────────────────────────────────────

// Shared settings controls live in ~/components/settings/SettingControls.

function isProviderSelectOption(value: string): value is ProviderKind {
  return PROVIDER_SELECT_OPTIONS.includes(value as ProviderKind);
}

// Keys of AppSettings whose value is a plain boolean — the only ones that can be
// driven by the shared on/off toggle row below.
type BooleanSettingKey = {
  [Key in keyof AppSettings]-?: AppSettings[Key] extends boolean ? Key : never;
}[keyof AppSettings];

// ── Route screen ───────────────────────────────────────────────────────────

function SettingsRouteView() {
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const activeSection = normalizeSettingsSection(routeSearch.section);
  const settingsTarget = typeof routeSearch.target === "string" ? routeSearch.target : null;

  const {
    isDefaultActiveTheme,
    resetAllThemes,
    resolvedTheme,
    theme,
    setTheme,
    systemUiFont,
    setSystemUiFont,
  } = useTheme();
  const { settings, defaults, updateSettings, resetSettings } = useAppSettings();
  const m = useMessages();
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const [resetEpoch, setResetEpoch] = useState(0);
  const shouldShowFontSmoothing = isMacPlatform(
    typeof navigator === "undefined" ? "" : navigator.platform,
  );
  const visibleTerminalFontFamilySuggestions = useMemo(() => {
    const query = settings.terminalFontFamily.trim().toLowerCase();
    if (!query) return TERMINAL_FONT_FAMILY_SUGGESTIONS;
    return TERMINAL_FONT_FAMILY_SUGGESTIONS.filter((suggestion) =>
      suggestion.toLowerCase().includes(query),
    );
  }, [settings.terminalFontFamily]);

  const isGitTextGenerationModelDirty = isGitTextGenerationSettingsDirty(settings, defaults);
  const isInstallSettingsDirty = isProviderInstallSettingsDirty(settings, defaults);
  const hiddenProviderCount = new Set(settings.hiddenProviders).size;
  const isProviderOrderDirty = !sameProviderOrder(settings.providerOrder, defaults.providerOrder);

  // Deep links and sidebar search targets all resolve to stable DOM ids in the active panel.
  useEffect(() => {
    if (!settingsTarget) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(settingsTarget)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, settingsTarget]);

  const changedSettingLabels = [
    ...(theme !== "system" ? ["Theme"] : []),
    ...(!isDefaultActiveTheme ? [`${resolvedTheme === "dark" ? "Dark" : "Light"} theme pack`] : []),
    ...(settings.defaultProvider !== defaults.defaultProvider ? ["Default provider"] : []),
    ...(settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? ["New thread mode"] : []),
    ...(settings.sidebarProjectSortOrder !== defaults.sidebarProjectSortOrder
      ? ["Project sort order"]
      : []),
    ...(settings.sidebarThreadSortOrder !== defaults.sidebarThreadSortOrder
      ? ["Thread sort order"]
      : []),
    ...(settings.showChatsSection !== defaults.showChatsSection ? ["Chats section"] : []),
    ...(settings.showStudioSection !== defaults.showStudioSection ? ["Studio section"] : []),
    ...(settings.uiDensity !== defaults.uiDensity ? ["UI density"] : []),
    ...(settings.chatFontSizePx !== defaults.chatFontSizePx ? ["Base font size"] : []),
    ...(settings.terminalFontSizePx !== defaults.terminalFontSizePx ? ["Terminal font size"] : []),
    ...(settings.terminalFontFamily !== defaults.terminalFontFamily ? ["Terminal font"] : []),
    ...(shouldShowFontSmoothing &&
    settings.enableNativeFontSmoothing !== defaults.enableNativeFontSmoothing
      ? ["Font smoothing"]
      : []),
    ...(settings.timestampFormat !== defaults.timestampFormat ? ["Time format"] : []),
    ...(settings.enableTaskCompletionToasts !== defaults.enableTaskCompletionToasts
      ? ["Activity toasts"]
      : []),
    ...(settings.enableSystemTaskCompletionNotifications !==
    defaults.enableSystemTaskCompletionNotifications
      ? ["Desktop notifications"]
      : []),
    ...(settings.enableAssistantStreaming !== defaults.enableAssistantStreaming
      ? ["Assistant output"]
      : []),
    ...(settings.enableAppSnap !== defaults.enableAppSnap ? ["AppSnap"] : []),
    ...(!sameAppSnapShortcut(settings.appSnapShortcut, defaults.appSnapShortcut)
      ? ["AppSnap shortcut"]
      : []),
    ...(settings.appSnapPlaySound !== defaults.appSnapPlaySound ? ["AppSnap capture sound"] : []),
    ...(settings.enableProviderUpdateChecks !== defaults.enableProviderUpdateChecks
      ? ["Provider update checks"]
      : []),
    ...(settings.diffWordWrap !== defaults.diffWordWrap ? ["Diff line wrapping"] : []),
    ...(settings.confirmThreadDelete !== defaults.confirmThreadDelete
      ? ["Delete confirmation"]
      : []),
    ...(settings.confirmThreadArchive !== defaults.confirmThreadArchive
      ? ["Archive confirmation"]
      : []),
    ...(settings.confirmTerminalTabClose !== defaults.confirmTerminalTabClose
      ? ["Terminal close confirmation"]
      : []),
    ...(isGitTextGenerationModelDirty ? ["Git writing model"] : []),
    ...(settings.customCodexModels.length > 0 ||
    settings.customClaudeModels.length > 0 ||
    settings.customCursorModels.length > 0 ||
    settings.customAntigravityModels.length > 0 ||
    settings.customGrokModels.length > 0 ||
    settings.customDroidModels.length > 0 ||
    settings.customKiloModels.length > 0 ||
    settings.customOpenCodeModels.length > 0 ||
    settings.customPiModels.length > 0
      ? ["Custom models"]
      : []),
    ...(isInstallSettingsDirty ? ["Provider installs"] : []),
    ...(hiddenProviderCount > 0 ? ["Provider visibility"] : []),
    ...(isProviderOrderDirty ? ["Provider order"] : []),
  ];

  async function restoreDefaults() {
    if (changedSettingLabels.length === 0) return;

    const api = readNativeApi();
    const confirmed = await (api ?? ensureNativeApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    setTheme("system");
    resetAllThemes();
    resetSettings();
    setResetEpoch((current) => current + 1);
  }

  // Shared on/off settings row: a labelled Switch bound to a boolean AppSettings
  // key, with the standard "reset to default" affordance shown only when changed.
  // Rows with bespoke controls (e.g. the desktop-notifications Test button) keep
  // their own markup instead of using this helper.
  const renderBooleanSettingRow = (config: {
    settingKey: BooleanSettingKey;
    title: string;
    description: string;
    resetLabel: string;
    ariaLabel: string;
    anchorKey?: string;
  }) => {
    const { settingKey, title, description, resetLabel, ariaLabel, anchorKey } = config;
    const isChanged = settings[settingKey] !== defaults[settingKey];
    return (
      <SettingsRow
        anchorKey={anchorKey}
        title={title}
        description={description}
        resetAction={
          isChanged ? (
            <SettingResetButton
              label={resetLabel}
              onClick={() =>
                updateSettings({ [settingKey]: defaults[settingKey] } as Partial<AppSettings>)
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings[settingKey]}
            onCheckedChange={(checked) =>
              updateSettings({ [settingKey]: Boolean(checked) } as Partial<AppSettings>)
            }
            aria-label={ariaLabel}
          />
        }
      />
    );
  };

  const renderGeneralPanel = () => (
    <div className="space-y-6">
      <SettingsSection title={m.settings.general.coreDefaults.title}>
        <SettingsRow
          anchorKey="general:language"
          title={m.settings.general.coreDefaults.language.title}
          description={m.settings.general.coreDefaults.language.description}
          resetAction={
            settings.language !== defaults.language ? (
              <SettingResetButton
                label={m.settings.general.coreDefaults.language.resetLabel}
                onClick={() => updateSettings({ language: defaults.language })}
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.language}
              onValueChange={(value) => {
                if (!isLocale(value)) return;
                updateSettings({ language: value });
              }}
              ariaLabel={m.settings.general.coreDefaults.language.ariaLabel}
              valueContent={LOCALE_LABELS[settings.language]}
            >
              {SUPPORTED_LOCALES.map((locale) => (
                <SelectItem hideIndicator key={locale} value={locale}>
                  {LOCALE_LABELS[locale]}
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />

        <SettingsRow
          anchorKey="general:default-provider"
          title={m.settings.general.coreDefaults.defaultProvider.title}
          description={m.settings.general.coreDefaults.defaultProvider.description}
          resetAction={
            settings.defaultProvider !== defaults.defaultProvider ? (
              <SettingResetButton
                label={m.settings.general.coreDefaults.defaultProvider.resetLabel}
                onClick={() => updateSettings({ defaultProvider: defaults.defaultProvider })}
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.defaultProvider}
              onValueChange={(value) => {
                if (!isProviderSelectOption(value)) return;
                updateSettings({ defaultProvider: value });
              }}
              ariaLabel={m.settings.general.coreDefaults.defaultProvider.ariaLabel}
              valueContent={
                <ProviderOptionLabel
                  provider={settings.defaultProvider}
                  label={PROVIDER_DISPLAY_NAMES[settings.defaultProvider]}
                />
              }
            >
              {PROVIDER_SELECT_OPTIONS.map((provider) => (
                <SelectItem hideIndicator key={provider} value={provider}>
                  <ProviderOptionLabel
                    provider={provider}
                    label={PROVIDER_DISPLAY_NAMES[provider]}
                  />
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />

        <SettingsRow
          anchorKey="general:new-threads"
          title={m.settings.general.coreDefaults.newThreads.title}
          description={m.settings.general.coreDefaults.newThreads.description}
          resetAction={
            settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? (
              <SettingResetButton
                label={m.settings.general.coreDefaults.newThreads.resetLabel}
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: defaults.defaultThreadEnvMode,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value !== "local" && value !== "worktree") return;
                updateSettings({
                  defaultThreadEnvMode: value,
                });
              }}
              ariaLabel={m.settings.general.coreDefaults.newThreads.ariaLabel}
              valueContent={
                settings.defaultThreadEnvMode === "worktree"
                  ? m.settings.general.coreDefaults.newThreads.worktree
                  : m.settings.general.coreDefaults.newThreads.local
              }
            >
              <SelectItem hideIndicator value="local">
                {m.settings.general.coreDefaults.newThreads.local}
              </SelectItem>
              <SelectItem hideIndicator value="worktree">
                {m.settings.general.coreDefaults.newThreads.worktree}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <SettingsSection title={m.settings.general.sidebarOrganization.title}>
        <SettingsRow
          anchorKey="general:project-order"
          title={m.settings.general.sidebarOrganization.projectOrder.title}
          description={m.settings.general.sidebarOrganization.projectOrder.description}
          resetAction={
            settings.sidebarProjectSortOrder !== defaults.sidebarProjectSortOrder ? (
              <SettingResetButton
                label={m.settings.general.sidebarOrganization.projectOrder.resetLabel}
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: defaults.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (value !== "updated_at" && value !== "created_at" && value !== "manual") {
                  return;
                }
                updateSettings({ sidebarProjectSortOrder: value });
              }}
              ariaLabel={m.settings.general.sidebarOrganization.projectOrder.ariaLabel}
              valueContent={
                m.settings.general.sidebarOrganization.projectOrder.options[
                  settings.sidebarProjectSortOrder
                ]
              }
            >
              <SelectItem hideIndicator value="updated_at">
                {m.settings.general.sidebarOrganization.projectOrder.options.updated_at}
              </SelectItem>
              <SelectItem hideIndicator value="created_at">
                {m.settings.general.sidebarOrganization.projectOrder.options.created_at}
              </SelectItem>
              <SelectItem hideIndicator value="manual">
                {m.settings.general.sidebarOrganization.projectOrder.options.manual}
              </SelectItem>
            </SettingsSelectControl>
          }
        />

        <SettingsRow
          anchorKey="general:thread-order"
          title={m.settings.general.sidebarOrganization.threadOrder.title}
          description={m.settings.general.sidebarOrganization.threadOrder.description}
          resetAction={
            settings.sidebarThreadSortOrder !== defaults.sidebarThreadSortOrder ? (
              <SettingResetButton
                label={m.settings.general.sidebarOrganization.threadOrder.resetLabel}
                onClick={() =>
                  updateSettings({
                    sidebarThreadSortOrder: defaults.sidebarThreadSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sidebarThreadSortOrder}
              onValueChange={(value) => {
                if (value !== "updated_at" && value !== "created_at") {
                  return;
                }
                updateSettings({ sidebarThreadSortOrder: value });
              }}
              ariaLabel={m.settings.general.sidebarOrganization.threadOrder.ariaLabel}
              valueContent={
                m.settings.general.sidebarOrganization.threadOrder.options[
                  settings.sidebarThreadSortOrder
                ]
              }
            >
              <SelectItem hideIndicator value="updated_at">
                {m.settings.general.sidebarOrganization.threadOrder.options.updated_at}
              </SelectItem>
              <SelectItem hideIndicator value="created_at">
                {m.settings.general.sidebarOrganization.threadOrder.options.created_at}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <SettingsSection title={m.settings.general.sidebarSections.title}>
        {renderBooleanSettingRow({
          settingKey: "showChatsSection",
          anchorKey: "general:chats-section",
          ...m.settings.general.sidebarSections.chats,
        })}

        {renderBooleanSettingRow({
          settingKey: "showStudioSection",
          anchorKey: "general:studio-section",
          ...m.settings.general.sidebarSections.studio,
        })}
      </SettingsSection>

      <div id={SETTINGS_TARGETS.environmentPanel}>
        <SettingsSection title={m.settings.general.environmentPanel.title}>
          {renderBooleanSettingRow({
            settingKey: "environmentPanelDefaultOpen",
            anchorKey: "general:environment-default-open",
            ...m.settings.general.environmentPanel.defaultOpen,
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentUsage",
            anchorKey: "general:environment-usage",
            ...m.settings.general.environmentPanel.usage,
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentRepository",
            anchorKey: "general:environment-repository",
            ...m.settings.general.environmentPanel.repository,
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentPullRequest",
            anchorKey: "general:environment-pull-request",
            ...m.settings.general.environmentPanel.pullRequest,
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentEditor",
            anchorKey: "general:environment-editor",
            ...m.settings.general.environmentPanel.editor,
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentRecap",
            anchorKey: "general:environment-recap",
            ...m.settings.general.environmentPanel.recap,
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentPinned",
            anchorKey: "general:environment-pinned",
            ...m.settings.general.environmentPanel.pinned,
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentMarkers",
            anchorKey: "general:environment-markers",
            ...m.settings.general.environmentPanel.markers,
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentInstructions",
            anchorKey: "general:environment-instructions",
            ...m.settings.general.environmentPanel.instructions,
          })}

          {renderBooleanSettingRow({
            settingKey: "showEnvironmentNotepad",
            anchorKey: "general:environment-notepad",
            ...m.settings.general.environmentPanel.notepad,
          })}
        </SettingsSection>
      </div>
    </div>
  );

  const renderAppearancePanel = () => (
    <div className="space-y-6">
      <section className={SETTINGS_PANEL_SECTION_CLASS_NAME}>
        <h2 className={SETTINGS_SECTION_LABEL_CLASS_NAME}>
          {m.settings.appearance.themeAndTypography}
        </h2>
        <SettingsCard>
          <SettingsRow
            anchorKey="appearance:theme"
            title={m.settings.appearance.theme.title}
            description={m.settings.appearance.theme.description}
            resetAction={
              theme !== "system" ? (
                <SettingResetButton
                  label={m.settings.appearance.theme.resetLabel}
                  onClick={() => setTheme("system")}
                />
              ) : null
            }
            control={
              <SettingsSegmentedControl
                value={theme}
                onValueChange={(value) => {
                  if (value !== "system" && value !== "light" && value !== "dark") return;
                  setTheme(value);
                }}
                ariaLabel={m.settings.appearance.theme.ariaLabel}
                options={themeOptions(m)}
              />
            }
          />
          <SettingsRow
            anchorKey="appearance:system-ui-font"
            title={m.settings.appearance.systemUiFont.title}
            description={m.settings.appearance.systemUiFont.description}
            resetAction={
              !systemUiFont ? (
                <SettingResetButton
                  label={m.settings.appearance.systemUiFont.resetLabel}
                  onClick={() => setSystemUiFont(true)}
                />
              ) : null
            }
            control={
              <Switch
                checked={systemUiFont}
                onCheckedChange={(checked) => setSystemUiFont(Boolean(checked))}
                aria-label={m.settings.appearance.systemUiFont.ariaLabel}
              />
            }
          />
        </SettingsCard>

        <div className="space-y-3">
          {(resolvedTheme === "dark"
            ? (["dark", "light"] as const)
            : (["light", "dark"] as const)
          ).map((variant) => (
            <ThemePackEditor
              key={variant}
              variant={variant}
              isActive={resolvedTheme === variant}
              mode={theme}
            />
          ))}
        </div>

        <SettingsCard>
          <SettingsRow
            anchorKey="appearance:ui-density"
            title={m.settings.appearance.uiDensity.title}
            description={m.settings.appearance.uiDensity.description}
            resetAction={
              settings.uiDensity !== defaults.uiDensity ? (
                <SettingResetButton
                  label={m.settings.appearance.uiDensity.resetLabel}
                  onClick={() =>
                    updateSettings({
                      uiDensity: DEFAULT_UI_DENSITY,
                    })
                  }
                />
              ) : null
            }
            control={
              <SettingsSegmentedControl
                value={settings.uiDensity}
                onValueChange={(value) => {
                  if (!isUiDensity(value)) {
                    return;
                  }
                  updateSettings({ uiDensity: value });
                }}
                ariaLabel={m.settings.appearance.uiDensity.ariaLabel}
                options={uiDensityOptions(m)}
              />
            }
          />

          <SettingsRow
            anchorKey="appearance:base-font-size"
            title={m.settings.appearance.baseFontSize.title}
            description={m.settings.appearance.baseFontSize.description}
            resetAction={
              settings.chatFontSizePx !== defaults.chatFontSizePx ? (
                <SettingResetButton
                  label={m.settings.appearance.baseFontSize.resetLabel}
                  onClick={() =>
                    updateSettings({
                      chatFontSizePx: defaults.chatFontSizePx,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                <Input
                  type="number"
                  size="sm"
                  min={MIN_CHAT_FONT_SIZE_PX}
                  max={MAX_CHAT_FONT_SIZE_PX}
                  step={1}
                  inputMode="numeric"
                  variant="soft"
                  className="w-full text-right sm:w-20"
                  value={String(settings.chatFontSizePx)}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    if (nextValue.length === 0) return;
                    updateSettings({
                      chatFontSizePx: normalizeChatFontSizePx(Number(nextValue)),
                    });
                  }}
                  aria-label={m.settings.appearance.baseFontSize.ariaLabel}
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            }
          />

          <SettingsRow
            anchorKey="appearance:terminal-font-size"
            title={m.settings.appearance.terminalFontSize.title}
            description={m.settings.appearance.terminalFontSize.description}
            resetAction={
              settings.terminalFontSizePx !== defaults.terminalFontSizePx ? (
                <SettingResetButton
                  label={m.settings.appearance.terminalFontSize.resetLabel}
                  onClick={() =>
                    updateSettings({
                      terminalFontSizePx: defaults.terminalFontSizePx,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                <Input
                  type="number"
                  size="sm"
                  min={MIN_TERMINAL_FONT_SIZE_PX}
                  max={MAX_TERMINAL_FONT_SIZE_PX}
                  step={1}
                  inputMode="numeric"
                  variant="soft"
                  className="w-full text-right sm:w-20"
                  value={String(settings.terminalFontSizePx)}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    if (nextValue.length === 0) return;
                    updateSettings({
                      terminalFontSizePx: normalizeTerminalFontSizePx(Number(nextValue)),
                    });
                  }}
                  aria-label={m.settings.appearance.terminalFontSize.ariaLabel}
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            }
          />

          <SettingsRow
            anchorKey="appearance:terminal-font"
            title={m.settings.appearance.terminalFont.title}
            description={m.settings.appearance.terminalFont.description}
            resetAction={
              settings.terminalFontFamily !== defaults.terminalFontFamily ? (
                <SettingResetButton
                  label={m.settings.appearance.terminalFont.resetLabel}
                  onClick={() =>
                    updateSettings({
                      terminalFontFamily: defaults.terminalFontFamily,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center justify-end sm:w-auto">
                <Autocomplete
                  items={visibleTerminalFontFamilySuggestions}
                  mode="none"
                  openOnInputClick
                  value={settings.terminalFontFamily}
                  onValueChange={(value) => {
                    updateSettings({
                      terminalFontFamily: normalizeTerminalFontFamily(value),
                    });
                  }}
                >
                  <AutocompleteInput
                    size="sm"
                    variant="soft"
                    showTrigger
                    showClear={settings.terminalFontFamily.length > 0}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={m.settings.appearance.terminalFont.placeholder}
                    className="w-full sm:w-56"
                    aria-label={m.settings.appearance.terminalFont.ariaLabel}
                  />
                  <AutocompletePopup className="w-56 min-w-56 font-system-ui">
                    <AutocompleteList>
                      {visibleTerminalFontFamilySuggestions.map((suggestion, index) => (
                        <AutocompleteItem
                          key={suggestion}
                          index={index}
                          value={suggestion}
                          className="font-normal text-[var(--color-text-foreground)]"
                          onClick={() => {
                            updateSettings({
                              terminalFontFamily: normalizeTerminalFontFamily(suggestion),
                            });
                          }}
                        >
                          {suggestion}
                        </AutocompleteItem>
                      ))}
                      <AutocompleteEmpty>
                        {m.settings.appearance.terminalFont.noSuggestions}
                      </AutocompleteEmpty>
                    </AutocompleteList>
                  </AutocompletePopup>
                </Autocomplete>
              </div>
            }
          />

          {shouldShowFontSmoothing
            ? renderBooleanSettingRow({
                settingKey: "enableNativeFontSmoothing",
                title: "Font smoothing",
                description: "Use macOS-style antialiasing for lighter, crisper text rendering.",
                resetLabel: "font smoothing",
                ariaLabel: "Enable font smoothing",
              })
            : null}
        </SettingsCard>
      </section>

      <SettingsSection title={m.settings.appearance.timeAndReading}>
        <SettingsRow
          anchorKey="appearance:time-format"
          title={m.settings.appearance.timeFormat.title}
          description={m.settings.appearance.timeFormat.description}
          resetAction={
            settings.timestampFormat !== defaults.timestampFormat ? (
              <SettingResetButton
                label={m.settings.appearance.timeFormat.resetLabel}
                onClick={() =>
                  updateSettings({
                    timestampFormat: defaults.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value !== "locale" && value !== "12-hour" && value !== "24-hour") {
                  return;
                }
                updateSettings({
                  timestampFormat: value,
                });
              }}
              ariaLabel="Timestamp format"
              triggerClassName="w-full sm:w-40"
              valueContent={m.settings.appearance.timeFormat.options[settings.timestampFormat]}
            >
              <SelectItem hideIndicator value="locale">
                {m.settings.appearance.timeFormat.options.locale}
              </SelectItem>
              <SelectItem hideIndicator value="12-hour">
                {m.settings.appearance.timeFormat.options["12-hour"]}
              </SelectItem>
              <SelectItem hideIndicator value="24-hour">
                {m.settings.appearance.timeFormat.options["24-hour"]}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>
    </div>
  );

  const renderBehaviorPanel = () => (
    <div className="space-y-6">
      <SettingsSection title={m.settings.behavior.runtimeBehavior}>
        {renderBooleanSettingRow({
          settingKey: "enableAssistantStreaming",
          anchorKey: "behavior:assistant-output",
          ...m.settings.behavior.assistantOutput,
        })}

        {renderBooleanSettingRow({
          settingKey: "diffWordWrap",
          anchorKey: "behavior:diff-line-wrapping",
          ...m.settings.behavior.diffLineWrapping,
        })}
      </SettingsSection>

      <SettingsSection title={m.settings.behavior.safetyConfirmations}>
        {renderBooleanSettingRow({
          settingKey: "confirmThreadDelete",
          anchorKey: "behavior:delete-confirmation",
          ...m.settings.behavior.deleteConfirmation,
        })}

        {renderBooleanSettingRow({
          settingKey: "confirmThreadArchive",
          anchorKey: "behavior:archive-confirmation",
          ...m.settings.behavior.archiveConfirmation,
        })}

        {renderBooleanSettingRow({
          settingKey: "confirmTerminalTabClose",
          anchorKey: "behavior:terminal-close-confirmation",
          ...m.settings.behavior.terminalCloseConfirmation,
        })}
      </SettingsSection>
    </div>
  );

  const renderRouteOwnedPanel = () => {
    switch (activeSection) {
      case "general":
        return renderGeneralPanel();
      case "appearance":
        return renderAppearancePanel();
      case "behavior":
        return renderBehaviorPanel();
      case "shortcuts":
        return <KeyboardShortcutsSettingsPanel />;
      case "profile":
        return <ProfileSettingsPanel />;
      case "skills":
        return <SkillsSettingsPanel />;
      case "usage":
        return <ProviderUsageSettingsPanel />;
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
        SETTINGS_PAGE_BACKGROUND_CLASS_NAME,
        CHAT_CONTENT_CARD_CLASS_NAME,
      )}
    >
      <RouteInsetSurface surfaceClassName={SETTINGS_PAGE_BACKGROUND_CLASS_NAME}>
        {/* Companion sidebar trigger so settings is reachable-and-exitable even when the
          sidebar is collapsed (web/mobile have no global Back arrow). Pinned to the
          card's top-left — at the same header height + traffic-light gutter as the
          chat and route headers — so the collapsed-state toggle sits by the traffic
          lights instead of floating in the centered settings body. It renders nothing
          while the sidebar is open (SidebarHeaderNavigationControls returns null), so it
          adds no navigation chrome in the common (open) state and never shifts the centered
          content (hence absolute, not a layout-occupying header row). The strip stays a
          drag-region so the Windows frameless window can be moved by its top edge; the
          caption buttons themselves are a separate fixed cluster (see root route). */}
        <div
          className={cn(
            "drag-region absolute inset-x-0 top-0 z-10 flex items-center",
            CHAT_SURFACE_HEADER_PADDING_X_CLASS,
            CHAT_SURFACE_HEADER_HEIGHT_CLASS,
            desktopTopBarTrafficLightGutterClassName,
          )}
        >
          <div className="pointer-events-auto">
            <SidebarHeaderNavigationControls />
          </div>
        </div>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div
              className={cn(
                "mx-auto w-full px-6 py-8",
                activeSection === "profile" ? "max-w-3xl" : "max-w-2xl",
              )}
            >
              {activeSection !== "profile" ? (
                <div className="mb-8 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="text-xl font-medium tracking-tight text-foreground">
                      {m.settingsNav.sections[activeSection].label}
                    </h1>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {m.settingsNav.sections[activeSection].description}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="shrink-0"
                    disabled={changedSettingLabels.length === 0}
                    onClick={() => void restoreDefaults()}
                  >
                    <RotateCcwIcon className="size-3.5" />
                    {m.settings.appearance.restoreDefaults}
                  </Button>
                </div>
              ) : null}

              {renderRouteOwnedPanel()}
              {/* These workflow owners stay mounted so drafts, request guards, and pending
                  mutations retain route lifetime while inactive panels render no DOM. */}
              <div className="contents">
                <NotificationsSettingsPanel
                  active={activeSection === "notifications"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                />
                <AppSnapSettingsPanel
                  active={activeSection === "appsnap"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                />
                <WorktreesSettingsPanel active={activeSection === "worktrees"} />
                <ArchivedSettingsPanel active={activeSection === "archived"} />
                <ModelsSettingsPanel
                  active={activeSection === "models"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                  resetEpoch={resetEpoch}
                />
                <ProvidersSettingsPanel
                  active={activeSection === "providers"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                  resetEpoch={resetEpoch}
                />
                <AgentMcpSettingsPanel active={activeSection === "mcpServers"} />
                <ExternalMcpSettingsPanel active={activeSection === "integrations"} />
                <AdvancedSettingsPanel
                  active={activeSection === "advanced"}
                  onOpenReleaseHistory={() => setReleaseHistoryOpen(true)}
                  resetEpoch={resetEpoch}
                />
              </div>
            </div>
          </div>
        </div>
        {/* Mounted at the route level (outside the scrollable panel) so the
          dialog portal can overlay the entire settings view without being
          clipped by the content wrapper's overflow. */}
        <ReleaseHistoryDialog
          open={releaseHistoryOpen}
          onOpenChange={setReleaseHistoryOpen}
          defaultExpandedVersion={APP_VERSION}
        />
      </RouteInsetSurface>
    </div>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});

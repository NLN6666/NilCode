// FILE: ProvidersSettingsPanel.tsx
// Purpose: Own provider picker, update, and CLI installation settings workflows.
// Layer: Settings panel

import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ServerProviderStatus,
  type ServerSettings,
} from "@synara/contracts";
import { PROVIDER_DESCRIPTORS } from "@synara/shared/providerMetadata";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type MouseEvent, type ReactNode, useCallback, useMemo, useState } from "react";

import type { AppSettings, AppSettingsBinding } from "~/appSettings";
import { useMessages } from "../../i18n/context";
import type { Messages } from "../../i18n/locales/en";
import { CentralIcon } from "~/lib/central-icons";
import { DownloadIcon, ExternalLinkIcon, Loader2Icon } from "~/lib/icons";
import {
  serverConfigQueryOptions,
  serverQueryKeys,
  serverSettingsQueryOptions,
} from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { sameProviderOrder } from "~/providerOrdering";
import {
  getVisibleProviderUpdateStatuses,
  isProviderUpdateActive,
  shouldOfferProviderUpdateAction,
  shouldShowProviderUpdateStatus,
  withProviderUpdateTimeout,
} from "~/providerUpdates";
import { SETTINGS_TARGETS } from "~/settingsNavigation";
import {
  SETTINGS_INSET_LIST_CLASS_NAME,
  SETTINGS_INSET_RADIUS_CLASS_NAME,
  SETTINGS_OUTLINED_SURFACE_CLASS_NAME,
  SETTINGS_STACKED_ROWS_DIVIDER_CLASS_NAME,
} from "~/settingsPanelStyles";
import { ELEVATED_HOVER_SURFACE_RAISED_TEXT_CLASS_NAME } from "~/surfaceStyles";

import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { DebouncedSettingTextInput } from "./DebouncedSettingTextInput";
import { SettingResetButton, useSettingsRestoreSignal } from "./SettingControls";
import { SettingsListRow, SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

type ProviderInstallTextKey =
  | "claudeBinaryPath"
  | "codexBinaryPath"
  | "codexHomePath"
  | "cursorBinaryPath"
  | "cursorApiEndpoint"
  | "antigravityBinaryPath"
  | "grokBinaryPath"
  | "droidBinaryPath"
  | "kiloBinaryPath"
  | "kiloServerUrl"
  | "openCodeBinaryPath"
  | "openCodeServerUrl"
  | "piBinaryPath"
  | "piAgentDir";
type ProviderInstallPasswordKey = "kiloServerPassword" | "openCodeServerPassword";
type ProviderInstallPasswordConfiguredKey =
  | "kiloServerPasswordConfigured"
  | "openCodeServerPasswordConfigured";
type ProviderInstallBooleanKey = "openCodeExperimentalWebSockets";

type ProvidersCopy = Messages["settings"]["providers"];

type ProviderInstallFieldCopy = {
  readonly label: string;
  readonly placeholder?: string;
  readonly description: ReactNode;
};

/**
 * Each field names its own catalog entry instead of carrying copy, so a locale that renames a
 * label cannot drift from the settings key it belongs to. Binary-path fields build their hint
 * from the shared sentence and mark the executable so it still renders as inline code.
 */
type ProviderInstallCopy = (copy: ProvidersCopy) => ProviderInstallFieldCopy;

/** Renders `binary` inside the sentence as <code>, wherever the translation places it. */
function withInlineCode(sentence: string, binary: string): ReactNode {
  const index = sentence.indexOf(binary);
  if (index < 0) return sentence;
  return (
    <>
      {sentence.slice(0, index)}
      <code>{binary}</code>
      {sentence.slice(index + binary.length)}
    </>
  );
}

function binaryHint(copy: ProvidersCopy, binary: string): ReactNode {
  return withInlineCode(copy.binaryHint(binary), binary);
}

type ProviderInstallTextField = {
  readonly kind: "text";
  readonly settingsKey: ProviderInstallTextKey;
  readonly copy: ProviderInstallCopy;
};
type ProviderInstallPasswordField = {
  readonly kind: "password";
  readonly settingsKey: ProviderInstallPasswordKey;
  readonly configuredKey: ProviderInstallPasswordConfiguredKey;
  readonly copy: ProviderInstallCopy;
};
type ProviderInstallBooleanField = {
  readonly kind: "boolean";
  readonly settingsKey: ProviderInstallBooleanKey;
  readonly copy: ProviderInstallCopy;
};
type ProviderInstallField =
  | ProviderInstallTextField
  | ProviderInstallPasswordField
  | ProviderInstallBooleanField;
type ProviderInstallSettings = {
  readonly provider: ProviderKind;
  readonly docs: ReadonlyArray<{
    readonly labelKey: keyof ProvidersCopy["docs"];
    readonly href: string;
  }>;
  readonly fields: readonly ProviderInstallField[];
};

const PROVIDER_VISIBILITY_OPTIONS: ReadonlyArray<{ provider: ProviderKind; title: string }> =
  PROVIDER_DESCRIPTORS.map((descriptor) => ({
    provider: descriptor.kind,
    title: descriptor.displayName,
  }));

const PROVIDER_INSTALL_SETTINGS: readonly ProviderInstallSettings[] = [
  {
    provider: "codex",
    docs: [
      { labelKey: "install", href: "https://help.openai.com/en/articles/11096431" },
      { labelKey: "update", href: "https://help.openai.com/en/articles/11096431" },
      { labelKey: "config", href: "https://github.com/openai/codex/blob/main/docs/config.md" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "codexBinaryPath",
        copy: (c) => ({ ...c.fields.codexBinaryPath, description: binaryHint(c, "codex") }),
      },
      {
        kind: "text",
        settingsKey: "codexHomePath",
        copy: (c) => c.fields.codexHomePath,
      },
    ],
  },
  {
    provider: "claudeAgent",
    docs: [
      { labelKey: "install", href: "https://code.claude.com/docs/en/installation" },
      {
        labelKey: "update",
        href: "https://code.claude.com/docs/en/installation#update-claude-code",
      },
      { labelKey: "config", href: "https://code.claude.com/docs/en/settings" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "claudeBinaryPath",
        copy: (c) => ({ ...c.fields.claudeBinaryPath, description: binaryHint(c, "claude") }),
      },
    ],
  },
  {
    provider: "cursor",
    docs: [
      { labelKey: "install", href: "https://docs.cursor.com/en/cli/installation" },
      { labelKey: "update", href: "https://docs.cursor.com/en/cli/installation#updates" },
      { labelKey: "config", href: "https://docs.cursor.com/en/cli/overview" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "cursorBinaryPath",
        copy: (c) => ({
          ...c.fields.cursorBinaryPath,
          description: withInlineCode(c.cursorBinaryHint("cursor-agent"), "cursor-agent"),
        }),
      },
      {
        kind: "text",
        settingsKey: "cursorApiEndpoint",
        copy: (c) => c.fields.cursorApiEndpoint,
      },
    ],
  },
  {
    provider: "antigravity",
    docs: [
      { labelKey: "install", href: "https://antigravity.google/docs/cli-using" },
      { labelKey: "reference", href: "https://antigravity.google/docs/cli-reference" },
      { labelKey: "hooks", href: "https://antigravity.google/docs/hooks" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "antigravityBinaryPath",
        copy: (c) => ({
          ...c.fields.antigravityBinaryPath,
          description: binaryHint(c, "agy"),
        }),
      },
    ],
  },
  {
    provider: "grok",
    docs: [
      { labelKey: "install", href: "https://docs.x.ai/build/overview" },
      { labelKey: "headless", href: "https://docs.x.ai/build/cli/headless-scripting" },
      { labelKey: "config", href: "https://docs.x.ai/build/overview" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "grokBinaryPath",
        copy: (c) => ({ ...c.fields.grokBinaryPath, description: binaryHint(c, "grok") }),
      },
    ],
  },
  {
    provider: "droid",
    docs: [
      {
        labelKey: "quickstart",
        href: "https://docs.factory.ai/cli/getting-started/quickstart.md",
      },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "droidBinaryPath",
        copy: (c) => ({ ...c.fields.droidBinaryPath, description: binaryHint(c, "droid") }),
      },
    ],
  },
  {
    provider: "kilo",
    docs: [
      { labelKey: "install", href: "https://kilo.ai/docs/cli" },
      { labelKey: "update", href: "https://kilo.ai/docs/cli" },
      { labelKey: "config", href: "https://kilo.ai/docs/cli#configuration" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "kiloBinaryPath",
        copy: (c) => ({ ...c.fields.kiloBinaryPath, description: binaryHint(c, "kilo") }),
      },
      {
        kind: "text",
        settingsKey: "kiloServerUrl",
        copy: (c) => c.fields.kiloServerUrl,
      },
      {
        kind: "password",
        settingsKey: "kiloServerPassword",
        configuredKey: "kiloServerPasswordConfigured",
        copy: (c) => c.fields.kiloServerPassword,
      },
    ],
  },
  {
    provider: "opencode",
    docs: [
      { labelKey: "install", href: "https://opencode.ai/docs/" },
      { labelKey: "update", href: "https://opencode.ai/docs/cli/" },
      { labelKey: "config", href: "https://opencode.ai/docs/config/" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "openCodeBinaryPath",
        copy: (c) => ({
          ...c.fields.openCodeBinaryPath,
          description: binaryHint(c, "opencode"),
        }),
      },
      {
        kind: "text",
        settingsKey: "openCodeServerUrl",
        copy: (c) => c.fields.openCodeServerUrl,
      },
      {
        kind: "password",
        settingsKey: "openCodeServerPassword",
        configuredKey: "openCodeServerPasswordConfigured",
        copy: (c) => c.fields.openCodeServerPassword,
      },
      {
        kind: "boolean",
        settingsKey: "openCodeExperimentalWebSockets",
        copy: (c) => c.fields.openCodeExperimentalWebSockets,
      },
    ],
  },
  {
    provider: "pi",
    docs: [
      { labelKey: "install", href: "https://pi.dev/docs/latest" },
      { labelKey: "update", href: "https://pi.dev/docs/latest/settings" },
      { labelKey: "config", href: "https://pi.dev/docs/latest/settings" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "piBinaryPath",
        copy: (c) => ({ ...c.fields.piBinaryPath, description: binaryHint(c, "pi") }),
      },
      {
        kind: "text",
        settingsKey: "piAgentDir",
        copy: (c) => c.fields.piAgentDir,
      },
    ],
  },
];

function isProviderInstallFieldDirty(
  field: ProviderInstallField,
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return field.kind === "password"
    ? settings[field.configuredKey] !== defaults[field.configuredKey]
    : settings[field.settingsKey] !== defaults[field.settingsKey];
}

function isProviderInstallConfigDirty(
  config: ProviderInstallSettings,
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return config.fields.some((field) => isProviderInstallFieldDirty(field, settings, defaults));
}

export function isProviderInstallSettingsDirty(
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return PROVIDER_INSTALL_SETTINGS.some((config) =>
    isProviderInstallConfigDirty(config, settings, defaults),
  );
}

function createProviderInstallDisclosureState(
  settings: AppSettings,
): Record<ProviderKind, boolean> {
  return Object.fromEntries(
    PROVIDER_INSTALL_SETTINGS.map((config) => [
      config.provider,
      config.fields.some((field) =>
        field.kind === "password"
          ? settings[field.configuredKey]
          : Boolean(settings[field.settingsKey]),
      ),
    ]),
  ) as Record<ProviderKind, boolean>;
}

function createClosedProviderInstallDisclosureState(): Record<ProviderKind, boolean> {
  return Object.fromEntries(
    PROVIDER_INSTALL_SETTINGS.map((config) => [config.provider, false]),
  ) as Record<ProviderKind, boolean>;
}

export function createProviderInstallResetPatch(defaults: AppSettings): Partial<AppSettings> {
  return Object.fromEntries(
    PROVIDER_INSTALL_SETTINGS.flatMap((config) =>
      config.fields.map((field) => [field.settingsKey, defaults[field.settingsKey]]),
    ),
  ) as Partial<AppSettings>;
}

function setProviderHidden(
  current: ReadonlyArray<ProviderKind>,
  provider: ProviderKind,
  hidden: boolean,
): ProviderKind[] {
  const withoutTarget = current.filter((entry) => entry !== provider);
  return hidden ? [...withoutTarget, provider] : withoutTarget;
}

function SortableProviderVisibilityRow(props: {
  option: { provider: ProviderKind; title: string };
  isHidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
}) {
  const m = useMessages();
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.option.provider });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        SETTINGS_OUTLINED_SURFACE_CLASS_NAME,
        "flex items-center justify-between gap-3 px-3 py-2.5",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={cn(
            "inline-flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing",
            ELEVATED_HOVER_SURFACE_RAISED_TEXT_CLASS_NAME,
            SETTINGS_INSET_RADIUS_CLASS_NAME,
          )}
          aria-label={m.settings.providers.picker.reorder(props.option.title)}
          {...attributes}
          {...listeners}
        >
          <CentralIcon name="dot-grid-2x3" className="size-4" />
        </button>
        <span className="min-w-0 text-sm text-foreground">{props.option.title}</span>
      </div>
      <Switch
        checked={!props.isHidden}
        onCheckedChange={(checked) => props.onHiddenChange(!Boolean(checked))}
        aria-label={m.settings.providers.picker.showInPicker(props.option.title)}
      />
    </div>
  );
}

function ProviderDocsLinks({ docs }: { docs: ProviderInstallSettings["docs"] }) {
  const m = useMessages();
  return (
    <div className={cn(SETTINGS_OUTLINED_SURFACE_CLASS_NAME, "px-3 py-2.5")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-medium text-foreground">
          {m.settings.providers.tools.cliDocs}
        </span>
        <div className="flex flex-wrap gap-2">
          {docs.map((doc) => (
            <Button
              key={`${doc.labelKey}:${doc.href}`}
              variant="outline"
              size="sm"
              render={<a href={doc.href} target="_blank" rel="noreferrer" />}
            >
              <span>{m.settings.providers.docs[doc.labelKey]}</span>
              <ExternalLinkIcon className="size-3" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatProviderVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function providerUpdateStatusLabel(
  provider: ServerProviderStatus,
  copy: ProvidersCopy,
): string | null {
  const state = provider.updateState?.status;
  if (state === "queued") return copy.update.queued;
  if (state === "running") return copy.update.running;
  if (state === "succeeded") return copy.update.succeeded;
  if (state === "failed") return copy.update.failed;
  if (state === "unchanged") return copy.update.unchanged;
  const advisory = provider.versionAdvisory;
  if (advisory?.status === "behind_latest" && advisory.latestVersion) {
    const currentVersion = formatProviderVersion(advisory.currentVersion);
    const latestVersion = formatProviderVersion(advisory.latestVersion);
    return currentVersion
      ? `${currentVersion} -> ${latestVersion}`
      : copy.update.latest(latestVersion ?? "");
  }
  const currentVersion = formatProviderVersion(provider.version);
  return currentVersion ? copy.update.current(currentVersion) : null;
}

function providerUpdateFailureMessage(
  provider: ServerProviderStatus | undefined,
  copy: ProvidersCopy,
): string | null {
  const state = provider?.updateState;
  if (!state || (state.status !== "failed" && state.status !== "unchanged")) return null;
  return state.output?.trim() || state.message || copy.update.didNotComplete;
}

/** Same "off / N available / none" line under both the updates and the installed-CLI rows. */
function providerCheckStatusLabel(
  copy: ProvidersCopy,
  checksEnabled: boolean,
  outdatedCount: number,
): string {
  if (!checksEnabled) return copy.checkStatus.off;
  return outdatedCount > 0 ? copy.checkStatus.available(outdatedCount) : copy.checkStatus.none;
}

function ProviderUpdateAction(props: {
  providerStatus: ServerProviderStatus;
  active: boolean;
  disabled: boolean;
  onUpdate: (provider: ProviderKind) => void;
}) {
  const m = useMessages();
  const advisory = props.providerStatus.versionAdvisory;
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={props.disabled}
      title={
        advisory?.updateCommand
          ? m.settings.providers.update.runCommand(advisory.updateCommand)
          : undefined
      }
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        props.onUpdate(props.providerStatus.provider);
      }}
    >
      {props.active ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <DownloadIcon className="size-3.5" />
      )}
      {props.active ? m.settings.providers.update.running : m.settings.providers.update.action}
    </Button>
  );
}

function ProviderInstallFieldControl(props: {
  field: ProviderInstallField;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
}) {
  const m = useMessages();
  const copy = props.field.copy(m.settings.providers);
  const id = `provider-install-${props.field.settingsKey}`;
  if (props.field.kind === "boolean") {
    return (
      <label
        htmlFor={id}
        className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-background/60 px-3 py-2"
      >
        <span className="min-w-0">
          <span className="block text-xs font-medium text-foreground">{copy.label}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{copy.description}</span>
        </span>
        <Switch
          id={id}
          checked={props.settings[props.field.settingsKey]}
          onCheckedChange={(checked) =>
            props.updateSettings({ [props.field.settingsKey]: Boolean(checked) })
          }
        />
      </label>
    );
  }

  const configured =
    props.field.kind === "password" ? props.settings[props.field.configuredKey] : false;
  const isPassword = props.field.kind === "password";
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs font-medium text-foreground">{copy.label}</span>
      <DebouncedSettingTextInput
        id={id}
        size="sm"
        variant="soft"
        className="mt-1"
        value={isPassword ? "" : props.settings[props.field.settingsKey]}
        onCommit={(nextValue) =>
          props.updateSettings({ [props.field.settingsKey]: nextValue } as Partial<AppSettings>)
        }
        placeholder={
          isPassword && configured
            ? m.settings.providers.tools.passwordConfigured
            : copy.placeholder
        }
        type={isPassword ? "password" : undefined}
        autoComplete={isPassword ? "new-password" : undefined}
        spellCheck={false}
      />
      <span className="mt-1 block text-xs text-muted-foreground">{copy.description}</span>
    </label>
  );
}

function ProviderToolRow(props: {
  config: ProviderInstallSettings;
  open: boolean;
  settings: AppSettings;
  defaults: AppSettings;
  hiddenProviderSet: ReadonlySet<ProviderKind>;
  serverSettings: Pick<ServerSettings, "providers" | "enableProviderUpdateChecks"> | null;
  providerStatus: ServerProviderStatus | undefined;
  updatingProviders: ReadonlySet<ProviderKind>;
  onOpenChange: (open: boolean) => void;
  onUpdate: (provider: ProviderKind) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
}) {
  const m = useMessages();
  const title = PROVIDER_DISPLAY_NAMES[props.config.provider];
  const isDirty = isProviderInstallConfigDirty(props.config, props.settings, props.defaults);
  const showProviderUpdateStatus = props.providerStatus
    ? shouldShowProviderUpdateStatus({
        provider: props.providerStatus,
        hiddenProviderSet: props.hiddenProviderSet,
        serverSettings: props.serverSettings,
      })
    : false;
  const updateAdvisory = props.providerStatus?.versionAdvisory;
  const providerUpdateSuppressed =
    updateAdvisory?.status === "behind_latest" && !showProviderUpdateStatus;
  const currentProviderVersion = formatProviderVersion(props.providerStatus?.version);
  const providerUpdateLabel = props.providerStatus
    ? !props.settings.enableProviderUpdateChecks
      ? currentProviderVersion
        ? m.settings.providers.update.current(currentProviderVersion)
        : null
      : providerUpdateSuppressed
        ? null
        : providerUpdateStatusLabel(props.providerStatus, m.settings.providers)
    : null;
  const updateActive = Boolean(
    (props.providerStatus && isProviderUpdateActive(props.providerStatus)) ||
    props.updatingProviders.has(props.config.provider),
  );
  const showUpdateButton = props.providerStatus
    ? shouldOfferProviderUpdateAction(props.providerStatus) &&
      (showProviderUpdateStatus || updateAdvisory?.status === "unknown")
    : false;

  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      <div className="border-t border-border/70 first:border-t-0">
        <div className="flex min-h-11 items-center gap-2 px-3 py-2">
          <CollapsibleTrigger
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{title}</span>
            {isDirty ? (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {m.settings.providers.tools.custom}
              </span>
            ) : null}
            {providerUpdateLabel ? (
              <span
                className={cn(
                  "shrink-0 text-[11px]",
                  updateAdvisory?.status === "behind_latest"
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {providerUpdateLabel}
              </span>
            ) : null}
            <DisclosureChevron
              open={props.open}
              className="size-4 shrink-0 text-muted-foreground"
            />
          </CollapsibleTrigger>
          {showUpdateButton && props.providerStatus ? (
            <ProviderUpdateAction
              providerStatus={props.providerStatus}
              active={updateActive}
              disabled={updateActive}
              onUpdate={props.onUpdate}
            />
          ) : null}
        </div>

        <CollapsiblePanel>
          <div className="border-t border-border/70 bg-muted/20 px-3 py-3">
            <div className="space-y-3">
              <ProviderDocsLinks docs={props.config.docs} />
              {showProviderUpdateStatus && updateAdvisory?.status === "behind_latest" ? (
                <div className="text-xs text-muted-foreground">
                  {updateAdvisory.canUpdate && updateAdvisory.updateCommand ? (
                    <>
                      <span>{m.settings.providers.tools.command}</span>
                      <code className="font-mono">{updateAdvisory.updateCommand}</code>
                    </>
                  ) : (
                    m.settings.providers.tools.noSafeCommand
                  )}
                </div>
              ) : null}
              {props.config.fields.map((field) => (
                <ProviderInstallFieldControl
                  key={field.settingsKey}
                  field={field}
                  settings={props.settings}
                  updateSettings={props.updateSettings}
                />
              ))}
            </div>
          </div>
        </CollapsiblePanel>
      </div>
    </Collapsible>
  );
}

export type ProvidersSettingsPanelProps = AppSettingsBinding & {
  readonly active: boolean;
  readonly resetEpoch: number;
};

export function ProvidersSettingsPanel({
  settings,
  defaults,
  updateSettings,
  active,
  resetEpoch,
}: ProvidersSettingsPanelProps) {
  const m = useMessages();
  const queryClient = useQueryClient();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const [openInstallProviders, setOpenInstallProviders] = useState<Record<ProviderKind, boolean>>(
    () => createProviderInstallDisclosureState(settings),
  );
  const [updatingProviders, setUpdatingProviders] = useState<ReadonlySet<ProviderKind>>(
    () => new Set(),
  );
  const hiddenProviderSet = useMemo(
    () => new Set<ProviderKind>(settings.hiddenProviders),
    [settings.hiddenProviders],
  );
  const hiddenProviderCount = hiddenProviderSet.size;
  const providerVisibilityOptionsByProvider = useMemo(
    () => new Map(PROVIDER_VISIBILITY_OPTIONS.map((option) => [option.provider, option])),
    [],
  );
  const orderedProviderVisibilityOptions = useMemo(
    () =>
      settings.providerOrder.flatMap((provider) => {
        const option = providerVisibilityOptionsByProvider.get(provider);
        return option ? [option] : [];
      }),
    [providerVisibilityOptionsByProvider, settings.providerOrder],
  );
  const providerVisibilitySensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const isProviderOrderDirty = !sameProviderOrder(settings.providerOrder, defaults.providerOrder);
  const providerStatusByProvider = useMemo(
    () =>
      new Map((serverConfigQuery.data?.providers ?? []).map((status) => [status.provider, status])),
    [serverConfigQuery.data?.providers],
  );
  const providerUpdateServerSettings = useMemo(
    () =>
      serverSettingsQuery.data
        ? {
            ...serverSettingsQuery.data,
            enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
          }
        : null,
    [serverSettingsQuery.data, settings.enableProviderUpdateChecks],
  );
  const outdatedProviderStatuses = useMemo(
    () =>
      getVisibleProviderUpdateStatuses({
        providers: serverConfigQuery.data?.providers ?? [],
        hiddenProviders: settings.hiddenProviders,
        serverSettings: providerUpdateServerSettings,
      }),
    [providerUpdateServerSettings, serverConfigQuery.data?.providers, settings.hiddenProviders],
  );
  const outdatedProviderCount = outdatedProviderStatuses.length;
  const installSettingsDirty = isProviderInstallSettingsDirty(settings, defaults);

  useSettingsRestoreSignal(resetEpoch, () => {
    setOpenInstallProviders(createClosedProviderInstallDisclosureState());
  });

  const handleProviderOrderDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const fromIndex = settings.providerOrder.indexOf(active.id as ProviderKind);
      const toIndex = settings.providerOrder.indexOf(over.id as ProviderKind);
      if (fromIndex < 0 || toIndex < 0) return;
      updateSettings({ providerOrder: arrayMove([...settings.providerOrder], fromIndex, toIndex) });
    },
    [settings.providerOrder, updateSettings],
  );

  const runProviderUpdate = useCallback(
    async (provider: ProviderKind) => {
      if (updatingProviders.has(provider)) return;
      setUpdatingProviders((current) => new Set(current).add(provider));
      await withProviderUpdateTimeout({
        provider,
        request: ensureNativeApi().server.updateProvider({ provider }),
      })
        .then((result) => {
          const refreshedProvider = result.providers.find((status) => status.provider === provider);
          const failureMessage = providerUpdateFailureMessage(
            refreshedProvider,
            m.settings.providers,
          );
          if (failureMessage) {
            const manualCommand = refreshedProvider?.versionAdvisory?.updateCommand?.trim();
            toastManager.add({
              type: "error",
              title: m.settings.providers.update.failedTitle(PROVIDER_DISPLAY_NAMES[provider]),
              description: manualCommand
                ? m.settings.providers.update.manualHint(failureMessage)
                : failureMessage,
              ...(manualCommand ? { data: { copyText: manualCommand } } : {}),
            });
            return;
          }
          toastManager.add({
            type: "success",
            title: m.settings.providers.update.finishedTitle(PROVIDER_DISPLAY_NAMES[provider]),
            description: m.settings.providers.update.finishedDescription,
          });
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: m.settings.providers.update.failedTitle(PROVIDER_DISPLAY_NAMES[provider]),
            description:
              error instanceof Error ? error.message : m.settings.providers.update.requestFailed,
          });
        })
        .finally(async () => {
          await queryClient
            .invalidateQueries({ queryKey: serverQueryKeys.config() })
            .catch(() => undefined);
          setUpdatingProviders((current) => {
            const next = new Set(current);
            next.delete(provider);
            return next;
          });
        });
    },
    [m, queryClient, updatingProviders],
  );

  if (!active) return null;

  return (
    <div className="space-y-6">
      <div id={SETTINGS_TARGETS.providerUpdates}>
        <SettingsSection title={m.settings.providers.updates.title}>
          <SettingsRow
            title={m.settings.providers.updates.autoChecks.title}
            anchorKey="providers:automatic-cli-update-checks"
            description={m.settings.providers.updates.autoChecks.description}
            resetAction={
              settings.enableProviderUpdateChecks !== defaults.enableProviderUpdateChecks ? (
                <SettingResetButton
                  label={m.settings.providers.updates.autoChecks.resetLabel}
                  onClick={() =>
                    updateSettings({
                      enableProviderUpdateChecks: defaults.enableProviderUpdateChecks,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.enableProviderUpdateChecks}
                onCheckedChange={(checked) =>
                  updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
                }
                aria-label={m.settings.providers.updates.autoChecks.ariaLabel}
              />
            }
          />

          <SettingsRow
            title={m.settings.providers.updates.providerUpdates.title}
            anchorKey="providers:provider-updates"
            description={m.settings.providers.updates.providerUpdates.description}
            status={providerCheckStatusLabel(
              m.settings.providers,
              settings.enableProviderUpdateChecks,
              outdatedProviderCount,
            )}
          >
            {settings.enableProviderUpdateChecks && outdatedProviderStatuses.length > 0 ? (
              <div
                className={cn(
                  "mt-4",
                  SETTINGS_INSET_LIST_CLASS_NAME,
                  SETTINGS_STACKED_ROWS_DIVIDER_CLASS_NAME,
                )}
              >
                {outdatedProviderStatuses.map((providerStatus) => {
                  const updateActive =
                    isProviderUpdateActive(providerStatus) ||
                    updatingProviders.has(providerStatus.provider);
                  const updateLabel = providerUpdateStatusLabel(
                    providerStatus,
                    m.settings.providers,
                  );
                  return (
                    <SettingsListRow
                      key={providerStatus.provider}
                      title={PROVIDER_DISPLAY_NAMES[providerStatus.provider]}
                      description={updateLabel || undefined}
                      actions={
                        providerStatus.versionAdvisory?.canUpdate ? (
                          <ProviderUpdateAction
                            providerStatus={providerStatus}
                            active={updateActive}
                            disabled={updateActive}
                            onUpdate={(provider) => void runProviderUpdate(provider)}
                          />
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {m.settings.providers.updates.manualUpdate}
                          </span>
                        )
                      }
                    />
                  );
                })}
              </div>
            ) : null}
          </SettingsRow>
        </SettingsSection>
      </div>

      <SettingsSection title={m.settings.providers.picker.title}>
        <SettingsRow
          title={m.settings.providers.picker.visible.title}
          anchorKey="providers:visible-providers"
          description={m.settings.providers.picker.visible.description}
          status={
            hiddenProviderCount > 0
              ? m.settings.providers.picker.hiddenCount(hiddenProviderCount)
              : isProviderOrderDirty
                ? m.settings.providers.picker.customOrder
                : m.settings.providers.picker.allVisible
          }
          resetAction={
            hiddenProviderCount > 0 || isProviderOrderDirty ? (
              <SettingResetButton
                label={m.settings.providers.picker.visible.resetLabel}
                onClick={() =>
                  updateSettings({
                    hiddenProviders: defaults.hiddenProviders,
                    providerOrder: defaults.providerOrder,
                  })
                }
              />
            ) : null
          }
        >
          <DndContext
            sensors={providerVisibilitySensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleProviderOrderDragEnd}
          >
            <SortableContext
              items={orderedProviderVisibilityOptions.map((option) => option.provider)}
              strategy={verticalListSortingStrategy}
            >
              <div className="mt-4 space-y-2">
                {orderedProviderVisibilityOptions.map((option) => (
                  <SortableProviderVisibilityRow
                    key={option.provider}
                    option={option}
                    isHidden={hiddenProviderSet.has(option.provider)}
                    onHiddenChange={(hidden) =>
                      updateSettings({
                        hiddenProviders: setProviderHidden(
                          settings.hiddenProviders,
                          option.provider,
                          hidden,
                        ),
                      })
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </SettingsRow>
      </SettingsSection>

      <div>
        <SettingsSection title={m.settings.providers.tools.title}>
          <SettingsRow
            title={m.settings.providers.tools.installed.title}
            anchorKey="providers:installed-clis"
            description={m.settings.providers.tools.installed.description}
            status={providerCheckStatusLabel(
              m.settings.providers,
              settings.enableProviderUpdateChecks,
              outdatedProviderCount,
            )}
            resetAction={
              installSettingsDirty ? (
                <SettingResetButton
                  label={m.settings.providers.tools.installed.resetLabel}
                  onClick={() => {
                    updateSettings(createProviderInstallResetPatch(defaults));
                    setOpenInstallProviders(createClosedProviderInstallDisclosureState());
                  }}
                />
              ) : null
            }
          >
            <div className="mt-4">
              <div className={SETTINGS_INSET_LIST_CLASS_NAME}>
                {PROVIDER_INSTALL_SETTINGS.map((config) => (
                  <ProviderToolRow
                    key={config.provider}
                    config={config}
                    open={openInstallProviders[config.provider]}
                    settings={settings}
                    defaults={defaults}
                    hiddenProviderSet={hiddenProviderSet}
                    serverSettings={providerUpdateServerSettings}
                    providerStatus={providerStatusByProvider.get(config.provider)}
                    updatingProviders={updatingProviders}
                    onOpenChange={(open) =>
                      setOpenInstallProviders((existing) => ({
                        ...existing,
                        [config.provider]: open,
                      }))
                    }
                    onUpdate={(provider) => void runProviderUpdate(provider)}
                    updateSettings={updateSettings}
                  />
                ))}
              </div>
            </div>
          </SettingsRow>
        </SettingsSection>
      </div>
    </div>
  );
}

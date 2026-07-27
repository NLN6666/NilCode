// FILE: DesktopSettingsPanels.tsx
// Purpose: Own settings panels whose behavior depends on browser or desktop-native lifecycles.
// Layer: Settings UI components
// Exports: NotificationsSettingsPanel, AppSnapSettingsPanel

import {
  type DesktopAppSnapPermission,
  type DesktopAppSnapState,
  type ResolvedKeybindingsConfig,
} from "@synara/contracts";
import { appSnapShortcutLabels } from "@synara/shared/appSnapShortcut";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { AppSettingsBinding } from "~/appSettings";
import { createLatestAppSnapRequestGuard } from "~/appSnap.logic";
import { playAppSnapCaptureSound } from "~/lib/appSnapSound";
import { useMessages } from "../../i18n/context";
import type { Messages } from "../../i18n/locales/en";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import { isElectron } from "~/env";
import {
  buildNotificationSettingsSupportText,
  readBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
} from "~/notifications/taskCompletion";
import {
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
} from "~/settingsPanelStyles";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { AppSnapShortcutControl } from "./AppSnapShortcutControl";
import { SettingResetButton } from "./SettingControls";
import { SettingsCard, SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

function appSnapStatusText(state: DesktopAppSnapState | null, m: Messages): string {
  const status = m.settings.appSnap.status;
  if (!state) return status.desktopOnly;
  if (!state.supported) return state.message ?? status.macOnly;
  if (state.status === "ready") {
    const shortcut = state.shortcut;
    const label = shortcut ? appSnapShortcutLabels(shortcut).join(" + ") : status.theShortcut;
    return status.listening(label);
  }
  if (state.status === "disabled") return status.off;
  if (state.status === "starting") return status.starting;
  return state.message ?? status.permissionRequired;
}

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

function AppSnapPermissionBadge({ permission }: { permission: DesktopAppSnapPermission }) {
  const m = useMessages();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          permission === "granted"
            ? "bg-emerald-500"
            : permission === "denied" || permission === "restricted"
              ? "bg-red-500"
              : "bg-[color:var(--color-border)]",
        )}
      />
      {m.settings.appSnap.permissions.labels[permission]}
    </span>
  );
}

export function NotificationsSettingsPanel({
  settings,
  defaults,
  updateSettings,
  active,
}: AppSettingsBinding & { readonly active: boolean }) {
  const m = useMessages();
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(
    readBrowserNotificationPermissionState(),
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setBrowserNotificationPermission(readBrowserNotificationPermissionState());
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  async function setSystemNotificationsEnabled(nextEnabled: boolean) {
    if (!nextEnabled) {
      updateSettings({ enableSystemTaskCompletionNotifications: false });
      return;
    }

    if (isElectron) {
      updateSettings({ enableSystemTaskCompletionNotifications: true });
      return;
    }

    const permission = await requestBrowserNotificationPermission();
    setBrowserNotificationPermission(permission);

    if (permission === "granted") {
      updateSettings({ enableSystemTaskCompletionNotifications: true });
      return;
    }

    updateSettings({ enableSystemTaskCompletionNotifications: false });
    toastManager.add({
      type: permission === "denied" ? "warning" : "error",
      title: m.settings.notifications.unavailableTitle,
      description: buildNotificationSettingsSupportText(
        permission,
        m.settings.notifications.support,
      ),
    });
  }

  async function sendTestNotification() {
    const title = m.settings.notifications.testTitle;
    const body = m.settings.notifications.testBody;

    if (window.desktopBridge) {
      const shown = await window.desktopBridge.notifications.show({ title, body, silent: false });
      toastManager.add({
        type: shown ? "success" : "warning",
        title: shown
          ? m.settings.notifications.testSentTitle
          : m.settings.notifications.testUnavailableTitle,
        description: shown
          ? m.settings.notifications.testShownOs
          : m.settings.notifications.testUnsupported,
      });
      return;
    }

    const permission = await requestBrowserNotificationPermission();
    setBrowserNotificationPermission(permission);
    if (permission !== "granted") {
      toastManager.add({
        type: permission === "denied" ? "warning" : "error",
        title: m.settings.notifications.unavailableTitle,
        description: buildNotificationSettingsSupportText(
          permission,
          m.settings.notifications.support,
        ),
      });
      return;
    }

    const notification = new Notification(title, { body, tag: "synara:test-notification" });
    notification.addEventListener("click", () => {
      window.focus();
    });
    toastManager.add({
      type: "success",
      title: m.settings.notifications.testSentTitle,
      description: m.settings.notifications.testShownBrowser,
    });
  }

  if (!active) return null;

  return (
    <div className="space-y-6">
      <SettingsSection title={m.settings.notifications.activityAlerts}>
        <SettingsRow
          title={m.settings.notifications.toasts.title}
          anchorKey="notifications:activity-toasts"
          description={m.settings.notifications.toasts.description}
          resetAction={
            settings.enableTaskCompletionToasts !== defaults.enableTaskCompletionToasts ? (
              <SettingResetButton
                label={m.settings.notifications.toasts.resetLabel}
                onClick={() =>
                  updateSettings({
                    enableTaskCompletionToasts: defaults.enableTaskCompletionToasts,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableTaskCompletionToasts}
              onCheckedChange={(checked) =>
                updateSettings({ enableTaskCompletionToasts: Boolean(checked) })
              }
              aria-label={m.settings.notifications.toasts.ariaLabel}
            />
          }
        />

        <SettingsRow
          title={m.settings.notifications.desktop.title}
          anchorKey="notifications:desktop-notifications"
          description={m.settings.notifications.desktop.description}
          status={buildNotificationSettingsSupportText(
            browserNotificationPermission,
            m.settings.notifications.support,
          )}
          resetAction={
            settings.enableSystemTaskCompletionNotifications !==
            defaults.enableSystemTaskCompletionNotifications ? (
              <SettingResetButton
                label={m.settings.notifications.desktop.resetLabel}
                onClick={() =>
                  updateSettings({
                    enableSystemTaskCompletionNotifications:
                      defaults.enableSystemTaskCompletionNotifications,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
              <Button size="xs" variant="outline" onClick={() => void sendTestNotification()}>
                {m.settings.notifications.test}
              </Button>
              <Switch
                checked={settings.enableSystemTaskCompletionNotifications}
                onCheckedChange={(checked) => {
                  void setSystemNotificationsEnabled(Boolean(checked));
                }}
                aria-label={m.settings.notifications.desktop.ariaLabel}
              />
            </div>
          }
        />
      </SettingsSection>
    </div>
  );
}

export function AppSnapSettingsPanel({
  settings,
  defaults,
  updateSettings,
  active,
}: AppSettingsBinding & { readonly active: boolean }) {
  const m = useMessages();
  const [appSnapState, setAppSnapState] = useState<DesktopAppSnapState | null>(null);
  const appSnapRequestGuardRef = useRef(createLatestAppSnapRequestGuard());
  const serverConfigQuery = useQuery({ ...serverConfigQueryOptions(), enabled: active });
  const keybindings = serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;

  useEffect(() => {
    const bridge = window.desktopBridge?.appSnap;
    if (!bridge) return;
    let disposed = false;
    const unsubscribe = bridge.onState((state) => {
      if (!disposed) setAppSnapState(state);
    });
    void bridge
      .getState()
      .then((state) => {
        if (!disposed) setAppSnapState(state);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  async function setAppSnapEnabled(nextEnabled: boolean) {
    const requestGuard = appSnapRequestGuardRef.current;
    const requestId = requestGuard.begin();
    const bridge = window.desktopBridge?.appSnap;
    if (!bridge) {
      toastManager.add({
        type: "warning",
        title: m.settings.appSnap.unavailableTitle,
        description: m.settings.appSnap.requiresDesktop,
      });
      return;
    }

    try {
      if (nextEnabled) {
        const permissionState = await bridge.requestPermissions();
        if (!requestGuard.isCurrent(requestId)) return;
        setAppSnapState(permissionState);
      }
      if (!requestGuard.isCurrent(requestId)) return;
      updateSettings({ enableAppSnap: nextEnabled });
      const state = await bridge.setEnabled(nextEnabled);
      if (!requestGuard.isCurrent(requestId)) return;
      setAppSnapState(state);
      if (nextEnabled && (state.status === "permission-required" || state.status === "error")) {
        toastManager.add({
          type: "warning",
          title: m.settings.appSnap.finishSetupTitle,
          description: state.message ?? m.settings.appSnap.finishSetupDescription,
        });
      }
    } catch (error) {
      if (!requestGuard.isCurrent(requestId)) return;
      updateSettings({ enableAppSnap: false });
      toastManager.add({
        type: "error",
        title: m.settings.appSnap.setupFailedTitle,
        description:
          error instanceof Error ? error.message : m.settings.appSnap.setupFailedDescription,
      });
    }
  }

  async function recheckAppSnapPermissions() {
    const bridge = window.desktopBridge?.appSnap;
    if (!bridge) return;
    const requestGuard = appSnapRequestGuardRef.current;
    const requestId = requestGuard.begin();
    try {
      await bridge.requestPermissions();
      const state = await bridge.setEnabled(settings.enableAppSnap);
      if (!requestGuard.isCurrent(requestId)) return;
      setAppSnapState(state);
    } catch (error) {
      if (!requestGuard.isCurrent(requestId)) return;
      toastManager.add({
        type: "error",
        title: m.settings.appSnap.permissionCheckFailedTitle,
        description:
          error instanceof Error
            ? error.message
            : m.settings.appSnap.permissionCheckFailedDescription,
      });
    }
  }

  const supported = appSnapState?.supported === true;
  const enabled = supported && settings.enableAppSnap;

  if (!active) return null;

  return (
    <div className="space-y-6">
      <SettingsCard divided={false} className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-border)] text-muted-foreground">
          <CentralIcon name="screen-capture" className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>{m.settings.appSnap.intro.title}</p>
          <p className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
            {m.settings.appSnap.intro.description}
          </p>
          {!supported ? (
            <p className={cn(SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME, "pt-0.5")}>
              {appSnapState
                ? (appSnapState.message ?? m.settings.appSnap.unsupportedFallback)
                : m.settings.appSnap.requiresDesktop}
            </p>
          ) : null}
        </div>
      </SettingsCard>

      <SettingsSection title={m.settings.appSnap.capture.title}>
        <SettingsRow
          title={m.settings.appSnap.capture.enable.title}
          anchorKey="appsnap:enable"
          description={m.settings.appSnap.capture.enable.description}
          status={appSnapStatusText(appSnapState, m)}
          resetAction={
            settings.enableAppSnap !== defaults.enableAppSnap ? (
              <SettingResetButton
                label={m.settings.appSnap.capture.enable.resetLabel}
                onClick={() => void setAppSnapEnabled(defaults.enableAppSnap)}
              />
            ) : null
          }
          control={
            <Switch
              checked={enabled}
              disabled={!supported}
              onCheckedChange={(checked) => void setAppSnapEnabled(Boolean(checked))}
              aria-label={m.settings.appSnap.capture.enable.ariaLabel}
            />
          }
        />

        <SettingsRow
          title={m.settings.appSnap.capture.shortcut.title}
          anchorKey="appsnap:shortcut"
          description={m.settings.appSnap.capture.shortcut.description}
          control={
            <AppSnapShortcutControl
              key={
                settings.appSnapShortcut.kind === "both-option-keys"
                  ? settings.appSnapShortcut.kind
                  : `${settings.appSnapShortcut.modifier}:${settings.appSnapShortcut.key}`
              }
              shortcut={settings.appSnapShortcut}
              enabled={enabled}
              reserved={enabled && appSnapState?.status === "ready"}
              keybindings={keybindings}
              onSaved={(shortcut, state) => {
                updateSettings({ appSnapShortcut: shortcut });
                setAppSnapState(state);
              }}
            />
          }
        />

        <SettingsRow
          title={m.settings.appSnap.capture.destination.title}
          anchorKey="appsnap:destination"
          description={m.settings.appSnap.capture.destination.description}
          control={
            <span className="text-xs font-medium text-muted-foreground">
              {m.settings.appSnap.capture.destination.automatic}
            </span>
          }
        />

        <SettingsRow
          title={m.settings.appSnap.capture.sound.title}
          anchorKey="appsnap:capture-sound"
          description={m.settings.appSnap.capture.sound.description}
          resetAction={
            settings.appSnapPlaySound !== defaults.appSnapPlaySound ? (
              <SettingResetButton
                label={m.settings.appSnap.capture.sound.resetLabel}
                onClick={() => updateSettings({ appSnapPlaySound: defaults.appSnapPlaySound })}
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
              <Button size="xs" variant="outline" onClick={() => void playAppSnapCaptureSound()}>
                {m.settings.appSnap.capture.sound.preview}
              </Button>
              <Switch
                checked={settings.appSnapPlaySound}
                onCheckedChange={(checked) =>
                  updateSettings({ appSnapPlaySound: Boolean(checked) })
                }
                aria-label={m.settings.appSnap.capture.sound.ariaLabel}
              />
            </div>
          }
        />
      </SettingsSection>

      {supported ? (
        <SettingsSection title={m.settings.appSnap.permissions.title}>
          <SettingsRow
            title={m.settings.appSnap.permissions.inputMonitoring.title}
            anchorKey="appsnap:input-monitoring"
            description={m.settings.appSnap.permissions.inputMonitoring.description}
            control={<AppSnapPermissionBadge permission={appSnapState.inputMonitoringPermission} />}
          />
          <SettingsRow
            title={m.settings.appSnap.permissions.screenRecording.title}
            anchorKey="appsnap:screen-recording"
            description={m.settings.appSnap.permissions.screenRecording.description}
            control={<AppSnapPermissionBadge permission={appSnapState.screenRecordingPermission} />}
          />
          <SettingsRow
            title={m.settings.appSnap.permissions.status.title}
            anchorKey="appsnap:permission-status"
            description={m.settings.appSnap.permissions.status.description}
            control={
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void recheckAppSnapPermissions()}
              >
                {m.settings.appSnap.permissions.recheck}
              </Button>
            }
          />
        </SettingsSection>
      ) : null}
    </div>
  );
}

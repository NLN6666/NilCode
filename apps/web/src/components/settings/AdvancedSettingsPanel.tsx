// FILE: AdvancedSettingsPanel.tsx
// Purpose: Own advanced settings state and workflows for auth, keybindings, and recovery.
// Layer: Settings UI components
// Exports: AdvancedSettingsPanel

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { logoutCurrentBrowserSession } from "~/authLogout";
import { APP_VERSION } from "~/branding";
import { resolveAndPersistPreferredEditor } from "~/editorPreferences";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useMessages } from "../../i18n/context";
import { ensureNativeApi, readNativeApi } from "~/nativeApi";
import { serverAuthSessionQueryOptions, serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { SETTINGS_INSET_LIST_CLASS_NAME } from "~/settingsPanelStyles";
import { useStore } from "~/store";
import { createAllThreadsMessagelessSelector, createThreadShellsSelector } from "~/storeSelectors";
import { useSettingsRestoreSignal } from "./SettingControls";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

export function AdvancedSettingsPanel(props: {
  active: boolean;
  onOpenReleaseHistory: () => void;
  resetEpoch: number;
}) {
  const m = useMessages();
  const configQuery = useQuery(serverConfigQueryOptions());
  const authSessionQuery = useQuery(serverAuthSessionQueryOptions());
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  // Keep these subscriptions inside the only panel that uses recovery eligibility.
  const threadShells = useStore(useMemo(() => createThreadShellsSelector(), []));
  const allThreadsMessageless = useStore(useMemo(() => createAllThreadsMessagelessSelector(), []));
  const projectCount = useStore((store) => store.projects.length);
  const threadsHydrated = useStore((store) => store.threadsHydrated);

  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [isRepairingLocalState, setIsRepairingLocalState] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showRecoveryTools, setShowRecoveryTools] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);

  useSettingsRestoreSignal(props.resetEpoch, () => {
    setShowRecoveryTools(false);
    setOpenKeybindingsError(null);
  });

  const keybindingsConfigPath = configQuery.data?.keybindingsConfigPath ?? null;
  const availableEditors = configQuery.data?.availableEditors;
  const shouldOfferRecoveryTools = useMemo(() => {
    if (!threadsHydrated || projectCount === 0) return false;
    return threadShells.length === 0 || allThreadsMessageless;
  }, [allThreadsMessageless, projectCount, threadShells.length, threadsHydrated]);

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      setOpenKeybindingsError(m.settings.advanced.developerTools.noEditors);
      setIsOpeningKeybindings(false);
      return;
    }
    void ensureNativeApi()
      .shell.openInEditor(keybindingsConfigPath, editor)
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : m.settings.advanced.developerTools.openFailed,
        );
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [availableEditors, keybindingsConfigPath, m]);

  const repairLocalState = useCallback(async () => {
    if (isRepairingLocalState) return;
    const api = readNativeApi() ?? ensureNativeApi();
    const confirmed = await api.dialogs.confirm(m.settings.advanced.developerTools.repairConfirm);
    if (!confirmed) return;

    setIsRepairingLocalState(true);
    await api.orchestration
      .repairState()
      .then((snapshot) => {
        syncServerReadModel(snapshot);
        toastManager.add({
          type: "success",
          title: m.settings.advanced.developerTools.repairedTitle,
          description: m.settings.advanced.developerTools.repairedDescription,
        });
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: m.settings.advanced.developerTools.repairFailedTitle,
          description:
            error instanceof Error
              ? error.message
              : m.settings.advanced.developerTools.repairFailedDescription,
        });
      })
      .finally(() => {
        setIsRepairingLocalState(false);
      });
  }, [isRepairingLocalState, m, syncServerReadModel]);

  const logoutCurrentSession = useCallback(async () => {
    if (isLoggingOut) return;
    const api = readNativeApi() ?? ensureNativeApi();
    setIsLoggingOut(true);
    const result = await logoutCurrentBrowserSession({
      confirm: () => api.dialogs.confirm(m.settings.advanced.session.signOutConfirm),
      logout: () => api.server.logoutAuthSession(),
      navigate: (path) => window.location.assign(path),
      onError: (error) =>
        toastManager.add({
          type: "error",
          title: m.settings.advanced.session.signOutFailedTitle,
          description:
            error instanceof Error
              ? error.message
              : m.settings.advanced.session.signOutFailedDescription,
        }),
    });
    if (result !== "redirecting") setIsLoggingOut(false);
  }, [isLoggingOut, m]);

  if (!props.active) return null;

  return (
    <div className="space-y-6">
      {authSessionQuery.data?.authenticated ? (
        <SettingsSection title={m.settings.advanced.session.title}>
          <SettingsRow
            title={m.settings.advanced.session.thisBrowser.title}
            anchorKey="advanced:this-browser"
            description={m.settings.advanced.session.thisBrowser.description}
            status={m.settings.advanced.session.authenticatedAs(
              authSessionQuery.data.role ?? "client",
            )}
            control={
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={isLoggingOut}
                onClick={() => void logoutCurrentSession()}
              >
                {isLoggingOut
                  ? m.settings.advanced.session.signingOut
                  : m.settings.advanced.session.signOut}
              </Button>
            }
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title={m.settings.advanced.developerTools.title}>
        <SettingsRow
          title={m.settings.advanced.developerTools.keybindings.title}
          anchorKey="advanced:keybindings"
          description={m.settings.advanced.developerTools.keybindings.description}
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
                {keybindingsConfigPath ?? m.settings.advanced.developerTools.resolvingPath}
              </span>
              {openKeybindingsError ? (
                <span className="mt-1 block text-destructive">{openKeybindingsError}</span>
              ) : (
                <span className="mt-1 block">
                  {m.settings.advanced.developerTools.opensInEditor}
                </span>
              )}
            </>
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!keybindingsConfigPath || isOpeningKeybindings}
              onClick={openKeybindingsFile}
            >
              {isOpeningKeybindings
                ? m.settings.advanced.developerTools.opening
                : m.settings.advanced.developerTools.openFile}
            </Button>
          }
        />

        <SettingsRow
          title={m.settings.advanced.developerTools.recovery.title}
          anchorKey="advanced:recovery-tools"
          description={m.settings.advanced.developerTools.recovery.description}
          status={
            shouldOfferRecoveryTools
              ? m.settings.advanced.developerTools.recoveryVisible
              : m.settings.advanced.developerTools.recoveryHidden
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!shouldOfferRecoveryTools || isRepairingLocalState}
              onClick={() => void repairLocalState()}
            >
              {isRepairingLocalState
                ? m.settings.advanced.developerTools.repairing
                : m.settings.advanced.developerTools.repairState}
            </Button>
          }
        >
          {shouldOfferRecoveryTools ? (
            <div className="mt-3 border-t border-border/70 pt-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                aria-expanded={showRecoveryTools}
                onClick={() => setShowRecoveryTools((current) => !current)}
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {m.settings.advanced.developerTools.whatThisDoes}
                </span>
                <DisclosureChevron
                  open={showRecoveryTools}
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </button>
              <DisclosureRegion
                open={showRecoveryTools}
                contentClassName={cn(
                  "mt-3 px-3 py-3 text-xs text-muted-foreground",
                  SETTINGS_INSET_LIST_CLASS_NAME,
                )}
              >
                <div>{m.settings.advanced.developerTools.whatThisDoesBody}</div>
              </DisclosureRegion>
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={m.settings.advanced.about.title}>
        <SettingsRow
          title={m.settings.advanced.about.version.title}
          anchorKey="advanced:version"
          description={m.settings.advanced.about.version.description}
          control={<code className="text-xs font-medium text-muted-foreground">{APP_VERSION}</code>}
        />
        <SettingsRow
          title={m.settings.advanced.about.releaseHistory.title}
          anchorKey="advanced:release-history"
          description={m.settings.advanced.about.releaseHistory.description}
          control={
            <Button size="sm" variant="outline" onClick={props.onOpenReleaseHistory}>
              {m.settings.advanced.about.viewReleaseHistory}
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}

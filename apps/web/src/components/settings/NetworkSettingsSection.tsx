// FILE: NetworkSettingsSection.tsx
// Purpose: Settings section for the outbound HTTP proxy used by Synara's own requests.
// Layer: Settings UI components
// Depends on: server settings (network.proxy) and the shared proxy URL parser

import type { OutboundProxyMode, ServerSettings } from "@synara/contracts";
import { parseProxyUrl } from "@synara/shared/outboundProxy";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { toastManager } from "~/components/ui/toast";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { SettingsSegmentedControl } from "./SettingControls";
import { DebouncedSettingTextInput } from "./DebouncedSettingTextInput";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";
import { useTranslation } from "~/i18n";

export function NetworkSettingsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const proxy = serverSettingsQuery.data?.network.proxy;

  function patchProxy(patch: Partial<ServerSettings["network"]["proxy"]>) {
    // Read through the cache so a rapid mode flip followed by a URL edit
    // builds on the newer value instead of clobbering it.
    const latest = queryClient.getQueryData<ServerSettings>(serverQueryKeys.settings());
    if (!latest) return;
    const next = { ...latest.network.proxy, ...patch };
    queryClient.setQueryData(serverQueryKeys.settings(), {
      ...latest,
      network: { ...latest.network, proxy: next },
    });
    void ensureNativeApi()
      .server.updateSettings({ network: { proxy: patch } })
      .then((settings) => queryClient.setQueryData(serverQueryKeys.settings(), settings))
      .catch(() => {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() });
      });
  }

  function commitUrl(rawValue: string) {
    const trimmed = rawValue.trim();
    if (trimmed) {
      try {
        parseProxyUrl(trimmed);
      } catch {
        // Refuse loudly: a rejected address that looked saved would leave every
        // outbound request quietly unproxied.
        toastManager.add({ type: "warning", title: t("settings:network_proxyUrlInvalid") });
        return;
      }
    }
    if (trimmed === proxy?.url) return;
    patchProxy({ url: trimmed });
  }

  if (!proxy) return null;

  const isManual = proxy.mode === "manual";

  return (
    <SettingsSection title="settings:network_title">
      <SettingsRow
        title="settings:network_proxyTitle"
        anchorKey="advanced:proxy-mode"
        description="settings:network_proxyDescription"
        status={t(`settings:network_proxyModeHint_${proxy.mode}`)}
        control={
          <SettingsSegmentedControl<OutboundProxyMode>
            value={proxy.mode}
            onValueChange={(mode) => patchProxy({ mode })}
            ariaLabel={t("settings:network_proxyModeAriaLabel")}
            options={[
              { value: "off", label: "settings:network_proxyModeOff" },
              { value: "env", label: "settings:network_proxyModeEnvironment" },
              { value: "manual", label: "settings:network_proxyModeManual" },
            ]}
          />
        }
      />

      {isManual ? (
        <>
          <SettingsRow
            title="settings:network_proxyUrlTitle"
            anchorKey="advanced:proxy-url"
            description="settings:network_proxyUrlDescription"
            control={
              <DebouncedSettingTextInput
                size="sm"
                variant="soft"
                className="w-full sm:w-64"
                value={proxy.url}
                placeholder={t("settings:network_proxyUrlPlaceholder")}
                onCommit={commitUrl}
                aria-label={t("settings:network_proxyUrlAriaLabel")}
              />
            }
          />

          <SettingsRow
            title="settings:network_bypassListTitle"
            anchorKey="advanced:proxy-no-proxy"
            description="settings:network_bypassListDescription"
            status={t("settings:network_failClosedNote")}
            control={
              <DebouncedSettingTextInput
                size="sm"
                variant="soft"
                className="w-full sm:w-64"
                value={proxy.noProxy}
                placeholder={t("settings:network_bypassListPlaceholder")}
                onCommit={(value) => patchProxy({ noProxy: value.trim() })}
                aria-label={t("settings:network_bypassListAriaLabel")}
              />
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}

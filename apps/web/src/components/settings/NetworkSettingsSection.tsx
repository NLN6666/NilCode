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
import { useMessages } from "../../i18n/context";
import { SettingsSegmentedControl } from "./SettingControls";
import { DebouncedSettingTextInput } from "./DebouncedSettingTextInput";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

export function NetworkSettingsSection() {
  const m = useMessages();
  const copy = m.settings.advanced.network.proxy;
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
        toastManager.add({ type: "warning", title: copy.url.invalid });
        return;
      }
    }
    if (trimmed === proxy?.url) return;
    patchProxy({ url: trimmed });
  }

  if (!proxy) return null;

  const isManual = proxy.mode === "manual";

  return (
    <SettingsSection title={m.settings.advanced.network.title}>
      <SettingsRow
        title={copy.title}
        anchorKey="advanced:proxy-mode"
        description={copy.description}
        status={copy.modeHints[proxy.mode]}
        control={
          <SettingsSegmentedControl<OutboundProxyMode>
            value={proxy.mode}
            onValueChange={(mode) => patchProxy({ mode })}
            ariaLabel={copy.ariaLabel}
            options={[
              { value: "off", label: copy.modes.off },
              { value: "env", label: copy.modes.env },
              { value: "manual", label: copy.modes.manual },
            ]}
          />
        }
      />

      {isManual ? (
        <>
          <SettingsRow
            title={copy.url.title}
            anchorKey="advanced:proxy-url"
            description={copy.url.description}
            control={
              <DebouncedSettingTextInput
                size="sm"
                variant="soft"
                className="w-full sm:w-64"
                value={proxy.url}
                placeholder={copy.url.placeholder}
                onCommit={commitUrl}
                aria-label={copy.url.ariaLabel}
              />
            }
          />

          <SettingsRow
            title={copy.noProxy.title}
            anchorKey="advanced:proxy-no-proxy"
            description={copy.noProxy.description}
            status={copy.failClosedNote}
            control={
              <DebouncedSettingTextInput
                size="sm"
                variant="soft"
                className="w-full sm:w-64"
                value={proxy.noProxy}
                placeholder={copy.noProxy.placeholder}
                onCommit={(value) => patchProxy({ noProxy: value.trim() })}
                aria-label={copy.noProxy.ariaLabel}
              />
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}

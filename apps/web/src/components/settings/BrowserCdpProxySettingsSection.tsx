// FILE: BrowserCdpProxySettingsSection.tsx
// Purpose: Settings section for the desktop-local CDP proxy that lets chrome-devtools-mcp
//          drive Synara's in-app browser (enable toggle, port, copy MCP configuration).
// Layer: Settings UI components
// Depends on: the desktop bridge's browser.cdpProxy channel and browserCdpProxySetup

import type { DesktopBrowserCdpProxyState } from "@synara/contracts";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useMessages } from "../../i18n/context";
import type { Messages } from "../../i18n/locales/en";
import { buildBrowserCdpProxyMcpConfiguration } from "./browserCdpProxySetup";
import { DebouncedSettingTextInput } from "./DebouncedSettingTextInput";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

const MIN_PORT = 1024;
const MAX_PORT = 65535;

function statusText(state: DesktopBrowserCdpProxyState, m: Messages): string {
  const copy = m.settings.browserCdpProxy.status;
  if (state.lastError) return copy.failed(state.lastError);
  if (!state.enabled) return copy.disabled;
  return state.running && state.endpoint ? copy.running(state.endpoint) : copy.starting;
}

/**
 * Desktop-only: the proxy lives in the Electron main process next to the in-app browser,
 * so the whole section stays hidden when the bridge is absent rather than offering a
 * control that cannot work.
 */
export function BrowserCdpProxySettingsSection() {
  const m = useMessages();
  const copy = m.settings.browserCdpProxy;
  const [proxyState, setProxyState] = useState<DesktopBrowserCdpProxyState | null>(null);
  // Rapid port edits and toggles race; only the newest response may land.
  const latestRequestRef = useRef(0);

  useEffect(() => {
    const bridge = window.desktopBridge?.browser.cdpProxy;
    if (!bridge) return;
    let disposed = false;
    const unsubscribe = bridge.onState((state) => {
      if (!disposed) setProxyState(state);
    });
    void bridge
      .getState()
      .then((state) => {
        if (!disposed) setProxyState(state);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  async function applySettings(enabled: boolean, port: number) {
    const bridge = window.desktopBridge?.browser.cdpProxy;
    if (!bridge) return;
    latestRequestRef.current += 1;
    const requestId = latestRequestRef.current;
    try {
      const state = await bridge.setSettings({ enabled, port });
      if (latestRequestRef.current !== requestId) return;
      setProxyState(state);
    } catch (error: unknown) {
      if (latestRequestRef.current !== requestId) return;
      toastManager.add({
        type: "error",
        title: copy.toasts.updateFailedTitle,
        description: error instanceof Error ? error.message : copy.toasts.updateFailedDescription,
      });
    }
  }

  function commitPort(rawValue: string) {
    if (!proxyState) return;
    const port = Number(rawValue.trim());
    if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
      // Refuse loudly: a silently ignored port would look applied but bind nothing.
      toastManager.add({
        type: "warning",
        title: copy.toasts.invalidPortTitle,
        description: copy.toasts.invalidPortDescription(MIN_PORT, MAX_PORT),
      });
      return;
    }
    if (port === proxyState.port) return;
    void applySettings(proxyState.enabled, port);
  }

  function copyConfiguration(endpoint: string, token: string) {
    void copyTextToClipboard(buildBrowserCdpProxyMcpConfiguration({ endpoint, token })).then(
      () => toastManager.add({ type: "success", title: copy.configuration.copied }),
      (error: unknown) =>
        toastManager.add({
          type: "error",
          title: copy.toasts.copyFailedTitle,
          description: error instanceof Error ? error.message : copy.toasts.copyFailedDescription,
        }),
    );
  }

  if (!proxyState) return null;

  const endpoint = proxyState.endpoint;
  const token = proxyState.token;

  return (
    <SettingsSection title={copy.title}>
      <SettingsRow
        title={copy.enable.title}
        anchorKey="integrations:cdp-proxy-enable"
        description={copy.enable.description}
        status={statusText(proxyState, m)}
        control={
          <Switch
            checked={proxyState.enabled}
            onCheckedChange={(checked) => void applySettings(Boolean(checked), proxyState.port)}
            aria-label={copy.enable.ariaLabel}
          />
        }
      />

      <SettingsRow
        title={copy.port.title}
        anchorKey="integrations:cdp-proxy-port"
        description={copy.port.description}
        control={
          <DebouncedSettingTextInput
            type="number"
            size="sm"
            min={MIN_PORT}
            max={MAX_PORT}
            step={1}
            inputMode="numeric"
            variant="soft"
            className="w-full text-right sm:w-24"
            value={String(proxyState.port)}
            onCommit={commitPort}
            aria-label={copy.port.ariaLabel}
          />
        }
      />

      <SettingsRow
        title={copy.configuration.title}
        anchorKey="integrations:cdp-proxy-configuration"
        description={copy.configuration.description}
        status={endpoint && token ? undefined : copy.configuration.unavailable}
        control={
          <Button
            size="xs"
            variant="outline"
            disabled={!endpoint || !token}
            onClick={() => {
              if (endpoint && token) copyConfiguration(endpoint, token);
            }}
          >
            {copy.configuration.copy}
          </Button>
        }
      />
    </SettingsSection>
  );
}

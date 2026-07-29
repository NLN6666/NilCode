// FILE: outboundProxyRuntime.ts
// Purpose: Bridges the persisted network settings and the process environment into the
//          shared outbound HTTP layer's proxy resolver.
// Layer: Server runtime wiring
// Depends on: ServerSettingsService, @synara/shared/outboundProxy, @synara/shared/outboundHttp

import type { NetworkServerSettings } from "@synara/contracts";
import { setOutboundProxyResolver } from "@synara/shared/outboundHttp";
import {
  type OutboundProxyConfig,
  parseNoProxy,
  parseProxyUrl,
  resolveProxyFromEnv,
} from "@synara/shared/outboundProxy";
import { Effect, Stream } from "effect";

import { ServerSettingsService } from "./serverSettings";

/**
 * Turn persisted settings into a usable proxy configuration.
 *
 * A malformed manual URL yields no proxy rather than throwing: the request path
 * still fails closed (no proxy configured means a direct attempt), and the
 * settings panel is where the user sees the validation error. Returning an
 * error here would take down every outbound request instead.
 */
export function resolveOutboundProxy(input: {
  readonly network: NetworkServerSettings;
  readonly env: NodeJS.ProcessEnv;
}): OutboundProxyConfig | undefined {
  const { mode, url, noProxy } = input.network.proxy;
  if (mode === "off") return undefined;
  if (mode === "env") return resolveProxyFromEnv(input.env);

  const trimmed = url.trim();
  if (!trimmed) return undefined;
  try {
    return { url: parseProxyUrl(trimmed), noProxy: parseNoProxy(noProxy) };
  } catch {
    return undefined;
  }
}

/**
 * Register the process-wide proxy resolver and keep it current.
 *
 * The resolver reads a mirrored value because `outboundHttp` needs a synchronous
 * answer per request while settings live behind an Effect service.
 */
export const startOutboundProxySync = Effect.fn("startOutboundProxySync")(function* () {
  const serverSettings = yield* ServerSettingsService;
  const env = process.env;
  let current: OutboundProxyConfig | undefined;

  const settings = yield* serverSettings.getSettings;
  current = resolveOutboundProxy({ network: settings.network, env });
  yield* Effect.sync(() => setOutboundProxyResolver(() => current));

  yield* serverSettings.streamChanges.pipe(
    Stream.runForEach((next) =>
      Effect.sync(() => {
        current = resolveOutboundProxy({ network: next.network, env });
      }),
    ),
    Effect.forkScoped,
  );
});

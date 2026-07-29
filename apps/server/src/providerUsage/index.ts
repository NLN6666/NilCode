// FILE: providerUsage/index.ts
// Purpose: Orchestrate the live provider-usage fetchers — defensive batch fetch (one failure never
// blocks the others), and enrichment of Codex/Claude live
// snapshots with the locally-derived token-total usage lines. Exposes both a plain async API
// (for tests) and an Effect that reads ServerConfig (for the WS RPC handler).

import type {
  ProviderKind,
  ServerListProviderUsageInput,
  ServerListProviderUsageResult,
  ServerProviderUsageSnapshot,
} from "@synara/contracts";
import { Effect } from "effect";

import { ServerConfig } from "../config";
import { createLogger } from "../logger";
import { buildProviderChildEnvironment, type ProviderChildKind } from "../providerChildEnvironment";
import { loadLocalProviderUsageLines } from "../providerUsageSnapshot";
import { errorSnapshot } from "./parse";
import { PROVIDER_USAGE_FETCHERS } from "./registry";
import type { ProviderUsageContext } from "./types";

const log = createLogger("providerUsage");

// Providers whose live snapshot is enriched with on-disk token-total lines (24h/7d/30d).
const LOCAL_ARCHIVE_PROVIDERS: ReadonlySet<ProviderKind> = new Set(["codex", "claudeAgent"]);

const providerChildKind = (provider: ProviderKind): ProviderChildKind =>
  provider === "claudeAgent" ? "claude" : provider;

function buildContext(): ProviderUsageContext {
  return {
    homeDir: "",
    env: process.env,
    platform: process.platform,
    nowMs: Date.now(),
  };
}

async function fetchProviderUsage(
  provider: ProviderKind,
  ctx: ProviderUsageContext,
): Promise<ServerProviderUsageSnapshot | null> {
  const fetcher = PROVIDER_USAGE_FETCHERS[provider];
  if (!fetcher) {
    return null;
  }

  const providerContext: ProviderUsageContext = {
    ...ctx,
    env: buildProviderChildEnvironment({
      provider: providerChildKind(provider),
      baseEnv: ctx.env,
    }),
  };
  return fetcher.fetch(providerContext).catch((error: unknown) => {
    // The snapshot shown in the panel is deliberately generic, but discarding the
    // cause outright leaves a broken fetcher indistinguishable from a signed-out
    // provider — with nothing anywhere to tell them apart.
    log.error("provider fetch threw", { provider, error: String(error) });
    return errorSnapshot(provider, ctx.nowMs, "live-usage", "Usage fetch failed unexpectedly.");
  });
}

async function enrichWithLocalUsage(
  snapshot: ServerProviderUsageSnapshot,
  ctx: ProviderUsageContext,
): Promise<ServerProviderUsageSnapshot> {
  if ((snapshot.status ?? "ok") !== "ok" || !LOCAL_ARCHIVE_PROVIDERS.has(snapshot.provider)) {
    return snapshot;
  }
  const localLines = await loadLocalProviderUsageLines({
    provider: snapshot.provider,
    homeDir: ctx.homeDir,
  });
  if (localLines.length === 0) {
    return snapshot;
  }
  return { ...snapshot, usageLines: [...snapshot.usageLines, ...localLines] };
}

/** Plain async batch fetch for supported providers. Never throws. */
export async function collectProviderUsageSnapshots(
  ctx: ProviderUsageContext,
  options: { forceRefresh?: boolean; provider?: ProviderKind } = {},
): Promise<ServerProviderUsageSnapshot[]> {
  const providers = options.provider
    ? ([options.provider] as ProviderKind[])
    : (Object.keys(PROVIDER_USAGE_FETCHERS) as ProviderKind[]);
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const snapshot = await fetchProviderUsage(provider, ctx);
      return snapshot ? enrichWithLocalUsage(snapshot, ctx) : null;
    }),
  );

  return settled
    .map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      // Dropping a rejected provider silently makes the panel render a bare
      // "unavailable" placeholder, which reads as "nothing to report" rather
      // than "this failed" — the distinction the user needs.
      log.error("provider fetch rejected", {
        provider: providers[index],
        reason: String(result.reason),
      });
      return null;
    })
    .filter((snapshot): snapshot is ServerProviderUsageSnapshot => snapshot !== null);
}

export const listProviderUsage = Effect.fn(function* (input: ServerListProviderUsageInput) {
  const serverConfig = yield* ServerConfig;
  return yield* Effect.tryPromise({
    try: () =>
      collectProviderUsageSnapshots(
        {
          ...buildContext(),
          homeDir: serverConfig.homeDir,
        },
        {
          forceRefresh: input.forceRefresh === true,
          ...(input.provider ? { provider: input.provider } : {}),
        },
      ),
    catch: (cause) => {
      // `collectProviderUsageSnapshots` is written not to throw, so reaching here
      // means something upstream of the per-provider guards broke. Returning an
      // empty batch keeps the panel alive; logging is what keeps it diagnosable.
      log.error("batch collection failed", { cause: String(cause) });
      return [] as unknown as ServerListProviderUsageResult;
    },
  });
});

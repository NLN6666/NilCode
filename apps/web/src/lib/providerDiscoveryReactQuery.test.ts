// FILE: providerDiscoveryReactQuery.test.ts
// Purpose: Locks provider model discovery query semantics — retry policy,
//          stale-catalog preservation, and initial-vs-background pending (#103).
// Layer: Web data fetching tests

import type { NativeApi } from "@synara/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isInitialModelDiscoveryPending,
  providerCloudModelsQueryOptions,
  providerDiscoveryQueryKeys,
  providerModelsQueryOptions,
  refreshCloudModelCatalog,
} from "./providerDiscoveryReactQuery";
import * as nativeApi from "../nativeApi";

function mockListModels(listModels: ReturnType<typeof vi.fn>) {
  vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
    provider: { listModels },
  } as unknown as NativeApi);
  return listModels;
}

function mockListCloudModels(listCloudModels: ReturnType<typeof vi.fn>) {
  vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
    provider: { listCloudModels },
  } as unknown as NativeApi);
  return listCloudModels;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isInitialModelDiscoveryPending", () => {
  it("is pending only for the first fetch (loading or placeholder fetch)", () => {
    expect(
      isInitialModelDiscoveryPending({
        isLoading: true,
        isFetching: true,
        isPlaceholderData: true,
      }),
    ).toBe(true);
    expect(
      isInitialModelDiscoveryPending({
        isLoading: false,
        isFetching: true,
        isPlaceholderData: true,
      }),
    ).toBe(true);
    // Settled catalog + background refetch must not blank the picker (#103).
    expect(
      isInitialModelDiscoveryPending({
        isLoading: false,
        isFetching: true,
        isPlaceholderData: false,
      }),
    ).toBe(false);
    expect(
      isInitialModelDiscoveryPending({
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
      }),
    ).toBe(false);
  });
});

describe("providerModelsQueryOptions", () => {
  it("fails fast for Cursor so a missing CLI settles instead of spinning (#103)", async () => {
    const listModels = mockListModels(
      vi.fn().mockRejectedValue(new Error("Cursor CLI is not installed or not on PATH")),
    );
    const options = providerModelsQueryOptions({ provider: "cursor", enabled: true });
    expect(options.retry).toBe(0);

    const queryClient = new QueryClient();
    await expect(queryClient.fetchQuery(options)).rejects.toThrow(
      "Cursor CLI is not installed or not on PATH",
    );
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(options.queryKey)?.status).toBe("error");
  });

  it("keeps retrying transient failures for other providers", () => {
    expect(providerModelsQueryOptions({ provider: "codex" }).retry).toBe(3);
    expect(providerModelsQueryOptions({ provider: "droid" }).retry).toBe(0);
  });

  it("surfaces real errors instead of masking them as empty catalogs", async () => {
    mockListModels(vi.fn().mockRejectedValue(new Error("discovery exploded")));
    const options = providerModelsQueryOptions({ provider: "cursor", enabled: true });

    const queryClient = new QueryClient();
    await expect(queryClient.fetchQuery(options)).rejects.toThrow("discovery exploded");
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
  });

  it("preserves the cached catalog when a background refetch fails", async () => {
    const catalog = {
      models: [{ slug: "auto", name: "Auto" }],
      source: "cursor.cli",
      cached: false,
    };
    const listModels = mockListModels(
      vi.fn().mockResolvedValueOnce(catalog).mockRejectedValue(new Error("cursor went away")),
    );
    const options = providerModelsQueryOptions({ provider: "cursor", enabled: true });

    const queryClient = new QueryClient();
    await expect(queryClient.fetchQuery(options)).resolves.toEqual(catalog);
    await queryClient.refetchQueries({ queryKey: options.queryKey });

    expect(listModels).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(options.queryKey)).toEqual(catalog);
  });

  it("returns successful catalogs unchanged", async () => {
    const catalog = {
      models: [{ slug: "gpt-5.4", name: "GPT-5.4" }],
      source: "codex",
      cached: false,
    };
    mockListModels(vi.fn().mockResolvedValue(catalog));
    const options = providerModelsQueryOptions({ provider: "codex", enabled: true });

    const queryClient = new QueryClient();
    await expect(queryClient.fetchQuery(options)).resolves.toEqual(catalog);
  });
});

describe("refreshCloudModelCatalog", () => {
  it("punches through the server cache once and re-reads every mounted provider", async () => {
    const rosterByProvider: Record<string, ReadonlyArray<{ slug: string; name: string }>> = {
      claudeAgent: [{ slug: "claude-opus-5", name: "Claude Opus 5" }],
    };
    const listCloudModels = mockListCloudModels(
      vi
        .fn()
        .mockImplementation(({ provider }: { provider: string }) =>
          Promise.resolve({ models: rosterByProvider[provider] ?? [] }),
        ),
    );
    const queryClient = new QueryClient();
    // A day-long staleTime means only an invalidation makes a mounted query read
    // again, so the observer is what turns this into the real two-cache path.
    const observer = new QueryObserver(queryClient, providerCloudModelsQueryOptions("claudeAgent"));
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    rosterByProvider.claudeAgent = [
      { slug: "claude-opus-5", name: "Claude Opus 5" },
      { slug: "claude-fable-5", name: "Claude Fable 5" },
    ];

    const total = await refreshCloudModelCatalog(queryClient);
    unsubscribe();

    // One forced call regardless of how many providers are cached: the server
    // memoizes a single catalog for all of them.
    expect(listCloudModels.mock.calls.filter(([input]) => input.refresh === true)).toEqual([
      [{ provider: "codex", refresh: true }],
    ]);
    // Seed + forced probe + the mounted provider re-reading after invalidation.
    expect(listCloudModels).toHaveBeenCalledTimes(3);
    expect(total).toBe(2);
  });

  it("falls back to the forced result when no provider query is mounted", async () => {
    mockListCloudModels(
      vi.fn().mockResolvedValue({
        models: [
          { slug: "gpt-6", name: "GPT-6" },
          { slug: "gpt-6-mini", name: "GPT-6 mini" },
        ],
      }),
    );

    expect(await refreshCloudModelCatalog(new QueryClient())).toBe(2);
  });

  it("reports an empty catalog rather than pretending the refresh worked", async () => {
    mockListCloudModels(vi.fn().mockResolvedValue({ models: [] }));

    expect(await refreshCloudModelCatalog(new QueryClient())).toBe(0);
  });

  it("propagates a transport failure so the caller can surface it", async () => {
    mockListCloudModels(vi.fn().mockRejectedValue(new Error("websocket closed")));

    await expect(refreshCloudModelCatalog(new QueryClient())).rejects.toThrow("websocket closed");
  });

  it("keys every provider's cloud roster under one invalidatable prefix", () => {
    expect(providerDiscoveryQueryKeys.cloudModels("codex")).toEqual([
      ...providerDiscoveryQueryKeys.cloudModelsAll(),
      "codex",
    ]);
  });
});

// FILE: cloudModelCatalog.ts
// Purpose: Fetches the public models.dev catalog and projects it onto Synara's
//          provider/slug namespace, so newly released models are selectable
//          without shipping a release. Supplies the roster only — capabilities
//          stay locally defined (see below).
// Layer: Server provider discovery
// Exports: fetchCloudModelCatalog, projectCloudModelCatalog,
//          CLOUD_MODEL_CATALOG_URL, clearCloudModelCatalogCacheForTests

import type { CloudModelDescriptor, ProviderKind } from "@synara/contracts";
import { decodeOutboundJson, outboundHttp } from "@synara/shared/outboundHttp";

export const CLOUD_MODEL_CATALOG_URL = "https://models.dev/api.json";

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Synara provider → models.dev provider id.
 *
 * Deliberately partial. Router/aggregator runtimes (cursor, droid, kilo,
 * opencode, pi, antigravity) are omitted: their model set is whatever their CLI
 * reports, and a generic catalog would offer slugs the CLI cannot actually
 * start a session with — worse than a missing model.
 */
const MODELS_DEV_PROVIDER_ID: Partial<Record<ProviderKind, string>> = {
  codex: "openai",
  claudeAgent: "anthropic",
  grok: "xai",
};

// The catalog is ~3 MB and deeply nested; the usage-API helper caps responses at
// 1 MB, so this module carries its own policy rather than reusing `fetchJson`.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const JSON_LIMITS = { maxDepth: 32, maxNodes: 2_000_000 } as const;
const REQUEST_TIMEOUT_MS = 20_000;

interface CachedCatalog {
  readonly fetchedAtMs: number;
  readonly modelsByProvider: Readonly<
    Partial<Record<ProviderKind, readonly CloudModelDescriptor[]>>
  >;
}

let cached: CachedCatalog | null = null;
let inFlight: Promise<CachedCatalog | null> | null = null;

export function clearCloudModelCatalogCacheForTests(): void {
  cached = null;
  inFlight = null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

/**
 * Models a coding agent could plausibly drive.
 *
 * A vendor-neutral catalog lists everything the vendor sells, so three coarse
 * gates do the pruning:
 *
 * - `tool_call`: an agent that cannot call tools is useless here.
 * - text output: `xai` mixes in `grok-imagine-image` / `grok-imagine-video`.
 * - `reasoning`: the harnesses Synara drives are reasoning-model harnesses.
 *   This is what removes the whole gpt-4 / gpt-4o / gpt-4.1 era, which the
 *   Codex CLI cannot run, while keeping every gpt-5.x and every Claude model.
 *
 * The gates cannot be exact — only the CLI knows what it accepts, and runtime
 * discovery outranks this list wherever it answers.
 */
function isSelectableCodingModel(model: Record<string, unknown>): boolean {
  if (model.tool_call !== true || model.reasoning !== true) {
    return false;
  }
  const modalities = asRecord(model.modalities);
  const output = modalities?.output;
  return Array.isArray(output) && output.includes("text");
}

/**
 * Effort ladder as the catalog reports it (`reasoning_options[].type === "effort"`).
 * Advisory only: the local capability template decides the ladder actually
 * offered, because provider-private levels (Codex `xhigh`, Claude `ultrathink`)
 * are invisible to a vendor-neutral catalog.
 */
function readReasoningEffortValues(model: Record<string, unknown>): readonly string[] | undefined {
  const options = model.reasoning_options;
  if (!Array.isArray(options)) return undefined;
  for (const entry of options) {
    const option = asRecord(entry);
    if (option?.type !== "effort" || !Array.isArray(option.values)) continue;
    const values = option.values.flatMap((value) => {
      const trimmed = asTrimmedString(value);
      return trimmed ? [trimmed] : [];
    });
    if (values.length > 0) return values;
  }
  return undefined;
}

function projectModel(modelId: string, raw: unknown): CloudModelDescriptor | null {
  const model = asRecord(raw);
  if (!model || !isSelectableCodingModel(model)) {
    return null;
  }
  const slug = asTrimmedString(model.id) ?? asTrimmedString(modelId);
  if (!slug) {
    return null;
  }
  const name = asTrimmedString(model.name);
  const description = asTrimmedString(model.description);
  const contextWindowTokens = asPositiveInteger(asRecord(model.limit)?.context);
  const reasoningEffortValues = readReasoningEffortValues(model);

  return {
    slug,
    name: name ?? slug,
    ...(description ? { description } : {}),
    ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
    ...(reasoningEffortValues ? { reasoningEffortValues } : {}),
  };
}

/**
 * Projects a raw models.dev payload onto Synara's providers. Pure and total —
 * malformed sections are dropped rather than failing the whole catalog, because
 * one bad vendor entry should not cost the user every other model.
 */
export function projectCloudModelCatalog(
  payload: unknown,
): Readonly<Partial<Record<ProviderKind, readonly CloudModelDescriptor[]>>> {
  const root = asRecord(payload);
  if (!root) {
    return {};
  }

  const result: Partial<Record<ProviderKind, readonly CloudModelDescriptor[]>> = {};
  for (const [provider, upstreamId] of Object.entries(MODELS_DEV_PROVIDER_ID)) {
    if (!upstreamId) continue;
    const models = asRecord(asRecord(root[upstreamId])?.models);
    if (!models) continue;

    const projected = Object.entries(models).flatMap(([modelId, raw]) => {
      const model = projectModel(modelId, raw);
      return model ? [model] : [];
    });
    if (projected.length > 0) {
      result[provider as ProviderKind] = projected.toSorted((a, b) => a.slug.localeCompare(b.slug));
    }
  }
  return result;
}

async function requestCatalog(): Promise<CachedCatalog | null> {
  try {
    const response = await outboundHttp.request({
      policy: {
        service: "models.dev",
        allowedOrigins: ["https://models.dev"],
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxRequestBytes: 0,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        maxRedirects: 0,
        maxConcurrent: 1,
        maxQueued: 2,
        requirePublicAddress: true,
      },
      url: CLOUD_MODEL_CATALOG_URL,
      method: "GET",
      headers: { accept: "application/json" },
    });

    if (response.status < 200 || response.status >= 300) {
      return null;
    }
    const modelsByProvider = projectCloudModelCatalog(decodeOutboundJson(response, JSON_LIMITS));
    // An empty projection means the upstream shape changed. Reporting it as a
    // successful empty catalog would evict a good cached copy on every refresh.
    if (Object.keys(modelsByProvider).length === 0) {
      return null;
    }
    return { fetchedAtMs: Date.now(), modelsByProvider };
  } catch {
    return null;
  }
}

/**
 * The cloud roster, or `{}` when it cannot be obtained. Never rejects: callers
 * fall back to the built-in model table, which stays the offline baseline.
 *
 * A stale cache outlives a failed refresh — a transient network blip should not
 * make models the user was just offered disappear.
 */
export async function fetchCloudModelCatalog(options?: {
  readonly nowMs?: number;
  /**
   * Skip the TTL shortcut, for an explicit "refresh now" from the user. It still
   * joins a fetch already in flight — that fetch is itself a live network read,
   * so sharing it costs nothing and keeps a double-click from becoming two
   * requests. What `force` must never do is answer from `cached`.
   */
  readonly force?: boolean;
}): Promise<Readonly<Partial<Record<ProviderKind, readonly CloudModelDescriptor[]>>>> {
  const nowMs = options?.nowMs ?? Date.now();
  if (!options?.force && cached && nowMs - cached.fetchedAtMs < CATALOG_TTL_MS) {
    return cached.modelsByProvider;
  }

  // Collapse concurrent refreshes: every composer mount asks for this at once.
  inFlight ??= requestCatalog().finally(() => {
    inFlight = null;
  });

  const fresh = await inFlight;
  if (fresh) {
    cached = fresh;
    return fresh.modelsByProvider;
  }
  return cached?.modelsByProvider ?? {};
}

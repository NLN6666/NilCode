// FILE: providerOrdering.ts
// Purpose: Keeps provider picker ordering stable across settings, search, and menus.
// Layer: Web settings utility
// Exports: default order, normalization, and order comparison helpers.

import type { ProviderKind } from "@synara/contracts";
import { PROVIDER_DESCRIPTORS } from "@synara/shared/providerMetadata";

export const DEFAULT_PROVIDER_ORDER: readonly ProviderKind[] = PROVIDER_DESCRIPTORS.map(
  (descriptor) => descriptor.kind,
);

const PROVIDER_KIND_SET: ReadonlySet<ProviderKind> = new Set(DEFAULT_PROVIDER_ORDER);

export function isProviderKind(value: string): value is ProviderKind {
  return PROVIDER_KIND_SET.has(value as ProviderKind);
}

export function normalizeHiddenProviders(hiddenProviders: ReadonlyArray<string>): ProviderKind[] {
  const seen = new Set<ProviderKind>();
  const result: ProviderKind[] = [];
  for (const candidate of hiddenProviders) {
    if (isProviderKind(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}

export function normalizeProviderOrder(providerOrder: ReadonlyArray<string>): ProviderKind[] {
  const seen = new Set<ProviderKind>();
  const result: ProviderKind[] = [];
  for (const candidate of providerOrder) {
    if (isProviderKind(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  for (const provider of DEFAULT_PROVIDER_ORDER) {
    if (!seen.has(provider)) {
      result.push(provider);
    }
  }
  return result;
}

export function sameProviderOrder(
  left: ReadonlyArray<ProviderKind>,
  right: ReadonlyArray<ProviderKind>,
): boolean {
  return left.length === right.length && left.every((provider, index) => provider === right[index]);
}

export function compareProvidersByOrder(
  providerOrder: ReadonlyArray<ProviderKind>,
  left: ProviderKind,
  right: ProviderKind,
): number {
  const leftIndex = providerOrder.indexOf(left);
  const rightIndex = providerOrder.indexOf(right);
  const normalizedLeftIndex =
    leftIndex >= 0 ? leftIndex : DEFAULT_PROVIDER_ORDER.indexOf(left) + providerOrder.length;
  const normalizedRightIndex =
    rightIndex >= 0 ? rightIndex : DEFAULT_PROVIDER_ORDER.indexOf(right) + providerOrder.length;
  return normalizedLeftIndex - normalizedRightIndex;
}

export interface HiddenModelRef {
  readonly provider: ProviderKind;
  readonly slug: string;
}

export function normalizeHiddenModels(
  hiddenModels: ReadonlyArray<{ provider: string; slug: string }>,
): HiddenModelRef[] {
  const seen = new Set<string>();
  const result: HiddenModelRef[] = [];
  for (const candidate of hiddenModels) {
    const slug = candidate.slug.trim();
    if (!isProviderKind(candidate.provider) || slug.length === 0) {
      continue;
    }
    const key = `${candidate.provider}:${slug.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ provider: candidate.provider, slug });
  }
  return result;
}

/** A user-chosen default model for one provider. Same shape as {@link HiddenModelRef}
 *  so the persisted settings stay a flat list and adding a `ProviderKind` needs no
 *  schema migration.
 *
 *  `effort` and `contextWindow` hold the chosen *values* in the provider's own
 *  vocabulary, not the option fields they end up in: the field name differs per
 *  provider and a runtime-discovered descriptor can override it, so it is resolved
 *  at write time (see `composerEffortOptionId`) rather than frozen into storage.
 *  Both are absent until explicitly picked, which is what keeps a model on its own
 *  default instead of pinning whatever the default happened to be that day. */
export interface DefaultModelRef {
  readonly provider: ProviderKind;
  readonly slug: string;
  readonly effort?: string | undefined;
  readonly contextWindow?: string | undefined;
}

/** Keeps the first entry per provider; a provider can only have one default. */
export function normalizeDefaultModels(
  defaultModels: ReadonlyArray<{
    provider: string;
    slug: string;
    effort?: string | undefined;
    contextWindow?: string | undefined;
  }>,
): DefaultModelRef[] {
  const seen = new Set<ProviderKind>();
  const result: DefaultModelRef[] = [];
  for (const candidate of defaultModels) {
    const slug = candidate.slug.trim();
    if (!isProviderKind(candidate.provider) || slug.length === 0 || seen.has(candidate.provider)) {
      continue;
    }
    seen.add(candidate.provider);
    const effort = candidate.effort?.trim();
    const contextWindow = candidate.contextWindow?.trim();
    result.push({
      provider: candidate.provider,
      slug,
      ...(effort ? { effort } : {}),
      ...(contextWindow ? { contextWindow } : {}),
    });
  }
  return result;
}

export function resolveDefaultModelSlug(
  defaultModels: ReadonlyArray<DefaultModelRef> | null | undefined,
  provider: ProviderKind,
): string | null {
  return resolveDefaultModelRef(defaultModels, provider)?.slug ?? null;
}

/** The whole entry, for callers that also need the stored reasoning level or window. */
export function resolveDefaultModelRef(
  defaultModels: ReadonlyArray<DefaultModelRef> | null | undefined,
  provider: ProviderKind,
): DefaultModelRef | null {
  const match = defaultModels?.find((entry) => entry.provider === provider);
  const slug = match?.slug.trim();
  return match && slug && slug.length > 0 ? { ...match, slug } : null;
}

/**
 * Replaces one provider's entry. A blank slug drops it entirely - traits are
 * meaningless without a model to hang them on. Callers decide whether traits
 * survive a model change; only they know which levels the new model offers.
 */
export function patchDefaultModelForProvider(
  defaultModels: ReadonlyArray<DefaultModelRef>,
  provider: ProviderKind,
  next: Omit<DefaultModelRef, "provider"> | null,
): DefaultModelRef[] {
  const others = defaultModels.filter((entry) => entry.provider !== provider);
  const slug = next?.slug.trim() ?? "";
  if (slug.length === 0) {
    return others;
  }
  const effort = next?.effort?.trim();
  const contextWindow = next?.contextWindow?.trim();
  return [
    ...others,
    {
      provider,
      slug,
      ...(effort ? { effort } : {}),
      ...(contextWindow ? { contextWindow } : {}),
    },
  ];
}

/**
 * Drops hidden models from a provider's picker list.
 *
 * `protectedSlug` — the model the surface is currently using — is always kept.
 * Model hiding was withdrawn once before because it could strand a thread on a
 * model the picker refused to show; this guard is what makes it safe, and is
 * the reason callers must go through this helper rather than filtering inline.
 *
 * Hiding every model is also treated as hiding none: an empty picker reads as a
 * broken app, and the user's next action would be to undo it anyway.
 */
export function filterModelOptionsByVisibility<T extends { slug: string }>(
  provider: ProviderKind,
  options: ReadonlyArray<T>,
  hiddenModels: ReadonlyArray<HiddenModelRef>,
  protectedSlug?: string | null,
): ReadonlyArray<T> {
  if (hiddenModels.length === 0 || options.length === 0) {
    return options;
  }
  const hidden = new Set(
    hiddenModels
      .filter((entry) => entry.provider === provider)
      .map((entry) => entry.slug.trim().toLowerCase()),
  );
  if (hidden.size === 0) {
    return options;
  }
  const keep = protectedSlug?.trim().toLowerCase();
  const visible = options.filter(
    (option) =>
      option.slug.trim().toLowerCase() === keep || !hidden.has(option.slug.trim().toLowerCase()),
  );
  return visible.length > 0 ? visible : options;
}

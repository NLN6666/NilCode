// FILE: providerSteer.ts
// Purpose: Single source of truth for which providers can steer a live turn natively
//          versus which have to interrupt it and re-dispatch.
// Layer: Shared runtime utility (server + web)
// Exports: NATIVE_STEER_PROVIDERS, providerSupportsNativeSteer, steerInterruptsLiveTurn

import type { ProviderKind } from "@synara/contracts";

// A native steer rides the turn that is already running: the message joins the live
// turn's context and the provider keeps going. Every other provider has to stop the
// turn and start a new one, which is a visibly destructive action for the user — the
// answer in flight is discarded.
//
// This list is deliberately narrow. Implementing `steerTurn` on an adapter is NOT
// enough to belong here: the runtime has to accept the message into a turn that is
// already in flight. Claude, for instance, exposes a streaming prompt queue, but the
// Agent SDK queues those messages for the *next* turn and offers only `interrupt()`
// to affect the current one — so it steers by interrupting, and stays off this list.
export const NATIVE_STEER_PROVIDERS: ReadonlySet<ProviderKind> = new Set<ProviderKind>(["codex"]);

export function providerSupportsNativeSteer(provider: ProviderKind | null | undefined): boolean {
  return provider !== null && provider !== undefined && NATIVE_STEER_PROVIDERS.has(provider);
}

// True when steering has to stop whatever the provider is currently doing. Callers use
// this both to warn the user before the fact and to decide whether the dispatch needs
// the interrupt→re-dispatch handoff instead of a native steer.
export function steerInterruptsLiveTurn(provider: ProviderKind | null | undefined): boolean {
  return !providerSupportsNativeSteer(provider);
}

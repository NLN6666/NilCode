/**
 * AnalyticsServiceLive - Local no-op telemetry layer.
 *
 * Nothing leaves the machine: there is no remote delivery, no batching, and no
 * persistent installation identifier. The `analytics.record` call sites across
 * the server are deliberately kept so a self-hosted sink or a local event log
 * can be wired in later without re-instrumenting every code path.
 *
 * @module AnalyticsServiceLive
 */

import { Effect, Layer } from "effect";

import { AnalyticsService, type AnalyticsServiceShape } from "../Services/AnalyticsService.ts";

export const AnalyticsServiceLayerLive = Layer.succeed(AnalyticsService, {
  record: () => Effect.void,
  flush: Effect.void,
} satisfies AnalyticsServiceShape);

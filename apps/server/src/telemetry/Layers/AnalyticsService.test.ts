import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { ServerConfig } from "../../config.ts";
import { AnalyticsService } from "../Services/AnalyticsService.ts";
import { AnalyticsServiceLayerLive } from "./AnalyticsService.ts";

interface RecordedRequest {
  readonly method: string;
  readonly path: string;
}

it.layer(NodeServices.layer)("AnalyticsService test", (it) => {
  // The event call sites are kept as hooks for a future local/self-hosted sink,
  // but the live layer must never send anything off the machine.
  it.effect("records and flushes without performing any network delivery", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "synara-telemetry-base-",
      });

      const telemetryLayer = AnalyticsServiceLayerLive.pipe(Layer.provideMerge(serverConfigLayer));
      // Configured as if telemetry were fully enabled: nothing may be delivered
      // even when a key, a host, and an opt-in flag are all present.
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          SYNARA_TELEMETRY_ENABLED: true,
          SYNARA_POSTHOG_KEY: "phc_test_key",
          SYNARA_POSTHOG_HOST: "",
          SYNARA_TELEMETRY_FLUSH_BATCH_SIZE: 20,
        }),
      );
      const captureServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          capturedRequests.push({ method: request.method, path: request.url });
          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(captureServerLayer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService;

        for (let index = 0; index < 45; index += 1) {
          yield* analytics.record("test.telemetry.disabled", { index });
        }

        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      // Covers delivery on record, on flush, and on scope close.
      assert.deepEqual(capturedRequests, []);
    }),
  );
});

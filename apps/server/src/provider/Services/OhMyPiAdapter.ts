/** Oh My Pi stock ACP implementation of the generic provider contract. */
import type {
  OmpLaunchDescribeInput,
  OmpLaunchDescribeResult,
  OmpLaunchReadLogsInput,
  OmpLaunchReadLogsResult,
  OmpLaunchRestartInput,
  OmpLaunchSendInput,
  OmpLaunchStopInput,
  OmpRuntimeService,
} from "@synara/contracts";
import { Effect, ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface OhMyPiAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "omp";
  readonly describeLaunchService: (
    input: OmpLaunchDescribeInput,
  ) => Effect.Effect<OmpLaunchDescribeResult, ProviderAdapterError>;
  readonly readLaunchLogs: (
    input: OmpLaunchReadLogsInput,
  ) => Effect.Effect<OmpLaunchReadLogsResult, ProviderAdapterError>;
  readonly sendLaunchText: (
    input: OmpLaunchSendInput,
  ) => Effect.Effect<OmpRuntimeService, ProviderAdapterError>;
  readonly stopLaunchService: (
    input: OmpLaunchStopInput,
  ) => Effect.Effect<OmpRuntimeService, ProviderAdapterError>;
  readonly restartLaunchService: (
    input: OmpLaunchRestartInput,
  ) => Effect.Effect<OmpRuntimeService, ProviderAdapterError>;
}

export class OhMyPiAdapter extends ServiceMap.Service<OhMyPiAdapter, OhMyPiAdapterShape>()(
  "synara/provider/Services/OhMyPiAdapter",
) {}

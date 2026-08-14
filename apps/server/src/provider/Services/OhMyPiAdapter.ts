/** Oh My Pi stock ACP implementation of the generic provider contract. */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface OhMyPiAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "omp";
}

export class OhMyPiAdapter extends ServiceMap.Service<OhMyPiAdapter, OhMyPiAdapterShape>()(
  "synara/provider/Services/OhMyPiAdapter",
) {}

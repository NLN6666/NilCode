import { describe, expect, it, vi } from "vitest";

import { createPinnedLookup } from "./outboundHttp";

const PINNED = { address: "2606:4700:20::681a:86c", family: 6 } as const;

describe("createPinnedLookup", () => {
  it("answers an all:true lookup with an array", () => {
    // Regression: Node (24.x observed) calls a custom `lookup` with
    // `all: true`. Answering that with the `(address, family)` shape makes the
    // socket read `undefined` as its host and throw ERR_INVALID_IP_ADDRESS
    // before a byte leaves the process — which took every outbound request
    // down, provider usage polling and the cloud model catalog alike.
    const callback = vi.fn();

    createPinnedLookup(PINNED)("models.dev", { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [
      { address: PINNED.address, family: PINNED.family },
    ]);
  });

  it("answers a single lookup with the address and family positionally", () => {
    const callback = vi.fn();

    createPinnedLookup(PINNED)("models.dev", { all: false }, callback);

    expect(callback).toHaveBeenCalledWith(null, PINNED.address, PINNED.family);
  });

  it("treats an absent `all` as the single-address shape", () => {
    const callback = vi.fn();

    createPinnedLookup(PINNED)("models.dev", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, PINNED.address, PINNED.family);
  });

  it("ignores the requested hostname so the checked address is the one dialed", () => {
    // The whole point of pinning: the address the policy approved must be the
    // address connected to, closing the DNS-rebinding window.
    const callback = vi.fn();

    createPinnedLookup({ address: "104.26.8.108", family: 4 })(
      "attacker.example",
      { all: true },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(null, [{ address: "104.26.8.108", family: 4 }]);
  });
});

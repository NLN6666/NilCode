import { assert, describe, it } from "@effect/vitest";

import {
  renderSynaraHarnessPolicy,
  SYNARA_HARNESS_POLICY_MARKER,
  SYNARA_HARNESS_POLICY_VERSION,
  type SynaraHarnessPolicyDeliveryState,
  takeSynaraHarnessPolicyForProviderSession,
  takeSynaraHarnessPolicyTextPartForProviderSession,
  takeSynaraHarnessPolicyForSession,
} from "./harnessPolicy.ts";

describe("Synara harness policy", () => {
  it("never advertises gateway mutation to providers without scoped MCP", () => {
    const policy = renderSynaraHarnessPolicy({ gatewayControlAvailable: false });
    assert.include(policy, "Synara MCP control is unavailable");
  });

  it("delivers a private host-context block once per provider session", () => {
    const state: SynaraHarnessPolicyDeliveryState = {};
    assert.include(
      takeSynaraHarnessPolicyForSession(state, { gatewayControlAvailable: true }) ?? "",
      "<synara_host_context>",
    );
    assert.isNull(takeSynaraHarnessPolicyForSession(state, { gatewayControlAvailable: true }));
  });

  it("re-delivers to a session that only ever saw an older policy version", () => {
    // Delivery used to latch on a bare boolean, so a session already open when the policy
    // changed kept the old rules for its whole life — exactly how a long-lived session
    // misses a newly added constraint.
    const state: SynaraHarnessPolicyDeliveryState = {
      deliveredHarnessPolicyVersion: "2026-01-01.1",
    };

    assert.include(
      takeSynaraHarnessPolicyForSession(state, { gatewayControlAvailable: true }) ?? "",
      SYNARA_HARNESS_POLICY_MARKER,
    );
    assert.strictEqual(state.deliveredHarnessPolicyVersion, SYNARA_HARNESS_POLICY_VERSION);
  });

  it("stays silent for a session already holding the current policy version", () => {
    const state: SynaraHarnessPolicyDeliveryState = {
      deliveredHarnessPolicyVersion: SYNARA_HARNESS_POLICY_VERSION,
    };

    assert.isNull(takeSynaraHarnessPolicyForSession(state, { gatewayControlAvailable: true }));
  });

  it("delivers once on fresh/load/fork sessions for every scoped MCP provider", () => {
    for (const provider of ["antigravity", "cursor", "grok", "droid", "opencode", "pi"] as const) {
      for (const lifecycle of ["fresh", "load", "fork"] as const) {
        const state: SynaraHarnessPolicyDeliveryState = {};
        const first =
          takeSynaraHarnessPolicyTextPartForProviderSession(state, {
            provider,
            scopedGatewayConnectionAvailable: true,
          })?.text ?? "";
        assert.include(first, SYNARA_HARNESS_POLICY_MARKER, `${provider}/${lifecycle}`);
        assert.include(first, "Use the synara_* tools", `${provider}/${lifecycle}`);
        assert.isNull(
          takeSynaraHarnessPolicyForProviderSession(state, {
            provider,
            scopedGatewayConnectionAvailable: true,
          }),
          `${provider}/${lifecycle}`,
        );
      }
    }
  });

  it("keeps OpenCode and Pi identity-only until scoped setup succeeds", () => {
    for (const provider of ["opencode", "pi"] as const) {
      const text =
        takeSynaraHarnessPolicyForProviderSession(
          {},
          { provider, scopedGatewayConnectionAvailable: false },
        ) ?? "";
      assert.include(text, SYNARA_HARNESS_POLICY_MARKER, provider);
      assert.include(text, "Synara MCP control is unavailable", provider);
    }
  });

  it("keeps Oh My Pi identity-only because Launch is OMP-owned", () => {
    const text =
      takeSynaraHarnessPolicyForProviderSession(
        {},
        { provider: "omp", scopedGatewayConnectionAvailable: true },
      ) ?? "";

    assert.include(text, SYNARA_HARNESS_POLICY_MARKER);
    assert.include(text, "Synara MCP control is unavailable");
    assert.notInclude(text, "Use the synara_* tools");
  });

  it("keeps the gateway policy below its prompt budget", () => {
    assert.isAtMost(renderSynaraHarnessPolicy({ gatewayControlAvailable: true }).length, 6_000);
  });
});

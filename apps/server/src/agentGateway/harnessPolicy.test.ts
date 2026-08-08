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
  it("identifies Synara and explains exact batch coordination when MCP is available", () => {
    const policy = renderSynaraHarnessPolicy({ gatewayControlAvailable: true });
    assert.include(policy, SYNARA_HARNESS_POLICY_MARKER);
    assert.include(policy, "Synara is the host and harness");
    assert.include(policy, "one exact synara_create_threads plan");
    assert.include(policy, "before returning an operationId");
    assert.include(policy, "synara_wait_for_threads");
    assert.include(policy, "Use the browser_* tools");
    assert.include(policy, "exact thread-scoped Electron page Synara surfaces to the user");
    assert.include(policy, "continue in the background");
    assert.include(policy, "must never change the user's active chat");
    assert.include(policy, "in any language");
    assert.include(policy, "canonical and complete control surface");
    assert.include(policy, "start with browser_open");
    assert.include(policy, "do not load or use a generic Browser");
    assert.include(policy, "workspace-relative paths");
    assert.include(policy, "BrowserInterruptedByHuman");
    assert.include(policy, "BrowserDownloadApprovalRequired");
    assert.include(policy, "OAuth popup requiring human action");
    assert.include(policy, "stop using tools and answer");
    assert.include(policy, "do not create Synara threads");
    assert.include(policy, "3–8 word outcome-oriented task label");
    assert.include(policy, "no assumed chat context");
    assert.include(policy, "notifying the user versus staying silent");
    assert.include(policy, 'later manual follow-up such as "continue"');
    assert.include(policy, "Never call this tool for a manual follow-up turn");
  });

  it("routes long-running processes to the daemon tools instead of a backgrounded shell", () => {
    const policy = renderSynaraHarnessPolicy({ gatewayControlAvailable: true });

    // A shell-backgrounded server dies with the session's process tree and never shows
    // up in the services panel, so this steer is what makes "ending a chat does not end
    // the service" true in practice rather than only in the broker.
    assert.include(policy, "must outlive this turn");
    assert.include(policy, "synara_*_daemon");
    assert.include(policy, "Never background it from a shell");
    assert.include(policy, "background services panel");
    assert.include(policy, "detached: true");
  });

  it("names PowerShell's backgrounding verbs, not just the POSIX ones", () => {
    // findings.md #16: the enumeration listed `&`, `nohup`, `start /b` and run-in-background
    // flags, so on Windows the agent read `Start-Process` as unlisted and used it.
    const policy = renderSynaraHarnessPolicy({ gatewayControlAvailable: true });

    assert.include(policy, "Start-Process");
  });

  it("never advertises gateway mutation to providers without scoped MCP", () => {
    const policy = renderSynaraHarnessPolicy({ gatewayControlAvailable: false });
    assert.include(policy, "Synara MCP control is unavailable");
    assert.notInclude(policy, "one exact synara_create_threads plan");
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
    for (const provider of [
      "antigravity",
      "cursor",
      "grok",
      "droid",
      "opencode",
      "kilo",
      "pi",
    ] as const) {
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

  it("keeps OpenCode, Kilo, and Pi identity-only until scoped setup succeeds", () => {
    for (const provider of ["opencode", "kilo", "pi"] as const) {
      const text =
        takeSynaraHarnessPolicyForProviderSession(
          {},
          { provider, scopedGatewayConnectionAvailable: false },
        ) ?? "";
      assert.include(text, SYNARA_HARNESS_POLICY_MARKER, provider);
      assert.include(text, "Synara MCP control is unavailable", provider);
      assert.notInclude(text, "one exact synara_create_threads plan", provider);
    }
  });
});

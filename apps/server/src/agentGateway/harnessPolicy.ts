import type { ProviderKind } from "@synara/contracts";

import { AUTOMATION_AUTHORING_GUIDANCE } from "./automationAuthoringGuidance.ts";

/** Canonical, versioned host policy delivered to every supported provider. */
export const SYNARA_HARNESS_POLICY_VERSION = "2026-09-07.1";
export const SYNARA_HARNESS_POLICY_MARKER = `[Synara harness policy ${SYNARA_HARNESS_POLICY_VERSION}]`;

export interface SynaraHarnessCapabilities {
  readonly gatewayControlAvailable: boolean;
}

/**
 * Render one truthful policy. Providers without a safely thread-scoped MCP
 * connection still receive host identity, but are never told they can mutate
 * Synara resources.
 */
export function renderSynaraHarnessPolicy(capabilities: SynaraHarnessCapabilities): string {
  const controlPolicy = capabilities.gatewayControlAvailable
    ? [
        "Use the synara_* tools for Synara threads, projects, automations, and coordination.",
        "For Synara's in-app browser, autonomously use browser_* in any language. Never substitute external browsers, Computer Use, Playwright, or OS-automation tools/skills, or change the active chat. Follow tool descriptions.",
        "For iOS apps or simulators, autonomously use device_* in any language so the user sees the streamed pane. Never substitute simctl, AppleScript, Appium, idb, Simulator.app, or mobile/OS-automation tools/skills. Follow tool descriptions.",
        "Discover and diagnose threads with synara_list_threads, synara_read_thread, synara_read_thread_activity, synara_read_thread_events, synara_read_thread_runtime_events, and synara_diagnose_thread. Read SQLite or process logs only when these tools lack the required evidence.",
        "After successfully creating a pull request for the current thread's own deliverable, call synara_set_thread_pull_request with its URL. Never associate a pull request that the thread only reviews, references, or discusses.",
        "Processes outliving this turn must use synara_*_daemon tools, never shell backgrounding. Shell children die with the session and are absent from Services. Declare ready on synara_start_daemon; use synara_send_daemon_input for graceful shutdown before synara_stop_daemon. Use detached: true only to survive Synara exiting.",
        "Provider-native subagent or Task tools are implementation details: they do not create Synara threads and must not substitute for an explicit request to create Synara threads.",
        "Create multiple threads in one synara_create_threads plan with exactly the requested count.",
        "If synara_create_threads rejects the plan during validation or preflight before returning an operationId, correct that same plan and retry it with the same requestId. This is safe because no durable operation, thread, or worktree was created.",
        "Use synara_capabilities to select canonical provider, model, and option values. Never guess a model slug or silently substitute a provider or model.",
        "Provider option keys are not interchangeable: Codex uses options.reasoningEffort and Claude Agent uses options.effort. Follow synara_capabilities.targetConstruction for every provider instead of inspecting Synara source code.",
        "When results are requested, call synara_wait_for_threads for the created thread ids, wait for every requested result, then synthesize all outcomes.",
        "After synara_create_threads returns an operationId, retries must keep the same requestId and exact plan. Report terminal operation failures as outcomes; do not create replacement threads unless the user gives a new instruction.",
        "Synara automations support heartbeat, standalone, and dedicated modes plus interval, once, daily, weekdays, weekly, and cron schedules. Existing everyMinutes heartbeat calls remain supported. Use fastInterval: true only when the user explicitly accepts a sub-minute bounded loop.",
        "Mode controls execution: heartbeat appends to an idle target thread; standalone opens a fresh thread per independent run; dedicated reuses one automation-owned thread so runs build on each other without writing into another thread.",
        "Prefer dedicated for ongoing observation or tracking: standalone runs cannot see prior runs beyond memory, while dedicated keeps one growing thread.",
        'Mode does not restrict stop conditions. completionPolicy {"type":"ai-evaluated","stopWhen":"..."} works in both modes and disables the automation when the clause matches a successful run; prefer it over encoding the stop condition in the prompt. maxIterations remains the backstop, and an automation-dispatched run may always call synara_cancel_automation on its own automation.',
        AUTOMATION_AUTHORING_GUIDANCE,
        "Prefer synara_create_automation with suggested: true when the user has not explicitly asked to create an automation. Suggested automations remain disabled until the user accepts their proposal card.",
        "Before synara_update_automation, call synara_view_automation and resend the complete mutable configuration, including unchanged fields. Updates are full replacement and partial payloads are rejected.",
        'Automation-dispatched turns receive an identity/run/memory envelope in the current user message. Only that current turn is automation-dispatched; the status never carries into a later manual follow-up such as "continue", even in the same thread.',
        'During an automation-dispatched turn, persist durable context with synara_update_automation_memory {"memory": "..."} before finishing; memory is full replacement, DB-backed, and capped at 32 KiB.',
        'Every automation-dispatched turn must finish by calling synara_report_automation_result. Use decision "silent" only for a successful run with nothing requiring user attention; otherwise use "notify" with a concise title and summary. Failures remain visible regardless of this decision or the automation notification policy. Never call this tool for a manual follow-up turn.',
      ]
    : [
        "Synara MCP control is unavailable in this provider session. Do not claim that Synara threads, projects, or automations were created or changed.",
        "Provider-native subagent or Task tools do not create Synara threads. If the user explicitly requests Synara resource management, explain that this session cannot perform it.",
      ];

  return [
    SYNARA_HARNESS_POLICY_MARKER,
    "Synara is your host and harness.",
    "For known local files in user-facing Markdown, use readable labels and absolute file URLs, such as [config.ts](file:///absolute/path/config.ts). Relative links are only for the session working directory; otherwise use plain text and never invent a path.",
    'Synara collapses progress and tools under "Worked for...". Final responses must restate every needed scope, plan, decision, result, caveat, instruction, or question. Never request approval using "this", "the above", or another referent available only in collapsed content.',
    "When a structured user-input tool is available for a genuine decision, prefer it and include all decision context in its question or card.",
    ...controlPolicy,
  ].join("\n");
}

export const SYNARA_GATEWAY_HARNESS_POLICY = renderSynaraHarnessPolicy({
  gatewayControlAvailable: true,
});

export interface SynaraHarnessPolicyDeliveryState {
  /**
   * Policy version this session has already seen.
   *
   * Deliberately a version rather than a "delivered" flag: a boolean latches, so a session
   * that was already open when the policy changed would keep the superseded rules for its
   * whole life and never learn a newly added constraint.
   */
  deliveredHarnessPolicyVersion?: string;
}

const PROVIDERS_WITH_THREAD_SCOPED_SYNARA_MCP = new Set<ProviderKind>([
  "codex",
  "claudeAgent",
  "antigravity",
  "cursor",
  "grok",
  "droid",
  "devin",
  "opencode",
  "pi",
]);

export function providerHasSynaraGatewayControl(input: {
  readonly provider: ProviderKind;
  readonly scopedGatewayConnectionAvailable: boolean;
}): boolean {
  return (
    input.scopedGatewayConnectionAvailable &&
    PROVIDERS_WITH_THREAD_SCOPED_SYNARA_MCP.has(input.provider)
  );
}

/** Return the private host-context block once per policy version for one provider session. */
export function takeSynaraHarnessPolicyForSession(
  state: SynaraHarnessPolicyDeliveryState,
  capabilities: SynaraHarnessCapabilities,
): string | null {
  if (state.deliveredHarnessPolicyVersion === SYNARA_HARNESS_POLICY_VERSION) return null;
  state.deliveredHarnessPolicyVersion = SYNARA_HARNESS_POLICY_VERSION;
  return [
    "<synara_host_context>",
    renderSynaraHarnessPolicy(capabilities),
    "</synara_host_context>",
  ].join("\n");
}

/**
 * Provider-aware delivery guard. The transport flag must only become true
 * after a provider has installed thread-scoped gateway tools successfully.
 */
export function takeSynaraHarnessPolicyForProviderSession(
  state: SynaraHarnessPolicyDeliveryState,
  input: {
    readonly provider: ProviderKind;
    readonly scopedGatewayConnectionAvailable: boolean;
  },
): string | null {
  return takeSynaraHarnessPolicyForSession(state, {
    gatewayControlAvailable: providerHasSynaraGatewayControl(input),
  });
}

export function takeSynaraHarnessPolicyTextPartForProviderSession(
  state: SynaraHarnessPolicyDeliveryState,
  input: {
    readonly provider: ProviderKind;
    readonly scopedGatewayConnectionAvailable: boolean;
  },
): { readonly type: "text"; readonly text: string } | null {
  const text = takeSynaraHarnessPolicyForProviderSession(state, input);
  return text === null ? null : { type: "text", text };
}

// Deterministic, redacted subset captured from stock Oh My Pi 17.3.3 on Windows.
// It intentionally omits user paths, credentials, session ids, usage, model catalogs, and skills.
export const OH_MY_PI_ACP_17_3_3_FIXTURE = {
  initializeRequest: {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
      elicitation: true,
    },
    clientInfo: { name: "synara", version: "fixture" },
  },
  initializeResponse: {
    protocolVersion: 1,
    agentInfo: { name: "oh-my-pi", title: "Oh My Pi", version: "17.3.3" },
    authMethods: [
      {
        id: "agent",
        name: "Use existing local credentials",
        description: "Authenticate via credentials already configured under the OMP home.",
      },
    ],
    agentCapabilities: {
      loadSession: true,
      mcpCapabilities: { http: true, sse: true },
      promptCapabilities: { embeddedContext: true, image: true },
      sessionCapabilities: { list: {}, fork: {}, resume: {}, close: {} },
    },
  },
  authenticateRequest: { methodId: "agent", _meta: { headless: true } },
  authenticateResponse: {},
  sessionNewResponse: {
    sessionId: "omp-fixture-session",
    configOptions: [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "default",
        options: [
          { value: "default", name: "Default", description: "Standard ACP headless mode" },
          { value: "plan", name: "Plan", description: "Read-only planning mode" },
        ],
      },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "fixture/model-a",
        options: [
          { value: "fixture/model-a", name: "Fixture Model A" },
          { value: "fixture/model-b", name: "Fixture Model B" },
        ],
      },
      {
        id: "thinking",
        name: "Thinking",
        category: "thought_level",
        type: "select",
        currentValue: "high",
        options: [
          { value: "off", name: "Off" },
          { value: "auto", name: "Auto", description: "Auto-detect per prompt" },
          { value: "low", name: "low" },
          { value: "medium", name: "medium" },
          { value: "high", name: "high" },
          { value: "xhigh", name: "xhigh" },
          { value: "max", name: "max" },
        ],
      },
    ],
    modes: {
      availableModes: [
        { id: "default", name: "Default", description: "Standard ACP headless mode" },
        { id: "plan", name: "Plan", description: "Read-only planning mode" },
      ],
      currentModeId: "default",
    },
  },
  availableCommandsUpdate: {
    sessionId: "omp-fixture-session",
    update: {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "model", description: "Select a model", input: { hint: "model" } },
        { name: "compact", description: "Compact the session" },
      ],
    },
  },
  promptUpdates: [
    {
      sessionId: "omp-fixture-session",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "omp-fixture-message",
        content: { type: "text", text: "W0_OK" },
      },
    },
  ],
  promptResponse: { stopReason: "end_turn" },
  cancelledPromptResponse: { stopReason: "cancelled" },
  closeResponse: {},
} as const;

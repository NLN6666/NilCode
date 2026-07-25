import type {
  AgentMcpCatalog,
  AgentMcpSetEnabledInput,
  AgentMcpSourceView,
} from "@synara/contracts";
import { Data, ServiceMap } from "effect";
import type { Effect } from "effect";

export type AgentMcpErrorCode =
  /** The provider's config file does not exist on this machine. */
  | "unavailable"
  /** The config file exists but could not be parsed; writes are refused. */
  | "parse-failed"
  /** The requested server is not declared in the config. */
  | "not-found"
  /** Another process kept overwriting the file; the caller should retry. */
  | "conflict"
  /** Reading or writing the file failed. */
  | "io-failed";

export class AgentMcpError extends Data.TaggedError("AgentMcpError")<{
  readonly code: AgentMcpErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface AgentMcpServiceShape {
  /** Every locally configured Codex and Claude MCP server, already redacted. */
  readonly listServers: () => Effect.Effect<AgentMcpCatalog, AgentMcpError>;
  /** Flips one server's global switch and returns that provider's refreshed view. */
  readonly setServerEnabled: (
    input: AgentMcpSetEnabledInput,
  ) => Effect.Effect<AgentMcpSourceView, AgentMcpError>;
}

export class AgentMcpService extends ServiceMap.Service<AgentMcpService, AgentMcpServiceShape>()(
  "synara/agentMcp/Services/AgentMcpService",
) {}

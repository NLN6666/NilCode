// FILE: AgentMcpSettingsPanel.tsx
// Purpose: List the MCP servers Codex and Claude are configured with locally and flip their
//          global enable switch in place.
// Layer: Settings UI components
// Exports: AgentMcpSettingsPanel

import type {
  AgentMcpCatalog,
  AgentMcpProvider,
  AgentMcpServerDescriptor,
  AgentMcpSetEnabledInput,
  AgentMcpSourceView,
} from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { ensureNativeApi } from "~/nativeApi";
import { SettingsListRow, SettingsSection } from "./SettingsPanelPrimitives";

const AGENT_MCP_QUERY_KEY = ["server", "agentMcpServers"] as const;

const PROVIDER_LABELS: Record<AgentMcpProvider, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
};

const EMPTY_DESCRIPTIONS: Record<AgentMcpProvider, string> = {
  codex: "No MCP servers are declared in this Codex config.",
  claudeAgent: "No MCP servers are declared in this Claude config.",
};

const UNAVAILABLE_DESCRIPTIONS: Record<AgentMcpProvider, string> = {
  codex: "No Codex configuration was found on this machine.",
  claudeAgent: "No Claude configuration was found on this machine.",
};

/**
 * One line describing how the server is launched. Values are never available here: the server
 * sends key names only, so a config full of plaintext API keys renders as `Env: CONTEXT7_API_KEY`.
 */
function describeTransport(transport: AgentMcpServerDescriptor["transport"]): string {
  if (transport._tag === "http") {
    const headers = transport.headerKeys.length
      ? ` · Headers: ${transport.headerKeys.join(", ")}`
      : "";
    return `${transport.url}${headers}`;
  }
  const command = [transport.command, ...transport.args].join(" ").trim();
  const env = transport.envKeys.length ? ` · Env: ${transport.envKeys.join(", ")}` : "";
  return `${command || "(no command)"}${env}`;
}

function withServerEnabled(catalog: AgentMcpCatalog, input: AgentMcpSetEnabledInput) {
  return {
    ...catalog,
    sources: catalog.sources.map((source) =>
      source.provider === input.provider
        ? {
            ...source,
            servers: source.servers.map((server) =>
              server.name === input.name ? { ...server, enabled: input.enabled } : server,
            ),
          }
        : source,
    ),
  } satisfies AgentMcpCatalog;
}

function AgentMcpSourceSection(props: {
  source: AgentMcpSourceView;
  pendingName: string | null;
  onToggle: (server: AgentMcpServerDescriptor, enabled: boolean) => void;
}) {
  const { source, pendingName, onToggle } = props;
  const readOnly = source.parseError !== undefined;

  return (
    <SettingsSection title={`${PROVIDER_LABELS[source.provider]} MCP servers`}>
      <SettingsListRow
        align="start"
        title={<span className="font-normal text-muted-foreground">{source.configPath}</span>}
        description={
          readOnly
            ? `This file could not be parsed, so its servers cannot be changed: ${source.parseError}`
            : undefined
        }
      />
      {!source.available ? (
        <SettingsListRow
          title="Not configured"
          description={UNAVAILABLE_DESCRIPTIONS[source.provider]}
        />
      ) : source.servers.length === 0 ? (
        <SettingsListRow
          title="No servers"
          description={readOnly ? undefined : EMPTY_DESCRIPTIONS[source.provider]}
        />
      ) : (
        source.servers.map((server) => (
          <SettingsListRow
            key={server.name}
            align="start"
            title={server.name}
            description={
              <span className="block break-all">{describeTransport(server.transport)}</span>
            }
            actions={
              <Switch
                checked={server.enabled}
                disabled={readOnly || pendingName === server.name}
                onCheckedChange={(checked) => onToggle(server, checked)}
              />
            }
          />
        ))
      )}
    </SettingsSection>
  );
}

export function AgentMcpSettingsPanel(props: { active: boolean }) {
  const queryClient = useQueryClient();

  // No file watching: `.claude.json` is rewritten constantly with unrelated fields, so the
  // panel refetches while it is visible and offers an explicit refresh instead.
  const catalogQuery = useQuery({
    queryKey: AGENT_MCP_QUERY_KEY,
    queryFn: () => ensureNativeApi().server.listAgentMcpServers(),
    enabled: props.active,
    staleTime: 5_000,
  });

  const setEnabledMutation = useMutation({
    mutationFn: (input: AgentMcpSetEnabledInput) =>
      ensureNativeApi().server.setAgentMcpServerEnabled(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: AGENT_MCP_QUERY_KEY });
      const previous = queryClient.getQueryData<AgentMcpCatalog>(AGENT_MCP_QUERY_KEY);
      // Only this row's prior value is remembered, not a whole-catalog snapshot: rolling back a
      // failed toggle must not also undo a second toggle the user flipped while it was in flight.
      const previousEnabled = previous?.sources
        .find((source) => source.provider === input.provider)
        ?.servers.find((server) => server.name === input.name)?.enabled;
      if (previous) {
        queryClient.setQueryData(AGENT_MCP_QUERY_KEY, withServerEnabled(previous, input));
      }
      return { previousEnabled };
    },
    onSuccess: (view) => {
      // Only the edited provider's group is replaced; the other source keeps its loaded state.
      queryClient.setQueryData(AGENT_MCP_QUERY_KEY, (current: AgentMcpCatalog | undefined) =>
        current
          ? {
              ...current,
              sources: current.sources.map((source) =>
                source.provider === view.provider ? view : source,
              ),
            }
          : current,
      );
    },
    onError: (error: unknown, input, context) => {
      // The atomic write leaves the original file intact on failure, so restoring this one
      // switch to its prior value is always the truthful thing to show.
      const restored = context?.previousEnabled;
      if (restored !== undefined) {
        queryClient.setQueryData(AGENT_MCP_QUERY_KEY, (current: AgentMcpCatalog | undefined) =>
          current ? withServerEnabled(current, { ...input, enabled: restored }) : current,
        );
      }
      // A failure often means the file moved underneath us (server deleted, config rewritten),
      // so re-read it as well.
      void queryClient.invalidateQueries({ queryKey: AGENT_MCP_QUERY_KEY });
      toastManager.add({
        type: "error",
        title: "Could not update the MCP server",
        description: error instanceof Error ? error.message : "The config file was not changed.",
      });
    },
  });

  if (!props.active) return null;

  const pendingName = setEnabledMutation.isPending
    ? (setEnabledMutation.variables?.name ?? null)
    : null;

  return (
    <div className="space-y-6">
      <SettingsSection title="MCP servers">
        <SettingsListRow
          title="Agent MCP servers"
          description="Servers your local Codex and Claude agents can call. Turning one off edits that agent's own config file; Synara never starts these servers itself."
          actions={
            <Button
              size="xs"
              variant="outline"
              disabled={catalogQuery.isFetching}
              onClick={() => void catalogQuery.refetch()}
            >
              {catalogQuery.isFetching ? "Refreshing..." : "Refresh"}
            </Button>
          }
        />
      </SettingsSection>

      {catalogQuery.isLoading ? (
        <SettingsSection title="MCP servers">
          <SettingsListRow title="Loading MCP servers..." />
        </SettingsSection>
      ) : catalogQuery.isError ? (
        <SettingsSection title="MCP servers">
          <SettingsListRow
            title="Could not read the agent configs"
            description={
              catalogQuery.error instanceof Error
                ? catalogQuery.error.message
                : "Reading the local agent configuration failed."
            }
          />
        </SettingsSection>
      ) : (
        catalogQuery.data?.sources.map((source) => (
          <AgentMcpSourceSection
            key={source.provider}
            source={source}
            pendingName={pendingName}
            onToggle={(server, enabled) =>
              setEnabledMutation.mutate({
                provider: server.provider,
                name: server.name,
                enabled,
              })
            }
          />
        ))
      )}
    </div>
  );
}

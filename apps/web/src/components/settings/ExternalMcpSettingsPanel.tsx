import {
  ProjectId,
  type ExternalMcpCapability,
  type ExternalMcpCreateIntegrationResult,
} from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useMessages } from "../../i18n/context";
import type { Messages } from "../../i18n/locales/en";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import {
  buildExternalMcpClientConfiguration,
  buildExternalMcpExamplePrompt,
  buildExternalMcpSetupPrompt,
  describeExternalMcpPermissions,
  describeExternalMcpProjects,
  externalMcpSetupAction,
} from "./externalMcpSetup";
import { SettingsListRow, SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

const INTEGRATIONS_QUERY_KEY = ["server", "externalMcpIntegrations"] as const;
const PROJECTS_QUERY_KEY = ["orchestration", "externalMcpProjects"] as const;
const CORE_CAPABILITIES: ReadonlyArray<ExternalMcpCapability> = [
  "projects:read",
  "tasks:create",
  "tasks:wait",
  "tasks:read",
];

function dateMillis(value: string): number {
  return Date.parse(value);
}

function formatDate(value: string | null, never: string): string {
  if (!value) return never;
  const milliseconds = dateMillis(value);
  return Number.isNaN(milliseconds) ? String(value) : new Date(milliseconds).toLocaleString();
}

function copyWithToast(value: string, title: string, m: Messages): void {
  void copyTextToClipboard(value).then(
    () => toastManager.add({ type: "success", title }),
    (error: unknown) =>
      toastManager.add({
        type: "error",
        title: m.settings.integrations.toasts.copyFailedTitle,
        description:
          error instanceof Error
            ? error.message
            : m.settings.integrations.toasts.copyFailedDescription,
      }),
  );
}

export function ExternalMcpSettingsPanel(props: { active: boolean }) {
  const m = useMessages();
  const copy = m.settings.integrations;
  const queryClient = useQueryClient();
  const [name, setName] = useState<string>(copy.connect.name.defaultValue);
  const [allProjects, setAllProjects] = useState(true);
  const [selectedProjects, setSelectedProjects] = useState<ReadonlySet<string>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [allowProjectRead, setAllowProjectRead] = useState(false);
  const [allowLocal, setAllowLocal] = useState(false);
  const [allowFullAccess, setAllowFullAccess] = useState(false);
  const [setup, setSetup] = useState<ExternalMcpCreateIntegrationResult | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!props.active) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [props.active]);

  const integrationsQuery = useQuery({
    queryKey: INTEGRATIONS_QUERY_KEY,
    queryFn: () => ensureNativeApi().server.listExternalMcpIntegrations(),
    enabled: props.active,
    staleTime: 5_000,
    refetchInterval: setup ? 2_000 : false,
  });
  const projectsQuery = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => ensureNativeApi().orchestration.getShellSnapshot(),
    enabled: props.active,
    staleTime: 5_000,
  });
  const capabilities = useMemo(() => {
    const next = [...CORE_CAPABILITIES];
    if (allowProjectRead) next.push("tasks:read-project");
    if (allowLocal) next.push("runtime:local");
    if (allowFullAccess) next.push("runtime:full-access");
    return next;
  }, [allowFullAccess, allowLocal, allowProjectRead]);

  const createMutation = useMutation({
    mutationFn: () =>
      ensureNativeApi().server.createExternalMcpIntegration({
        name: name.trim(),
        projectScope: allProjects ? "all" : "selected",
        ...(allProjects
          ? {}
          : {
              projectIds: [...selectedProjects].map((projectId) => ProjectId.makeUnsafe(projectId)),
            }),
        capabilities,
        expiresInDays: 30,
      }),
    onSuccess: (result) => {
      setManualOpen(false);
      setSetup(result);
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY_KEY });
      toastManager.add({
        type: "success",
        title: copy.toasts.readyTitle,
        description: copy.toasts.readyDescription,
      });
    },
    onError: (error: unknown) =>
      toastManager.add({
        type: "error",
        title: copy.toasts.createFailedTitle,
        description: error instanceof Error ? error.message : copy.toasts.createFailedDescription,
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: (integrationId: string) =>
      ensureNativeApi().server.revokeExternalMcpIntegration({ integrationId }),
    onSuccess: (_result, integrationId) => {
      setManualOpen(false);
      setSetup((current) =>
        current?.integration.integrationId === integrationId ? null : current,
      );
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY_KEY });
      toastManager.add({
        type: "success",
        title: copy.toasts.revokedTitle,
        description: copy.toasts.revokedDescription,
      });
    },
    onError: (error: unknown) =>
      toastManager.add({
        type: "error",
        title: copy.toasts.revokeFailedTitle,
        description: error instanceof Error ? error.message : copy.toasts.revokeFailedDescription,
      }),
  });

  const refreshPairingMutation = useMutation({
    mutationFn: (integrationId: string) =>
      ensureNativeApi().server.refreshExternalMcpPairing({ integrationId }),
    onSuccess: (result) => {
      setSetup(result);
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY_KEY });
      toastManager.add({
        type: "success",
        title: copy.toasts.pairingReadyTitle,
        description: copy.toasts.pairingReadyDescription,
      });
    },
    onError: (error: unknown) =>
      toastManager.add({
        type: "error",
        title: copy.toasts.pairingFailedTitle,
        description: error instanceof Error ? error.message : copy.toasts.pairingFailedDescription,
      }),
  });

  const continuePairedSetup = (integration: NonNullable<typeof integrationsQuery.data>[number]) => {
    setManualOpen(false);
    setSetup({
      integration,
      pairingCode: "already-paired",
      pairingExpiresAt: integration.createdAt,
      setupCommand: copy.setup.pairingAlreadyCompleted,
      stdio: integration.stdio,
    });
  };

  const closeSetup = () => {
    setManualOpen(false);
    setSetup(null);
  };

  const setupIntegration = setup
    ? (integrationsQuery.data?.find(
        (integration) => integration.integrationId === setup.integration.integrationId,
      ) ?? setup.integration)
    : null;

  if (!props.active) return null;

  const projects = projectsQuery.data?.projects ?? [];
  const canCreate =
    name.trim().length > 0 &&
    (allProjects || selectedProjects.size > 0) &&
    !createMutation.isPending;
  const paired = setupIntegration?.pairedAt != null;
  const connected = paired && setupIntegration?.lastUsedAt != null;
  const revoked = setupIntegration?.revokedAt != null;
  const integrationExpired = setupIntegration
    ? dateMillis(setupIntegration.expiresAt) <= nowMs
    : false;
  const pairingExpired = setup ? dateMillis(setup.pairingExpiresAt) <= nowMs : false;
  const setupUnavailable = revoked || integrationExpired || (!paired && pairingExpired);
  const setupAction = externalMcpSetupAction({
    revoked,
    integrationExpired,
    paired,
    pairingExpired,
  });
  const setupStatus = revoked
    ? copy.setup.status.revoked
    : integrationExpired
      ? copy.setup.status.expired
      : connected
        ? copy.setup.status.connected
        : paired
          ? copy.setup.status.pairedWaiting
          : pairingExpired
            ? copy.setup.status.pairingExpired
            : copy.setup.status.waiting;
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const setupPrompt = setup
    ? buildExternalMcpSetupPrompt({
        setupCommand: paired ? null : setup.setupCommand,
        stdio: setup.stdio,
        platform,
      })
    : null;
  const manualConfiguration = setup
    ? buildExternalMcpClientConfiguration("other", setup.stdio, platform)
    : null;
  const examplePrompt = setup
    ? buildExternalMcpExamplePrompt(
        setup.integration.projectScope === "all"
          ? null
          : (setup.integration.allowedProjects[0]?.title ?? null),
      )
    : null;

  return (
    <div className="space-y-6">
      {!setup ? (
        <SettingsSection title={copy.connect.title}>
          <SettingsRow
            title={copy.connect.name.title}
            anchorKey="integrations:name"
            description={copy.connect.name.description}
            control={
              <Input
                className="w-full sm:w-64"
                value={name}
                maxLength={120}
                placeholder={copy.connect.name.defaultValue}
                onChange={(event) => setName(event.target.value)}
              />
            }
          />
          <SettingsRow
            title={copy.connect.allProjects.title}
            anchorKey="integrations:all-projects"
            description={copy.connect.allProjects.description}
            control={<Switch checked={allProjects} onCheckedChange={setAllProjects} />}
          >
            <DisclosureRegion open={!allProjects} contentClassName="mt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {projects.map((project) => {
                  const checked = selectedProjects.has(project.id);
                  return (
                    <label
                      key={project.id}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs transition-colors",
                        checked ? "border-foreground/30 bg-muted/70" : "border-border/70",
                      )}
                    >
                      <span className="min-w-0 truncate">{project.title}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedProjects((current) => {
                            const next = new Set(current);
                            if (checked) next.delete(project.id);
                            else next.add(project.id);
                            return next;
                          })
                        }
                      />
                    </label>
                  );
                })}
                {projects.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{copy.connect.noProjects}</span>
                ) : null}
              </div>
            </DisclosureRegion>
          </SettingsRow>
          <SettingsRow
            title={copy.connect.advanced.title}
            anchorKey="integrations:advanced-permissions"
            description={copy.connect.advanced.description}
            control={
              <Button
                size="xs"
                variant="ghost"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((current) => !current)}
              >
                {copy.connect.advanced.review}
                <DisclosureChevron open={advancedOpen} className="ml-1 size-3.5" />
              </Button>
            }
          >
            <DisclosureRegion
              open={advancedOpen}
              contentClassName="mt-3 space-y-4 border-t border-border/70 pt-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium">
                    {copy.connect.advanced.readOtherTasks.title}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {copy.connect.advanced.readOtherTasks.description}
                  </div>
                </div>
                <Switch checked={allowProjectRead} onCheckedChange={setAllowProjectRead} />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium">
                    {copy.connect.advanced.sharedCheckout.title}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {copy.connect.advanced.sharedCheckout.description}
                  </div>
                </div>
                <Switch checked={allowLocal} onCheckedChange={setAllowLocal} />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium">
                    {copy.connect.advanced.noApprovals.title}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {copy.connect.advanced.noApprovals.description}
                  </div>
                </div>
                <Switch checked={allowFullAccess} onCheckedChange={setAllowFullAccess} />
              </div>
            </DisclosureRegion>
          </SettingsRow>
          <SettingsRow
            title={copy.connect.create.title}
            anchorKey="integrations:create-connection"
            description={copy.connect.create.description}
            control={
              <Button size="sm" disabled={!canCreate} onClick={() => createMutation.mutate()}>
                {createMutation.isPending
                  ? copy.connect.create.pending
                  : copy.connect.create.action}
              </Button>
            }
          />
        </SettingsSection>
      ) : null}

      {setup && setupIntegration && setupPrompt && manualConfiguration && examplePrompt ? (
        <SettingsSection title={copy.setup.title(setupIntegration.name)}>
          <SettingsRow
            title={
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 rounded-full",
                    setupUnavailable
                      ? "bg-destructive"
                      : connected
                        ? "bg-green-500"
                        : "bg-amber-500",
                  )}
                />
                {setupStatus}
              </span>
            }
            description={
              revoked
                ? copy.setup.description.revoked
                : integrationExpired
                  ? copy.setup.description.expired
                  : connected
                    ? copy.setup.description.connected
                    : paired
                      ? copy.setup.description.paired
                      : pairingExpired
                        ? copy.setup.description.pairingExpired
                        : copy.setup.description.waiting
            }
            status={
              connected
                ? copy.setup.lastConnected(formatDate(setupIntegration.lastUsedAt, copy.never))
                : copy.setup.connectionExpires(formatDate(setupIntegration.expiresAt, copy.never))
            }
            control={
              setupAction === "revoke" ? (
                <Button
                  size="xs"
                  variant="destructive-outline"
                  disabled={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(setupIntegration.integrationId)}
                >
                  {copy.setup.revokeAndRestart}
                </Button>
              ) : setupAction === "resume-pairing" ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={refreshPairingMutation.isPending}
                    onClick={() => refreshPairingMutation.mutate(setupIntegration.integrationId)}
                  >
                    {refreshPairingMutation.isPending
                      ? copy.setup.resuming
                      : copy.setup.resumePairing}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={closeSetup}>
                    {copy.setup.back}
                  </Button>
                </div>
              ) : setupAction === "done" ? (
                <Button size="xs" variant="ghost" onClick={closeSetup}>
                  {copy.setup.done}
                </Button>
              ) : null
            }
          />
          <SettingsRow
            title={copy.setup.prompt.title}
            anchorKey="integrations:setup-prompt"
            description={copy.setup.prompt.description}
            status={
              paired
                ? copy.setup.prompt.pairedStatus
                : copy.setup.prompt.pairingExpires(formatDate(setup.pairingExpiresAt, copy.never))
            }
            control={
              <Button
                size="xs"
                variant="outline"
                disabled={setupUnavailable}
                onClick={() => copyWithToast(setupPrompt, copy.setup.prompt.copied, m)}
              >
                {copy.setup.prompt.copy}
              </Button>
            }
          >
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/30 p-3 text-[11px] leading-relaxed">
              {setupPrompt}
            </pre>
          </SettingsRow>
          <SettingsRow
            title={copy.setup.manual.title}
            anchorKey="integrations:manual-setup"
            description={copy.setup.manual.description}
            control={
              <Button
                size="xs"
                variant="ghost"
                aria-expanded={manualOpen}
                onClick={() => setManualOpen((current) => !current)}
              >
                {copy.setup.manual.show}
                <DisclosureChevron open={manualOpen} className="ml-1 size-3.5" />
              </Button>
            }
          >
            <DisclosureRegion
              open={manualOpen}
              contentClassName="mt-3 space-y-3 border-t border-border/70 pt-3"
            >
              {!paired ? (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium">{copy.setup.manual.pairingCommand}</span>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={setupUnavailable}
                      onClick={() =>
                        copyWithToast(setup.setupCommand, copy.setup.manual.pairingCommandCopied, m)
                      }
                    >
                      {copy.setup.manual.copy}
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/30 p-3 text-[11px] leading-relaxed">
                    {setup.setupCommand}
                  </pre>
                </div>
              ) : null}
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium">{copy.setup.manual.configuration}</span>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={revoked || integrationExpired}
                    onClick={() =>
                      copyWithToast(
                        manualConfiguration.value,
                        copy.setup.manual.configurationCopied,
                        m,
                      )
                    }
                  >
                    {copy.setup.manual.copy}
                  </Button>
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/30 p-3 text-[11px] leading-relaxed">
                  {manualConfiguration.value}
                </pre>
              </div>
            </DisclosureRegion>
          </SettingsRow>
          <SettingsRow
            title={copy.setup.tryIt.title}
            anchorKey="integrations:try-it"
            description={copy.setup.tryIt.description}
            status={connected ? copy.setup.tryIt.verified : copy.setup.tryIt.pending}
            control={
              <Button
                size="xs"
                variant="outline"
                disabled={!paired || revoked || integrationExpired}
                onClick={() => copyWithToast(examplePrompt, copy.setup.tryIt.copied, m)}
              >
                {copy.setup.tryIt.copy}
              </Button>
            }
          >
            {paired ? (
              <div className="mt-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                {examplePrompt}
              </div>
            ) : null}
          </SettingsRow>
        </SettingsSection>
      ) : null}

      <SettingsSection title={copy.connected.title}>
        {integrationsQuery.isLoading ? (
          <SettingsListRow title={copy.connected.loading} />
        ) : integrationsQuery.data?.length ? (
          integrationsQuery.data.map((integration) => {
            const active =
              integration.revokedAt === null && dateMillis(integration.expiresAt) > nowMs;
            const status = active
              ? integration.lastUsedAt
                ? copy.setup.status.connected
                : integration.pairedAt
                  ? copy.setup.status.pairedNotUsed
                  : copy.setup.status.waiting
              : integration.revokedAt
                ? copy.setup.status.revoked
                : copy.setup.status.expired;
            return (
              <SettingsListRow
                key={integration.integrationId}
                align="start"
                title={integration.name}
                description={
                  <div className="space-y-1">
                    <div>{status}</div>
                    <div>
                      {copy.connected.projects(
                        describeExternalMcpProjects(integration, copy.describe),
                      )}
                    </div>
                    <div>
                      {copy.connected.permissions(
                        describeExternalMcpPermissions(integration.capabilities, copy.describe),
                      )}
                    </div>
                    <div>
                      {copy.connected.timeline(
                        formatDate(integration.createdAt, copy.never),
                        formatDate(integration.lastUsedAt, copy.never),
                        formatDate(integration.expiresAt, copy.never),
                      )}
                    </div>
                  </div>
                }
                actions={
                  active ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={refreshPairingMutation.isPending}
                        onClick={() => {
                          if (integration.pairedAt) continuePairedSetup(integration);
                          else refreshPairingMutation.mutate(integration.integrationId);
                        }}
                      >
                        {integration.pairedAt
                          ? copy.connected.continueSetup
                          : copy.setup.resumePairing}
                      </Button>
                      <Button
                        size="xs"
                        variant="destructive-outline"
                        disabled={revokeMutation.isPending}
                        onClick={() => revokeMutation.mutate(integration.integrationId)}
                      >
                        {copy.connected.revoke}
                      </Button>
                    </div>
                  ) : null
                }
              />
            );
          })
        ) : (
          <SettingsListRow
            title={copy.connected.emptyTitle}
            description={copy.connected.emptyDescription}
          />
        )}
      </SettingsSection>
    </div>
  );
}

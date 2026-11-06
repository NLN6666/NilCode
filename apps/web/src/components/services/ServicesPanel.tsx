// FILE: ServicesPanel.tsx
// Purpose: The background services dock pane — Synara daemon and OMP-owned service rosters,
//          live logs, console input, and typed stop/restart controls.
// Layer: Background services UI
// Depends on: daemonStore (state), daemonPresentation (judgements), DaemonLogView (render).
//
// Synara daemons are server-wide. OMP Launch entries remain scoped to their owning OMP
// session and route through the provider's typed ACP extension rather than the daemon broker.

import type { DaemonSnapshot, OmpLaunchDescribeResult, OmpRuntimeService } from "@synara/contracts";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { emptyDaemonLogBuffer } from "~/daemonLogBuffer";
import { useDaemonStore } from "~/daemonStore";
import { useTranslation } from "~/i18n";
import { describeErrorMessage } from "@synara/shared/errorMessages";
import { ensureNativeApi } from "~/nativeApi";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { cn } from "~/lib/utils";
import { ELEVATED_HOVER_SURFACE_CLASS_NAME, THIN_SCROLLBAR_CLASS_NAME } from "~/surfaceStyles";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PanelStateMessage } from "../chat/PanelStateMessage";
import { DaemonLogView } from "./DaemonLogView";
import {
  daemonInputAvailability,
  daemonMetaParts,
  daemonTone,
  isDaemonAlive,
  sortDaemons,
  type DaemonTone,
} from "./daemonPresentation";

/**
 * Stable stand-in for a daemon with no buffer yet.
 *
 * Hoisted rather than built in the selector: zustand compares selector results by
 * reference, so a fresh object per render would report a change every time and spin.
 */
const EMPTY_LOG_BUFFER = emptyDaemonLogBuffer();

const TONE_DOT_CLASS: Record<DaemonTone, string> = {
  pending: "bg-amber-500",
  healthy: "bg-emerald-500",
  neutral: "bg-foreground/30",
  danger: "bg-red-500",
};

function ompServiceTone(service: OmpRuntimeService): DaemonTone {
  if (
    service.state === "starting" ||
    service.state === "restarting" ||
    service.state === "stopping"
  )
    return "pending";
  if (service.state === "running" || service.state === "ready") return "healthy";
  return service.state === "failed" ? "danger" : "neutral";
}

function isOmpServiceAlive(service: OmpRuntimeService): boolean {
  return service.state !== "exited" && service.state !== "failed";
}

/**
 * Pull the backlog the live feed cannot supply.
 *
 * The stream only carries output produced after it opened, so a daemon that has been
 * running since before the panel was opened would show an empty log without this.
 */
function useDaemonLogBacklog(name: string | null): void {
  useEffect(() => {
    if (name === null) return;
    const store = useDaemonStore.getState();
    // `empty` also covers a daemon whose live chunks have been queueing since before the
    // panel was opened: those are pending, not backlog, and still need the history read.
    if ((store.logsByName[name]?.status ?? "empty") !== "empty") return;

    let cancelled = false;
    store.markLogHydrating(name);
    void ensureNativeApi()
      .daemons.readLogs({ name })
      .then((result) => {
        if (cancelled) return;
        useDaemonStore.getState().applyLogBacklog(name, {
          content: result.content,
          nextCursor: result.nextCursor,
          droppedBytes: result.droppedBytes,
          truncated: result.truncated,
        });
      })
      .catch(() => {
        // A backlog that fails to load leaves the live feed intact; the buffer stays in
        // `hydrating` and queues chunks rather than showing a half-truth as complete.
      });

    return () => {
      cancelled = true;
    };
  }, [name]);
}

function DaemonRow(props: { snapshot: DaemonSnapshot; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const parts = daemonMetaParts(props.snapshot, t);

  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-current={props.selected}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
        ELEVATED_HOVER_SURFACE_CLASS_NAME,
        props.selected && "bg-[var(--color-background-elevated-secondary)]",
      )}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", TONE_DOT_CLASS[daemonTone(props.snapshot)])}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ui">{props.snapshot.name}</span>
        {parts.length > 0 && (
          <span className="block truncate text-ui-sm text-foreground/60">{parts.join(" · ")}</span>
        )}
      </span>
      <span className="shrink-0 text-ui-sm text-foreground/60">
        {t(`chat:services_state_${props.snapshot.state}`)}
      </span>
    </button>
  );
}

function DaemonConsole(props: { snapshot: DaemonSnapshot; onError: (detail: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const availability = daemonInputAvailability(props.snapshot);

  if (!availability.enabled) {
    return (
      <p className="px-3 py-2 text-ui-sm text-foreground/60">
        {availability.reason === "detached"
          ? t("chat:services_inputUnavailableDetached")
          : t("chat:services_inputUnavailableExited")}
      </p>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text;
    if (value.length === 0 || busy) return;
    setBusy(true);
    // Cleared optimistically: a console is a stream of commands, and making the user
    // wait for a round trip before typing the next one is the wrong feel.
    setText("");
    void ensureNativeApi()
      .daemons.sendText({ name: props.snapshot.name, text: value })
      .catch((error: unknown) =>
        props.onError(describeErrorMessage(error, t("common:proposedPlan_unknownError"))),
      )
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2 px-3 py-2">
      <Input
        value={text}
        variant="soft"
        size="sm"
        aria-label={t("chat:services_inputLabel")}
        placeholder={t("chat:services_inputPlaceholder")}
        onChange={(event) => setText(event.target.value)}
        className="flex-1 font-mono"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={text.length === 0 || busy}>
        {t("chat:send")}
      </Button>
    </form>
  );
}

function DaemonDetail(props: { snapshot: DaemonSnapshot }) {
  const { t } = useTranslation();
  const buffer =
    useDaemonStore((store) => store.logsByName[props.snapshot.name]) ?? EMPTY_LOG_BUFFER;
  const [pendingAction, setPendingAction] = useState<"stop" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => void (mountedRef.current = false), []);

  const runAction = useCallback(
    (action: "stop" | "restart", name: string) => {
      setPendingAction(action);
      setError(null);
      const api = ensureNativeApi().daemons;
      const request = action === "stop" ? api.stop({ name }) : api.restart({ name });
      void request
        .catch((cause: unknown) => {
          if (mountedRef.current)
            setError(describeErrorMessage(cause, t("common:proposedPlan_unknownError")));
        })
        .finally(() => {
          if (mountedRef.current) setPendingAction(null);
        });
    },
    [t],
  );

  const alive = isDaemonAlive(props.snapshot);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-medium text-ui">{props.snapshot.name}</span>
        {props.snapshot.detached === true && (
          <span
            title={t("chat:services_detachedHint")}
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-ui-xs text-foreground/60"
          >
            {t("chat:services_detached")}
          </span>
        )}
        <Button
          size="xs"
          variant="ghost"
          disabled={pendingAction !== null}
          onClick={() => runAction("restart", props.snapshot.name)}
        >
          {t(pendingAction === "restart" ? "chat:services_restarting" : "common:restart")}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={pendingAction !== null || !alive}
          onClick={() => runAction("stop", props.snapshot.name)}
        >
          {t(pendingAction === "stop" ? "chat:services_stopping" : "chat:stop")}
        </Button>
      </div>

      {error !== null && (
        <p className="border-border border-b px-3 py-1.5 text-ui-sm text-red-500">
          {t("chat:services_actionFailed", { detail: error })}
        </p>
      )}
      {buffer.droppedBytes > 0 && (
        <p className="border-border border-b px-3 py-1.5 text-ui-sm text-foreground/60">
          {t("chat:services_droppedBytes", { bytes: buffer.droppedBytes })}
        </p>
      )}

      <DaemonLogView
        key={props.snapshot.name}
        buffer={buffer}
        label={t("chat:services_logsLabel")}
        className="min-h-0 flex-1 px-2 py-1"
      />

      <div className="border-border border-t">
        <DaemonConsole snapshot={props.snapshot} onError={setError} />
      </div>
    </div>
  );
}

function OmpLaunchDetail(props: { service: OmpRuntimeService }) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<string | null>(null);
  const [description, setDescription] = useState<OmpLaunchDescribeResult | null>(null);
  const [text, setText] = useState("");
  const [pendingAction, setPendingAction] = useState<"send" | "stop" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = props.service.owner;

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    setLogs(null);
    setDescription(null);
    void Promise.all([
      ensureNativeApi().ompLaunch.describe({ owner, name: props.service.name }),
      ensureNativeApi().ompLaunch.readLogs({
        owner,
        name: props.service.name,
        lines: 100,
        cursor: 0,
      }),
    ])
      .then(([nextDescription, result]) => {
        if (!cancelled) {
          setDescription(nextDescription);
          setLogs(result.content);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(describeErrorMessage(cause, t("common:proposedPlan_unknownError")));
      });
    return () => void (cancelled = true);
  }, [t, owner, props.service.name]);

  const run = (action: "stop" | "restart") => {
    if (!owner || pendingAction) return;
    setPendingAction(action);
    setError(null);
    const request =
      action === "stop"
        ? ensureNativeApi().ompLaunch.stop({ owner, name: props.service.name, timeoutSeconds: 5 })
        : ensureNativeApi().ompLaunch.restart({ owner, name: props.service.name });
    void request
      .catch((cause: unknown) =>
        setError(describeErrorMessage(cause, t("common:proposedPlan_unknownError"))),
      )
      .finally(() => setPendingAction(null));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!owner || !text || pendingAction) return;
    const value = text;
    setText("");
    setPendingAction("send");
    setError(null);
    void ensureNativeApi()
      .ompLaunch.sendText({ owner, name: props.service.name, text: value })
      .catch((cause: unknown) =>
        setError(describeErrorMessage(cause, t("common:proposedPlan_unknownError"))),
      )
      .finally(() => setPendingAction(null));
  };

  return (
    <div className="flex min-h-0 flex-col border-border border-t">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-medium text-ui">{props.service.name}</span>
        <Button
          size="xs"
          variant="ghost"
          disabled={!owner || pendingAction !== null}
          onClick={() => run("restart")}
        >
          {t(pendingAction === "restart" ? "chat:services_restarting" : "common:restart")}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={!owner || pendingAction !== null || !isOmpServiceAlive(props.service)}
          onClick={() => run("stop")}
        >
          {t(pendingAction === "stop" ? "chat:services_stopping" : "chat:stop")}
        </Button>
      </div>
      {description ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-border border-t px-3 py-2 text-ui-sm">
          <dt className="text-foreground/60">{t("chat:services_ompCommand")}</dt>
          <dd className="min-w-0 truncate font-mono" title={description.command}>
            {description.command}
          </dd>
          <dt className="text-foreground/60">{t("chat:services_ompCwd")}</dt>
          <dd className="min-w-0 truncate font-mono" title={description.cwd}>
            {description.cwd}
          </dd>
          <dt className="text-foreground/60">{t("chat:services_ompRestartPolicy")}</dt>
          <dd>{description.restart}</dd>
        </dl>
      ) : null}
      {error ? (
        <p className="px-3 py-1.5 text-ui-sm text-red-500">
          {t("chat:services_actionFailed", { detail: error })}
        </p>
      ) : null}
      <pre className="max-h-36 overflow-auto whitespace-pre-wrap border-border border-t px-3 py-2 font-mono text-ui-sm text-foreground/80">
        {logs ?? t("chat:services_ompLogsLoading")}
      </pre>
      <form onSubmit={submit} className="flex items-center gap-2 border-border border-t px-3 py-2">
        <Input
          value={text}
          variant="soft"
          size="sm"
          aria-label={t("chat:services_inputLabel")}
          placeholder={t("chat:services_inputPlaceholder")}
          onChange={(event) => setText(event.target.value)}
          className="flex-1 font-mono"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!owner || !text || pendingAction !== null}
        >
          {t("chat:send")}
        </Button>
      </form>
    </div>
  );
}

function OmpLaunchServices(props: { services: readonly OmpRuntimeService[] }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(props.services[0]?.serviceId ?? null);
  const selected =
    props.services.find((service) => service.serviceId === selectedId) ?? props.services[0] ?? null;

  return (
    <section className="shrink-0 border-border border-b">
      <div className="px-3 py-2">
        <div className="font-medium text-ui text-foreground">{t("chat:services_ompAuthority")}</div>
        <div className="text-ui-sm text-foreground/60">{t("chat:services_ompScoped")}</div>
      </div>
      <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
        {props.services.map((service) => (
          <button
            key={service.serviceId}
            type="button"
            onClick={() => setSelectedId(service.serviceId)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left",
              ELEVATED_HOVER_SURFACE_CLASS_NAME,
              service.serviceId === selected?.serviceId &&
                "bg-[var(--color-background-elevated-secondary)]",
            )}
          >
            <span
              aria-hidden
              className={cn("size-2 rounded-full", TONE_DOT_CLASS[ompServiceTone(service)])}
            />
            <span className="min-w-0 flex-1 truncate text-ui">{service.name}</span>
            <span className="text-ui-sm text-foreground/60">
              {t(`chat:services_state_${service.state}`)}
            </span>
          </button>
        ))}
      </div>
      {selected ? <OmpLaunchDetail service={selected} /> : null}
    </section>
  );
}

// The daemon feed is subscribed once at app start (routes/__root.tsx), not here: the
// dock entry that opens this pane is gated on the roster, so the roster cannot depend
// on the pane being open. See findings.md #17.
export function ServicesPanel() {
  const { t } = useTranslation();
  const providerStatuses = useProviderStatusesForLocalConfig();

  const daemonsByName = useDaemonStore((store) => store.daemonsByName);
  const hydrated = useDaemonStore((store) => store.hydrated);
  const selectedName = useDaemonStore((store) => store.selectedName);
  const select = useDaemonStore((store) => store.select);
  useDaemonLogBacklog(selectedName);

  const daemons = sortDaemons(Object.values(daemonsByName));
  const ompServices =
    providerStatuses.find((status) => status.provider === "omp")?.ompPolicy?.runtime?.launch
      ?.services ?? [];
  const selected = selectedName === null ? null : (daemonsByName[selectedName] ?? null);

  if (!hydrated)
    return <PanelStateMessage>{t("chat:loadingBackgroundServices")}</PanelStateMessage>;
  if (daemons.length === 0 && ompServices.length === 0) {
    return (
      <PanelStateMessage>
        <span className="flex flex-col gap-1">
          <span>{t("chat:services_empty")}</span>
          <span className="text-ui-sm text-foreground/60">{t("chat:services_emptyHint")}</span>
        </span>
      </PanelStateMessage>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {ompServices.length > 0 ? <OmpLaunchServices services={ompServices} /> : null}
      {daemons.length > 0 ? (
        <div
          className={cn(
            "max-h-40 shrink-0 overflow-y-auto border-border border-b p-1.5",
            THIN_SCROLLBAR_CLASS_NAME,
          )}
        >
          <div className="flex flex-col gap-0.5">
            {daemons.map((daemon) => (
              <DaemonRow
                key={daemon.name}
                snapshot={daemon}
                selected={daemon.name === selectedName}
                onSelect={() => select(daemon.name)}
              />
            ))}
          </div>
        </div>
      ) : null}
      {selected !== null && <DaemonDetail snapshot={selected} />}
    </div>
  );
}

export default ServicesPanel;

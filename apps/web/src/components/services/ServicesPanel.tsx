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
import { applyDaemonEvent, useDaemonStore } from "~/daemonStore";
import { useMessages } from "~/i18n/context";
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
  if (service.state === "starting" || service.state === "restarting" || service.state === "stopping") return "pending";
  if (service.state === "running" || service.state === "ready") return "healthy";
  return service.state === "failed" ? "danger" : "neutral";
}

function isOmpServiceAlive(service: OmpRuntimeService): boolean {
  return service.state !== "exited" && service.state !== "failed";
}

/**
 * Subscribe while the pane is mounted.
 *
 * Scoped to the pane rather than to app start so a user who never opens it pays for no
 * stream. The roster arrives as the subscription's first event, so there is no separate
 * fetch to keep in sync with it.
 */
function useDaemonFeed(): void {
  useEffect(() => {
    const store = useDaemonStore.getState();
    return ensureNativeApi().daemons.onEvent((event) => applyDaemonEvent(store, event));
  }, []);
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
  const copy = useMessages().chat.services;
  const parts = daemonMetaParts(props.snapshot, copy);

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
        <span className="block truncate font-medium text-xs">{props.snapshot.name}</span>
        {parts.length > 0 && (
          <span className="block truncate text-[11px] text-foreground/60">{parts.join(" · ")}</span>
        )}
      </span>
      <span className="shrink-0 text-[11px] text-foreground/60">
        {copy.states[props.snapshot.state]}
      </span>
    </button>
  );
}

function DaemonConsole(props: { snapshot: DaemonSnapshot; onError: (detail: string) => void }) {
  const copy = useMessages().chat.services;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const availability = daemonInputAvailability(props.snapshot);

  if (!availability.enabled) {
    return (
      <p className="px-3 py-2 text-[11px] text-foreground/60">
        {availability.reason === "detached"
          ? copy.inputUnavailableDetached
          : copy.inputUnavailableExited}
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
      .catch((error: unknown) => props.onError(describeErrorMessage(error, copy.unknownError)))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2 px-3 py-2">
      <Input
        value={text}
        variant="soft"
        size="sm"
        aria-label={copy.inputLabel}
        placeholder={copy.inputPlaceholder}
        onChange={(event) => setText(event.target.value)}
        className="flex-1 font-mono"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={text.length === 0 || busy}>
        {copy.send}
      </Button>
    </form>
  );
}

function DaemonDetail(props: { snapshot: DaemonSnapshot }) {
  const copy = useMessages().chat.services;
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
          if (mountedRef.current) setError(describeErrorMessage(cause, copy.unknownError));
        })
        .finally(() => {
          if (mountedRef.current) setPendingAction(null);
        });
    },
    [copy.unknownError],
  );

  const alive = isDaemonAlive(props.snapshot);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-medium text-xs">{props.snapshot.name}</span>
        {props.snapshot.detached === true && (
          <span
            title={copy.detachedHint}
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground/60"
          >
            {copy.detached}
          </span>
        )}
        <Button
          size="xs"
          variant="ghost"
          disabled={pendingAction !== null}
          onClick={() => runAction("restart", props.snapshot.name)}
        >
          {pendingAction === "restart" ? copy.restarting : copy.restart}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={pendingAction !== null || !alive}
          onClick={() => runAction("stop", props.snapshot.name)}
        >
          {pendingAction === "stop" ? copy.stopping : copy.stop}
        </Button>
      </div>

      {error !== null && (
        <p className="border-border border-b px-3 py-1.5 text-[11px] text-red-500">
          {copy.actionFailed(error)}
        </p>
      )}
      {buffer.droppedBytes > 0 && (
        <p className="border-border border-b px-3 py-1.5 text-[11px] text-foreground/60">
          {copy.droppedBytes(buffer.droppedBytes)}
        </p>
      )}

      <DaemonLogView
        key={props.snapshot.name}
        buffer={buffer}
        label={copy.logsLabel}
        className="min-h-0 flex-1 px-2 py-1"
      />

      <div className="border-border border-t">
        <DaemonConsole snapshot={props.snapshot} onError={setError} />
      </div>
    </div>
  );
}

function OmpLaunchDetail(props: { service: OmpRuntimeService }) {
  const copy = useMessages().chat.services;
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
      ensureNativeApi().ompLaunch.readLogs({ owner, name: props.service.name, lines: 100, cursor: 0 }),
    ])
      .then(([nextDescription, result]) => {
        if (!cancelled) {
          setDescription(nextDescription);
          setLogs(result.content);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeErrorMessage(cause, copy.unknownError));
      });
    return () => void (cancelled = true);
  }, [copy.unknownError, owner, props.service.name]);

  const run = (action: "stop" | "restart") => {
    if (!owner || pendingAction) return;
    setPendingAction(action);
    setError(null);
    const request =
      action === "stop"
        ? ensureNativeApi().ompLaunch.stop({ owner, name: props.service.name, timeoutSeconds: 5 })
        : ensureNativeApi().ompLaunch.restart({ owner, name: props.service.name });
    void request
      .catch((cause: unknown) => setError(describeErrorMessage(cause, copy.unknownError)))
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
      .catch((cause: unknown) => setError(describeErrorMessage(cause, copy.unknownError)))
      .finally(() => setPendingAction(null));
  };

  return (
    <div className="flex min-h-0 flex-col border-border border-t">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-medium text-xs">{props.service.name}</span>
        <Button size="xs" variant="ghost" disabled={!owner || pendingAction !== null} onClick={() => run("restart")}>
          {pendingAction === "restart" ? copy.restarting : copy.restart}
        </Button>
        <Button size="xs" variant="ghost" disabled={!owner || pendingAction !== null || !isOmpServiceAlive(props.service)} onClick={() => run("stop")}>
          {pendingAction === "stop" ? copy.stopping : copy.stop}
        </Button>
      </div>
      {description ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-border border-t px-3 py-2 text-[11px]">
          <dt className="text-foreground/60">{copy.ompCommand}</dt>
          <dd className="min-w-0 truncate font-mono" title={description.command}>{description.command}</dd>
          <dt className="text-foreground/60">{copy.ompCwd}</dt>
          <dd className="min-w-0 truncate font-mono" title={description.cwd}>{description.cwd}</dd>
          <dt className="text-foreground/60">{copy.ompRestartPolicy}</dt>
          <dd>{description.restart}</dd>
        </dl>
      ) : null}
      {error ? <p className="px-3 py-1.5 text-[11px] text-red-500">{copy.actionFailed(error)}</p> : null}
      <pre className="max-h-36 overflow-auto whitespace-pre-wrap border-border border-t px-3 py-2 font-mono text-[11px] text-foreground/80">
        {logs ?? copy.ompLogsLoading}
      </pre>
      <form onSubmit={submit} className="flex items-center gap-2 border-border border-t px-3 py-2">
        <Input
          value={text}
          variant="soft"
          size="sm"
          aria-label={copy.inputLabel}
          placeholder={copy.inputPlaceholder}
          onChange={(event) => setText(event.target.value)}
          className="flex-1 font-mono"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!owner || !text || pendingAction !== null}>
          {copy.send}
        </Button>
      </form>
    </div>
  );
}

function OmpLaunchServices(props: { services: readonly OmpRuntimeService[] }) {
  const copy = useMessages().chat.services;
  const [selectedId, setSelectedId] = useState<string | null>(props.services[0]?.serviceId ?? null);
  const selected = props.services.find((service) => service.serviceId === selectedId) ?? props.services[0] ?? null;

  return (
    <section className="shrink-0 border-border border-b">
      <div className="px-3 py-2">
        <div className="font-medium text-xs text-foreground">{copy.ompAuthority}</div>
        <div className="text-[11px] text-foreground/60">{copy.ompScoped}</div>
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
              service.serviceId === selected?.serviceId && "bg-[var(--color-background-elevated-secondary)]",
            )}
          >
            <span aria-hidden className={cn("size-2 rounded-full", TONE_DOT_CLASS[ompServiceTone(service)])} />
            <span className="min-w-0 flex-1 truncate text-xs">{service.name}</span>
            <span className="text-[11px] text-foreground/60">{copy.states[service.state]}</span>
          </button>
        ))}
      </div>
      {selected ? <OmpLaunchDetail service={selected} /> : null}
    </section>
  );
}

export function ServicesPanel() {
  const copy = useMessages().chat.services;
  useDaemonFeed();
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

  if (!hydrated) return <PanelStateMessage>{copy.loading}</PanelStateMessage>;
  if (daemons.length === 0 && ompServices.length === 0) {
    return (
      <PanelStateMessage>
        <span className="flex flex-col gap-1">
          <span>{copy.empty}</span>
          <span className="text-[11px] text-foreground/60">{copy.emptyHint}</span>
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

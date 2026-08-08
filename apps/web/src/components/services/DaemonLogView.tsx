// FILE: DaemonLogView.tsx
// Purpose: Read-only xterm view over one daemon's retained scrollback.
// Layer: Background services UI
// Depends on: daemonLogBuffer (what to write), terminalRuntimeAppearance (how it looks).
//
// Deliberately NOT built on `terminalRuntime.ts`. That module owns a live PTY session:
// open/write/resize RPCs, renderer ACK accounting, session restore, link resolution. A
// daemon log is a byte stream we already hold client-side and never type into through
// xterm — wiring it through there would mean a synthetic session with half the machinery
// disabled. What must be shared is how a terminal *looks*, and that comes from
// `terminalRuntimeAppearance`, so this view is indistinguishable from the real thing.

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

import {
  resolveDaemonLogWritePlan,
  type DaemonLogBuffer,
  type DaemonLogRenderMark,
} from "~/daemonLogBuffer";
import {
  getTerminalBoldFontWeight,
  getTerminalFontFamily,
  getTerminalFontSizePx,
  getTerminalFontWeight,
  terminalThemeFromApp,
} from "../terminal/terminalRuntimeAppearance";

export interface DaemonLogViewProps {
  readonly buffer: DaemonLogBuffer;
  readonly label: string;
  readonly className?: string;
}

export function DaemonLogView({ buffer, label, className }: DaemonLogViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const renderedRef = useRef<DaemonLogRenderMark | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const terminal = new Terminal({
      convertEol: true,
      // No cursor and no input: this view never owns a stdin channel. The command box
      // below it writes through the daemon RPC instead.
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "bar",
      fontFamily: getTerminalFontFamily(),
      fontSize: getTerminalFontSizePx(),
      fontWeight: getTerminalFontWeight(),
      fontWeightBold: getTerminalBoldFontWeight(),
      theme: terminalThemeFromApp(),
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();

    terminalRef.current = terminal;
    fitRef.current = fit;
    // A remount starts from a blank terminal, so whatever was written before is gone.
    renderedRef.current = null;

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // A pane collapsed to zero height makes fit throw; the next resize recovers.
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      renderedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal === null) return;

    const plan = resolveDaemonLogWritePlan(renderedRef.current, buffer);
    // `reset`, not `clear`: xterm's clear keeps the last line and only drops scrollback,
    // which would leave a stale tail above a full rewrite.
    if (plan.clear) terminal.reset();
    if (plan.append.length > 0) terminal.write(plan.append);
    renderedRef.current = plan.mark;

    if (plan.clear || plan.append.length > 0) terminal.scrollToBottom();
  }, [buffer]);

  return <div ref={containerRef} className={className} role="log" aria-label={label} />;
}

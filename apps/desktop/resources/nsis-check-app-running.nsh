; FILE: nsis-check-app-running.nsh
; Purpose: Replaces electron-builder's default "is the app still running?" NSIS check with one
;          that can actually close a Synara installation instead of dead-ending the installer.
; Layer: Windows installer (NSIS) customization
; Exports: customCheckAppRunning (consumed by app-builder-lib's CHECK_APP_RUNNING macro)
;
; Why this override exists (app-builder-lib 26.15.3, templates/nsis/include/allowOnlyOneInstallerInstance.nsh):
;   The default check kills with a graceful `taskkill /IM` first and only escalates to `/F` once,
;   then gives up after two rounds with "<app> cannot be closed. Please close it manually".
;   Synara never has a single, windowed process:
;     - the backend is spawned from process.execPath with ELECTRON_RUN_AS_NODE (apps/desktop/src/main.ts),
;       so it is a windowless `Synara.exe` that cannot receive WM_CLOSE,
;     - Chromium GPU/utility/renderer/crashpad helpers are windowless `Synara.exe` too,
;     - the desktop process supervises the backend and respawns it when it exits unexpectedly,
;       so a kill sweep that reaches the backend before the parent loses the race.
;   Result: the default check reliably reports "cannot be closed" for processes the user cannot see,
;   and in silent runs (electron-updater) it aborts the install without any explanation.
;
; This version: ask the app to quit itself, wait for its real shutdown budget, then force-kill the
; process tree with a proper retry budget, and only then fall back to the manual prompt.

!include "getProcessInfo.nsh"

; The app's own shutdown budget is BACKEND_SHUTDOWN_TIMEOUT_MS (10s) plus the SIGKILL escalation
; delay in apps/desktop/src/main.ts. A shorter wait force-kills a perfectly healthy shutdown and
; costs the database its clean checkpoint.
!define SYNARA_GRACEFUL_CLOSE_ATTEMPTS 15
; A forced kill only needs a second attempt when the supervisor respawned the backend between the
; process snapshot and the kill; five bounded rounds cover that without hanging the installer.
!define SYNARA_FORCE_KILL_ATTEMPTS 5
; No nsExec call may block forever: a wedged process query or kill would otherwise hang the
; installer with no UI at all, which is worse than the failure this file exists to fix. Measured
; cost of these commands is ~0.5s, so these ceilings only ever trip on a broken host.
!define SYNARA_PROCESS_QUERY_TIMEOUT_MS 10000
!define SYNARA_PROCESS_KILL_TIMEOUT_MS 15000

Var synaraInstallerPid
Var synaraProcessName
; 0 = at least one app process is alive (findstr exit code). A "timeout" reading is treated as
; "not running" so a wedged host cannot deadlock the install; a still-locked file then surfaces as
; a normal extraction error instead of an installer that never returns.
Var synaraAppFound
Var synaraCloseRequested
Var synaraWaitAttempts

!macro synaraFindAppProcess
  !ifdef INSTALL_MODE_PER_ALL_USERS
    nsExec::Exec /TIMEOUT=${SYNARA_PROCESS_QUERY_TIMEOUT_MS} `"$CmdPath" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  !else
    nsExec::Exec /TIMEOUT=${SYNARA_PROCESS_QUERY_TIMEOUT_MS} `"$CmdPath" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  !endif
  Pop $synaraAppFound
!macroend

; WM_CLOSE to every window of the app: the desktop process then quits on its own terms, which stops
; backend supervision (no respawn) and shuts the backend down cleanly.
!macro synaraRequestAppClose
  !ifdef INSTALL_MODE_PER_ALL_USERS
    nsExec::Exec /TIMEOUT=${SYNARA_PROCESS_KILL_TIMEOUT_MS} `"$CmdPath" /C taskkill /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $synaraInstallerPid"`
  !else
    nsExec::Exec /TIMEOUT=${SYNARA_PROCESS_KILL_TIMEOUT_MS} `"$CmdPath" /C taskkill /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $synaraInstallerPid" /FI "USERNAME eq %USERNAME%"`
  !endif
!macroend

; Deliberately no /T. Everything the app runs itself — the ELECTRON_RUN_AS_NODE backend and the
; Chromium GPU/utility/renderer/crashpad helpers — is named ${APP_EXECUTABLE_FILENAME} and is
; matched here, but bundled grandchildren are not: node-pty's conpty/winpty agents and provider
; CLIs under app.asar.unpacked keep their own names and can hold files in $INSTDIR. They are left
; to exit on their own when the backend's pipes close, because `taskkill /F /T` combined with /FI
; filters wedges indefinitely (measured on Windows 11 26200: 8s+ with the target still alive versus
; 0.5s for the same command without /T). A residual lock then fails one file extraction with a
; normal installer error, which is recoverable; a hung installer with no UI is not.
!macro synaraForceKillApp
  !ifdef INSTALL_MODE_PER_ALL_USERS
    nsExec::Exec /TIMEOUT=${SYNARA_PROCESS_KILL_TIMEOUT_MS} `"$CmdPath" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $synaraInstallerPid"`
  !else
    nsExec::Exec /TIMEOUT=${SYNARA_PROCESS_KILL_TIMEOUT_MS} `"$CmdPath" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $synaraInstallerPid" /FI "USERNAME eq %USERNAME%"`
  !endif
!macroend

!macro customCheckAppRunning
  ${GetProcessInfo} 0 $synaraInstallerPid $R1 $R2 $synaraProcessName $R4
  ${if} $synaraProcessName == "${APP_EXECUTABLE_FILENAME}"
    ; This process *is* the app executable (portable build): nothing to close.
    Goto synaraAppRunningDone
  ${endif}

  StrCpy $synaraCloseRequested 0
  ${if} ${isUpdated}
    ; The app already quit itself to hand over to this installer, so anything still alive is a
    ; leftover child that will never answer WM_CLOSE. Skip straight to the forced tree kill.
    StrCpy $synaraCloseRequested 1
  ${endif}

  synaraAppRunningCheck:
    !insertmacro synaraFindAppProcess
    ${if} $synaraAppFound != 0
      Goto synaraAppRunningDone
    ${endif}

    ${if} $synaraCloseRequested == 0
      StrCpy $synaraCloseRequested 1
      ; Consent parity with the default check: an interactive install asks before closing a running
      ; app, while silent and auto-update runs default to OK so unattended installs still proceed.
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK synaraCloseApproved
      Quit
      synaraCloseApproved:
      DetailPrint "$(appClosing)"
      !insertmacro synaraRequestAppClose
      StrCpy $synaraWaitAttempts 0
      synaraGracefulWait:
        Sleep 1000
        !insertmacro synaraFindAppProcess
        ${if} $synaraAppFound != 0
          Goto synaraAppRunningDone
        ${endif}
        IntOp $synaraWaitAttempts $synaraWaitAttempts + 1
        ${if} $synaraWaitAttempts < ${SYNARA_GRACEFUL_CLOSE_ATTEMPTS}
          Goto synaraGracefulWait
        ${endif}
    ${endif}

    StrCpy $synaraWaitAttempts 0
    synaraForceKillLoop:
      !insertmacro synaraForceKillApp
      Sleep 1000
      !insertmacro synaraFindAppProcess
      ${if} $synaraAppFound != 0
        Goto synaraAppRunningDone
      ${endif}
      IntOp $synaraWaitAttempts $synaraWaitAttempts + 1
      ${if} $synaraWaitAttempts < ${SYNARA_FORCE_KILL_ATTEMPTS}
        DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
        Goto synaraForceKillLoop
      ${endif}

    ; A forced kill could not clear it, so the surviving process is out of this installer's reach
    ; (typically an elevated instance). Only the user can close it now. Silent runs cannot prompt:
    ; they cancel and leave the installed version intact, and the app's install watchdog surfaces
    ; the manual-download fallback.
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY synaraAppRunningCheck
    Quit

  synaraAppRunningDone:
!macroend

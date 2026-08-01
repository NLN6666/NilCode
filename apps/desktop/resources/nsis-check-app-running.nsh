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
; The external-lock probe opens every already-installed file once. Measured at ~1s for a 345-file
; install plus PowerShell startup; the ceiling only trips on a wedged host, where the probe is
; skipped and the install proceeds exactly as it did before this check existed.
!define SYNARA_LOCK_PROBE_TIMEOUT_MS 20000

Var synaraInstallerPid
Var synaraProcessName
; 0 = at least one app process is alive (findstr exit code). A "timeout" reading is treated as
; "not running" so a wedged host cannot deadlock the install; a still-locked file then surfaces as
; a normal extraction error instead of an installer that never returns.
Var synaraAppFound
Var synaraCloseRequested
Var synaraWaitAttempts
; Full path of the first already-installed file that some *other* process holds open, or "" when
; nothing external is blocking the install.
Var synaraLockedFile

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

; Closing every Synara process is not enough to make an update succeed. When ${isUpdated} the
; uninstaller does not delete files one by one — it renames the whole install directory aside
; (app-builder-lib 26.15.3, templates/nsis/uninstaller.nsh -> un.atomicRMDir), and a rename needs
; FILE_SHARE_DELETE from *every* process holding a handle in there. Any unrelated program that
; opened a file under $INSTDIR without sharing delete (an editor, an indexer, a backup agent) makes
; that rename fail, the uninstaller aborts, and installUtil.nsh retries five times before showing
; "$(appCannotBeClosed)" — an instruction to close Synara, which by then is not even running.
;
; Probe for exactly that condition so the installer can name the file that is actually stuck.
; Opening with FileShare.Delete requested is the cheapest faithful test: it fails for precisely the
; handles that would break the rename, and unlike a write test it does not modify anything.
; Any failure to run the probe leaves $synaraLockedFile empty, which restores the previous behavior.
!macro synaraFindExternalLock
  StrCpy $synaraLockedFile ""
  ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ; $$ escapes a literal PowerShell sigil; a bare $PSItem would read as an unknown NSIS variable.
    nsExec::ExecToStack /TIMEOUT=${SYNARA_LOCK_PROBE_TIMEOUT_MS} `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '$INSTDIR' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { try { [IO.File]::Open($$PSItem.FullName,'Open','ReadWrite','Delete').Close(); $$false } catch { $$true } } | Select-Object -First 1 -ExpandProperty FullName | ForEach-Object { [Console]::Out.Write($$PSItem) }"`
    Pop $R0
    Pop $R1
    ; A missing PowerShell, a blocked script policy or a timeout all report a non-zero status here.
    ; Treat every one of them as "nothing external is locked" so the probe can only ever add
    ; information, never block an install that would otherwise have worked.
    ${if} $R0 == 0
      StrCpy $synaraLockedFile $R1
    ${endif}
  ${endif}
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
      Goto synaraAppProcessesCleared
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
          Goto synaraAppProcessesCleared
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
        Goto synaraAppProcessesCleared
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

  ; No Synara process is left, but that does not mean the install can proceed: a handle held by an
  ; unrelated program still blocks the directory rename the uninstaller is about to attempt.
  synaraAppProcessesCleared:
    ; Silent runs (electron-updater) have nobody to answer a prompt. Skip the probe entirely so an
    ; unattended update keeps its existing timing and failure path.
    ${if} ${Silent}
      Goto synaraAppRunningDone
    ${endif}

  synaraExternalLockCheck:
    !insertmacro synaraFindExternalLock
    ${if} $synaraLockedFile != ""
      ; Deliberately not "$(appCannotBeClosed)": that string tells the user to close Synara, which
      ; is already gone. Name the file and the tool that identifies its owner instead, because the
      ; installer cannot close a handle that belongs to a process it does not own.
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Setup cannot update ${PRODUCT_NAME} because another program is holding an installed file open:$\n$\n$synaraLockedFile$\n$\n${PRODUCT_NAME} is not running, so closing it will not help.$\n$\nTo find the program: open Resource Monitor (resmon.exe), go to the CPU tab, expand Associated Handles and search for the file name. Close that program, then click Retry." /SD IDCANCEL IDRETRY synaraExternalLockCheck
      Quit
    ${endif}

  synaraAppRunningDone:
!macroend

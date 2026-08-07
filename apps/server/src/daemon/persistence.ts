// FILE: persistence.ts
// Purpose: Record what a detached daemon is, so the next server boot can find it again.
// Layer: Daemon infrastructure
// Depends on: node:fs/promises, daemon contracts, process identity.
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md.
//
// A detached daemon outlives the server, so after a restart the only thing linking
// Synara to a running Minecraft server is this file. It holds the process *identity*
// rather than just a pid: operating systems recycle pids, and adopting a recycled one
// would eventually have Synara kill an unrelated process.

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { DaemonSpec } from "@synara/contracts";
import { Schema } from "effect";

import type { ProcessIdentity } from "./processIdentity.ts";

export const DAEMON_METADATA_FILE = "daemon.json";
export const DAEMONS_DIRECTORY = "daemons";

const PersistedProcessIdentity = Schema.Struct({
  pid: Schema.Int,
  startedAt: Schema.NullOr(Schema.String),
  commandLine: Schema.String,
});

export const PersistedDaemon = Schema.Struct({
  spec: DaemonSpec,
  id: Schema.String,
  identity: PersistedProcessIdentity,
  createdAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  /** Bytes of log already accounted for, so a reclaim resumes instead of replaying. */
  outputOffset: Schema.Int,
});
export type PersistedDaemon = typeof PersistedDaemon.Type;

const decodePersisted = Schema.decodeUnknownSync(PersistedDaemon);

export function daemonDirectory(rootDir: string, name: string): string {
  return path.join(rootDir, DAEMONS_DIRECTORY, name);
}

/**
 * Write the record atomically.
 *
 * A half-written `daemon.json` is worse than none: reclaim would either skip a live
 * daemon or adopt a pid with no identity to check it against. Writing to a sibling and
 * renaming makes the file appear whole or not at all.
 */
export async function writeDaemonMetadata(dir: string, record: PersistedDaemon): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, DAEMON_METADATA_FILE);
  const staging = `${target}.tmp`;
  await writeFile(staging, JSON.stringify(record), "utf8");
  await rename(staging, target);
}

/** Read one record, or null when it is missing or unusable. */
export async function readDaemonMetadata(dir: string): Promise<PersistedDaemon | null> {
  try {
    const raw = await readFile(path.join(dir, DAEMON_METADATA_FILE), "utf8");
    return decodePersisted(JSON.parse(raw));
  } catch {
    // Corrupt or stale metadata is dropped rather than failing the whole reclaim:
    // one unreadable daemon must not cost the agent every other one.
    return null;
  }
}

export async function removeDaemonMetadata(dir: string): Promise<void> {
  await rm(path.join(dir, DAEMON_METADATA_FILE), { force: true });
}

export interface DiscoveredDaemon {
  readonly dir: string;
  readonly record: PersistedDaemon;
}

/** Every persisted daemon under a root, skipping directories without usable metadata. */
export async function listPersistedDaemons(rootDir: string): Promise<DiscoveredDaemon[]> {
  const base = path.join(rootDir, DAEMONS_DIRECTORY);
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }

  const discovered: DiscoveredDaemon[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    const record = await readDaemonMetadata(dir);
    if (record !== null) discovered.push({ dir, record });
  }
  return discovered;
}

export function toPersistedIdentity(identity: ProcessIdentity): PersistedDaemon["identity"] {
  return { pid: identity.pid, startedAt: identity.startedAt, commandLine: identity.commandLine };
}

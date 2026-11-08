import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";

import { discoverAgentCatalog } from "../agentCatalog.ts";
import {
  buildOmpProcessEnv,
  resolveOmpAgentDir,
  type OmpAcpRuntimeSettings,
  type OmpAccountBoundary,
} from "../acp/OmpAcpSupport.ts";

/** Scan only OMP task-agent files, with the same nearest-project rule as OMP. */
export async function discoverOmpAgentCatalog(
  settings: Pick<OmpAcpRuntimeSettings, "agentDir"> & OmpAccountBoundary,
  cwd?: string,
) {
  const env = buildOmpProcessEnv(settings);
  const homeDir = env.HOME?.trim() || env.USERPROFILE?.trim() || settings.homeDir || homedir();
  const rawProfile = (env.OMP_PROFILE ?? env.PI_PROFILE)?.trim();
  const profile = rawProfile && rawProfile !== "default" ? rawProfile : undefined;
  // Native task discovery uses getConfigAgentDirName(), not getAgentDir(). In
  // particular, PI_CODING_AGENT_DIR alone does not relocate task definitions.
  const configRoot = join(homeDir, env.PI_CONFIG_DIR?.trim() || ".omp");
  const configDir = profile
    ? join(configRoot, "profiles", profile, "agent")
    : join(configRoot, "agent");
  const agents = await discoverAgentCatalog({
    provider: "omp",
    homeDir,
    configDir,
    ...(cwd ? { cwd } : {}),
  });

  // User task.disabledAgents narrows the native task tool's available names.
  const disabled = new Set<string>();
  const settingsDir = profile ? configDir : resolveOmpAgentDir(settings);
  for (const extension of ["yml", "yaml"]) {
    const content = await readFile(join(settingsDir, `config.${extension}`), "utf8").catch(
      (cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT" || cause.code === "ENOTDIR") return undefined;
        throw cause;
      },
    );
    if (content === undefined) continue;
    const config: unknown = YAML.parse(content);
    if (config && typeof config === "object" && "task" in config) {
      const task = config.task;
      if (
        task &&
        typeof task === "object" &&
        "disabledAgents" in task &&
        Array.isArray(task.disabledAgents)
      ) {
        for (const name of task.disabledAgents) {
          if (typeof name === "string") disabled.add(name);
        }
      }
    }
    break;
  }
  return agents.filter((agent) => !disabled.has(agent.name));
}

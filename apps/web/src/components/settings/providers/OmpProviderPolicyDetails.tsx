import type { ServerProviderStatus } from "@synara/contracts";
import { useTranslation } from "~/i18n";
import { projectOmpProviderPolicy, type OmpPolicyFeatureId } from "~/lib/ompProviderPolicy";
import { cn } from "~/lib/utils";
import { SETTINGS_OUTLINED_SURFACE_CLASS_NAME } from "~/settingsPanelStyles";

function formatOmpRuntimeDetail(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function OmpProviderPolicyDetails(props: {
  readonly status: ServerProviderStatus | undefined;
}) {
  const { t } = useTranslation();
  const projection = projectOmpProviderPolicy(props.status);
  if (!projection) return null;
  const featureLabels: Record<OmpPolicyFeatureId, string> = {
    launch: t("settings:ompPolicy_launch"),
    advisor: t("settings:ompPolicy_advisor"),
    memory: t("settings:ompPolicy_memory"),
    autoLearn: t("settings:ompPolicy_autoLearn"),
  };
  const runtime = projection.runtime;

  return (
    <div className={cn(SETTINGS_OUTLINED_SURFACE_CLASS_NAME, "space-y-3 p-3 text-ui-sm")}>
      <div className="font-medium text-foreground">{t("settings:ompPolicy_title")}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {projection.features.map((feature) => {
          const value =
            feature.id === "advisor" && projection.advisorState === "degraded"
              ? t("settings:ompPolicy_degraded")
              : feature.id === "memory"
                ? projection.memoryBackend
                : feature.id === "autoLearn"
                  ? t("settings:ompPolicy_autoLearnDetail")
                  : t("settings:ompPolicy_enabled");
          return (
            <div key={feature.id} className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">{featureLabels[feature.id]}</span>
              <span className="text-right text-foreground">
                {value} · {t("settings:ompPolicy_owner")}
              </span>
            </div>
          );
        })}
      </div>
      <div className="space-y-1 text-muted-foreground">
        <div>{t("settings:ompPolicy_sharedHome")}</div>
        <div>
          {t("settings:ompPolicy_memoryEffective")}:{" "}
          <span className="text-foreground">{projection.memoryBackend}</span> ·{" "}
          {t(
            projection.memorySource === "user-config"
              ? "settings:ompPolicy_memoryUser"
              : "settings:ompPolicy_memoryFallback",
          )}
        </div>
        {projection.advisorModelRole ? (
          <div>
            {t("settings:ompPolicy_advisorRole")}:{" "}
            <code className="text-foreground">{projection.advisorModelRole}</code>
          </div>
        ) : null}
        <div>{t("settings:ompPolicy_autoLearnCost")}</div>
        <div>
          {t("settings:ompPolicy_overlay")}:{" "}
          <code className="break-all text-foreground">{projection.overlayPath}</code>
        </div>
      </div>
      {projection.advisorWarning ? (
        <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-amber-950 dark:text-amber-100">
          {projection.advisorWarning}
        </div>
      ) : null}
      {runtime?.mode === "typed" ? (
        <div className="space-y-1.5 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-2 text-muted-foreground">
          <div className="font-medium text-foreground">{t("settings:ompPolicy_typedLive")}</div>
          <div>
            {t("settings:ompPolicy_runtimeVersion")}:{" "}
            <span className="text-foreground">{runtime.ompVersion ?? "—"}</span>
            {" · "}
            {t("settings:ompPolicy_runtimeSessions")}:{" "}
            <span className="text-foreground">{runtime.sessionCount}</span>
          </div>
          {runtime.advisor ? (
            <div>
              {t("settings:ompPolicy_advisorLive")}:{" "}
              <span className="text-foreground">
                {t(
                  runtime.advisor.active ? "settings:ompPolicy_active" : "settings:ompPolicy_idle",
                )}
              </span>
              {" · "}
              {t("settings:ompPolicy_advisorRisk")}:{" "}
              <span className="text-foreground">
                {t(
                  runtime.advisor.toolRisk === "read-only"
                    ? "settings:ompPolicy_readOnlyRisk"
                    : "settings:ompPolicy_writeOrExecRisk",
                )}
              </span>
              {runtime.advisor.inFlight ? ` · ${t("settings:ompPolicy_inFlight")}` : ""}
              {runtime.advisor.drain
                ? ` · ${t("settings:ompPolicy_drain", {
                    value0: t(
                      runtime.advisor.drain.settled
                        ? "settings:ompPolicy_settled"
                        : "settings:ompPolicy_degraded",
                    ),
                  })}${runtime.advisor.drain.error ? `: ${runtime.advisor.drain.error}` : ""}`
                : ""}
            </div>
          ) : null}
          {runtime.autolearn ? (
            <div>
              {t("settings:ompPolicy_autoLearnLive")}:{" "}
              <span className="text-foreground">{runtime.autolearn.state}</span>
              {` · ${t("settings:ompPolicy_generation", {
                value0: runtime.autolearn.captureGeneration,
              })}`}
              {runtime.autolearn.pending ? ` · ${t("settings:ompPolicy_pending")}` : ""}
              {runtime.autolearn.drain
                ? ` · ${t("settings:ompPolicy_drain", {
                    value0: t(
                      runtime.autolearn.drain.settled
                        ? "settings:ompPolicy_settled"
                        : "settings:ompPolicy_degraded",
                    ),
                  })}${runtime.autolearn.drain.cancelled ? ` (${t("settings:ompPolicy_cancelled")})` : ""}${runtime.autolearn.drain.error ? `: ${runtime.autolearn.drain.error}` : ""}`
                : ""}
              {runtime.autolearn.lastFailure ? ` · ${runtime.autolearn.lastFailure}` : ""}
            </div>
          ) : null}
          {runtime.memory ? (
            <div>
              {t("settings:ompPolicy_memoryLive")}:{" "}
              <span className="text-foreground">{runtime.memory.backend}</span>
              {runtime.memory.scope ? ` · ${runtime.memory.scope}` : ""}
              {formatOmpRuntimeDetail(runtime.memory.queue)
                ? ` · ${t("settings:ompPolicy_queue", {
                    value0: formatOmpRuntimeDetail(runtime.memory.queue),
                  })}`
                : ""}
              {runtime.memory.error ? ` · ${runtime.memory.error}` : ""}
            </div>
          ) : null}
          {runtime.launch ? (
            <div>
              {t("settings:ompPolicy_launchLive")}: <span className="text-foreground">OMP</span>
              {` · ${t("settings:ompPolicy_serviceCount", {
                count: runtime.launch.services.length,
              })}`}
            </div>
          ) : null}
        </div>
      ) : runtime?.degradedReason ? (
        <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-amber-950 dark:text-amber-100">
          {t("settings:ompPolicy_typedFallback")}: {runtime.degradedReason}
        </div>
      ) : null}
      {projection.typedObservabilityPending ? (
        <div className="text-muted-foreground">{t("settings:ompPolicy_typedBoundary")}</div>
      ) : null}
    </div>
  );
}

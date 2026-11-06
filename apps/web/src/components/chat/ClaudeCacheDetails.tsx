import type { ClaudeCacheObservation } from "@synara/contracts";
import { assessClaudeCache } from "@synara/shared/claudeCache";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { useTranslation } from "~/i18n";

type ChatTranslator = ReturnType<typeof useTranslation>["t"];

export function ClaudeCacheDetails({
  observation,
  nowMs,
}: {
  observation: ClaudeCacheObservation | undefined;
  nowMs: number;
}) {
  const { t } = useTranslation();

  const assessment = assessClaudeCache(observation, nowMs);
  const label =
    assessment.state === "likely-warm"
      ? t("chat:likelyWarm")
      : assessment.state === "likely-expired"
        ? t("chat:likelyExpired")
        : t("common:common_unknown");
  const usage = observation?.lastRequest;

  return (
    <div className="space-y-1.5 border-t border-border/50 pt-2 text-ui leading-snug text-muted-foreground">
      <div className="font-medium text-foreground">
        {t("chat:claudePromptCache")} {label}
      </div>
      {observation?.ttlSeconds !== undefined ? (
        <div>
          {t("chat:observedLifetime")}{" "}
          {observation.partialTtlSeconds !== undefined
            ? t("chat:to2", {
                value0: formatCacheDuration(observation.partialTtlSeconds, t),
              })
            : ""}
          {formatCacheDuration(observation.ttlSeconds, t)}
        </div>
      ) : (
        <div>{t("chat:cacheLifetimeIsUnavailable")}</div>
      )}
      {assessment.idleSeconds !== undefined ? (
        <div>
          {t("chat:lastResponseAgo", {
            duration: formatCacheDuration(assessment.idleSeconds, t),
          })}
        </div>
      ) : null}
      {assessment.state === "likely-expired" && observation?.contextTokens !== undefined ? (
        <p className="max-w-72 leading-relaxed">
          {t("chat:theNextRequestMayReprocessAbout")}{" "}
          {formatContextWindowTokens(observation.contextTokens)} {t("chat:tokens2")}
        </p>
      ) : null}
      {usage ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>{t("chat:lastRequestCacheRead")}</dt>
          <dd className="text-right tabular-nums">
            {formatCacheTokens(usage.cacheReadInputTokens, t)}
          </dd>
          <dt>{t("chat:cacheWritten")}</dt>
          <dd className="text-right tabular-nums">
            {formatCacheTokens(usage.cacheCreationInputTokens, t)}
          </dd>
          <dt>{t("chat:inputOutsideCache")}</dt>
          <dd className="text-right tabular-nums">{formatCacheTokens(usage.inputTokens, t)}</dd>
        </dl>
      ) : null}
      <p className="max-w-72 leading-relaxed">
        {t("chat:cacheStateIsEstimatedItDoesNotMeasureYour")}
      </p>
    </div>
  );
}

function formatCacheTokens(value: number | undefined, translate: ChatTranslator): string {
  return value === undefined
    ? translate("chat:providerModelPicker_unavailable")
    : translate("chat:tokens3", { count: formatContextWindowTokens(value) });
}

export function formatCacheDuration(seconds: number, translate: ChatTranslator): string {
  if (seconds < 60) return translate("chat:lessThanAMinute");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return translate("chat:cacheDurationMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? translate("chat:cacheDurationHoursMinutes", { count: hours, minutes: remainingMinutes })
    : translate("chat:cacheDurationHours", { count: hours });
}

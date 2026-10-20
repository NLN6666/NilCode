import type { ClaudeCacheObservation } from "@synara/contracts";
import { assessClaudeCache } from "@synara/shared/claudeCache";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { useMessages } from "~/i18n/context";
import type { Messages } from "~/i18n/locales/en";

export function ClaudeCacheDetails({
  observation,
  nowMs,
}: {
  observation: ClaudeCacheObservation | undefined;
  nowMs: number;
}) {
  const copy = useMessages().chat.contextWindow.cache;
  const assessment = assessClaudeCache(observation, nowMs);
  const label =
    assessment.state === "likely-warm"
      ? copy.warm
      : assessment.state === "likely-expired"
        ? copy.expired
        : copy.unknown;
  const usage = observation?.lastRequest;

  return (
    <div className="space-y-1.5 border-t border-border/50 pt-2 text-ui leading-snug text-muted-foreground">
      <div className="font-medium text-foreground">{copy.state(label)}</div>
      {observation?.ttlSeconds !== undefined ? (
        <div>
          {copy.observedLifetime(
            observation.partialTtlSeconds !== undefined
              ? copy.lifetimeRange(
                  formatCacheDuration(observation.partialTtlSeconds, copy),
                  formatCacheDuration(observation.ttlSeconds, copy),
                )
              : formatCacheDuration(observation.ttlSeconds, copy),
          )}
        </div>
      ) : (
        <div>{copy.lifetimeUnknown}</div>
      )}
      {assessment.idleSeconds !== undefined ? (
        <div>{copy.lastResponse(formatCacheDuration(assessment.idleSeconds, copy))}</div>
      ) : null}
      {assessment.state === "likely-expired" && observation?.contextTokens !== undefined ? (
        <p className="max-w-72 leading-relaxed">
          {copy.reprocessEstimate(formatContextWindowTokens(observation.contextTokens))}
        </p>
      ) : null}
      {usage ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>{copy.lastRequestCacheRead}</dt>
          <dd className="text-right tabular-nums">
            {formatCacheTokens(usage.cacheReadInputTokens, copy)}
          </dd>
          <dt>{copy.cacheWritten}</dt>
          <dd className="text-right tabular-nums">
            {formatCacheTokens(usage.cacheCreationInputTokens, copy)}
          </dd>
          <dt>{copy.uncachedInput}</dt>
          <dd className="text-right tabular-nums">{formatCacheTokens(usage.inputTokens, copy)}</dd>
        </dl>
      ) : null}
      <p className="max-w-72 leading-relaxed">{copy.estimateCaveat}</p>
    </div>
  );
}

type CacheCopy = Messages["chat"]["contextWindow"]["cache"];

function formatCacheTokens(value: number | undefined, copy: CacheCopy): string {
  return value === undefined ? copy.unavailable : copy.tokens(formatContextWindowTokens(value));
}

export function formatCacheDuration(seconds: number, copy: CacheCopy): string {
  if (seconds < 60) return copy.lessThanMinute;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return copy.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${copy.hours(hours)}${remainingMinutes > 0 ? ` ${copy.remainingMinutes(remainingMinutes)}` : ""}`;
}

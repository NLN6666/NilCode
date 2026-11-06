import { afterEach, describe, expect, it } from "vitest";
import { setLanguagePreference } from "~/i18n";

import {
  formatRelativeTime,
  formatRelativeTimeAgo,
  formatSnoozeRemainingTime,
} from "./relativeTime";

const spanishRelativeTime = new Intl.RelativeTimeFormat("es", {
  style: "short",
  numeric: "auto",
});

afterEach(() => setLanguagePreference("system"));

it("formats complete time-ago phrases once in both languages", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  setLanguagePreference("en");
  const englishFiveMinutes = formatRelativeTimeAgo("2026-10-02T11:55:00Z", now);
  const englishNow = formatRelativeTimeAgo("2026-10-02T11:59:30Z", now);
  setLanguagePreference("es");
  const spanishFiveMinutes = formatRelativeTimeAgo("2026-10-02T11:55:00Z", now);
  const spanishNow = formatRelativeTimeAgo("2026-10-02T11:59:30Z", now);
  expect(englishFiveMinutes).toContain("5");
  expect(spanishFiveMinutes).toContain("5");
  expect(englishFiveMinutes).not.toBe(spanishFiveMinutes);
  expect(englishNow).not.toBe(spanishNow);
});

it("localizes relative time and snooze countdowns without changing deadline values", () => {
  setLanguagePreference("en");
  const now = Date.parse("2026-10-02T12:00:00Z");
  const englishRelative = formatRelativeTime("2026-10-02T11:55:00Z", now, "en");
  setLanguagePreference("es");
  const relative = formatRelativeTime("2026-10-02T11:55:00Z", now, "es");
  const spanishCountdown = formatSnoozeRemainingTime("2026-10-02T13:28:00Z", now, "es");
  expect(relative).toContain("5");
  expect(relative).not.toBe(englishRelative);
  expect(spanishCountdown).toContain("1");
  expect(spanishCountdown).toContain("28");
});

describe("formatRelativeTime", () => {
  it('returns "now" for timestamps less than 1 minute ago', () => {
    setLanguagePreference("es");
    const now = Date.parse("2026-10-02T12:00:00Z");
    const thirtySeconds = formatRelativeTime(new Date(now - 30_000).toISOString(), now, "es");
    const underMinute = formatRelativeTime(new Date(now - 59_999).toISOString(), now, "es");
    const atOneMinute = formatRelativeTime(new Date(now - 60_000).toISOString(), now, "es");
    expect(underMinute).toBe(thirtySeconds);
    expect(atOneMinute).toBe(spanishRelativeTime.format(-1, "minute"));
  });

  it("returns minutes for timestamps under an hour", () => {
    setLanguagePreference("es");
    const now = Date.parse("2026-10-02T12:00:00Z");
    const fiftyNineMinutes = formatRelativeTime(
      new Date(now - 59 * 60_000).toISOString(),
      now,
      "es",
    );
    const oneHour = formatRelativeTime(new Date(now - 60 * 60_000).toISOString(), now, "es");
    expect(fiftyNineMinutes).toBe(spanishRelativeTime.format(-59, "minute"));
    expect(oneHour).toBe(spanishRelativeTime.format(-1, "hour"));
  });

  it("returns days for timestamps over a day", () => {
    setLanguagePreference("es");
    const now = Date.parse("2026-10-02T12:00:00Z");
    const oneDay = formatRelativeTime(new Date(now - 24 * 60 * 60_000).toISOString(), now, "es");
    const twoDays = formatRelativeTime(
      new Date(now - 2 * 24 * 60 * 60_000).toISOString(),
      now,
      "es",
    );
    expect(oneDay).toBe(spanishRelativeTime.format(-1, "day"));
    expect(twoDays).toBe(spanishRelativeTime.format(-2, "day"));
    expect(twoDays).not.toBe(oneDay);
  });

  it('returns "now" for future timestamps caused by clock skew', () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    const exactNow = formatRelativeTime(new Date(now).toISOString(), now, "en");
    const future = formatRelativeTime(new Date(now + 60_000).toISOString(), now, "en");
    expect(future).toBe(exactNow);
  });
});

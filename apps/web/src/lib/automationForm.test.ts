// FILE: automationForm.test.ts
// Purpose: Locks down the inline schedule-field validators — the structural cron check and
// the IANA timezone check that gate commit-on-blur edits on the automation detail page.
// Layer: Web lib test

import { describe, expect, it } from "vitest";

import {
  automationCronExpressionError,
  automationTimezoneError,
  formatCadence,
  formatDateTime,
  formatNextRun,
  weekdayLabel,
} from "./automationForm";

describe("automation locale formatting", () => {
  it("updates dates and weekdays without retaining the initial locale", () => {
    const runAt = "2026-10-02T12:28:00Z";
    for (const language of ["en", "es"] as const) {
      expect(formatDateTime(runAt, language, (message) => message)).toBe(
        new Intl.DateTimeFormat(language, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(runAt)),
      );
      expect(weekdayLabel(1, language)).toBe(
        new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" }).format(
          new Date("2026-10-05T00:00:00Z"),
        ),
      );
    }
  });

  it("passes cadence and countdown labels through the caller's translator", () => {
    const calls: Array<{ readonly message: string; readonly values?: Record<string, unknown> }> =
      [];
    const translate = (message: string, values?: Record<string, unknown>) => {
      calls.push({ message, ...(values ? { values } : {}) });
      return message;
    };
    const daily = { type: "daily" as const, timeOfDay: "09:00", timezone: "Europe/Madrid" };

    expect(formatCadence(daily, "es", translate)).toBe("automation:schedule_dailyAt");
    expect(
      formatNextRun("2026-10-02T12:05:00Z", Date.parse("2026-10-02T12:00:00Z"), "es", translate),
    ).toBe("automation:inMinutes");
    expect(calls).toEqual([
      { message: "automation:schedule_dailyAt", values: { time: "9:00" } },
      {
        message: "automation:inMinutes",
        values: { amount: "5", count: 5 },
      },
    ]);
  });
});

describe("automationCronExpressionError", () => {
  const translate = (message: string) => message;

  it("accepts structurally valid 5-field expressions", () => {
    expect(automationCronExpressionError("* * * * *", translate)).toBeNull();
    expect(automationCronExpressionError("*/15 9-17 * * 1-5", translate)).toBeNull();
    expect(automationCronExpressionError("0 0 1,15 * *", translate)).toBeNull();
    expect(automationCronExpressionError("  30 4 * * 0  ", translate)).toBeNull();
  });

  it("rejects the wrong field count", () => {
    expect(automationCronExpressionError("", translate)).toBe(
      "automation:useA5FieldCronExpressionMinuteHourDay",
    );
    expect(automationCronExpressionError("* * * *", translate)).toBe(
      "automation:useA5FieldCronExpressionMinuteHourDay",
    );
    expect(automationCronExpressionError("* * * * * *", translate)).toBe(
      "automation:useA5FieldCronExpressionMinuteHourDay",
    );
  });

  it("rejects fields with characters outside the cron vocabulary", () => {
    expect(automationCronExpressionError("every 5 min * *", translate)).toBe(
      "automation:useA5FieldCronExpressionMinuteHourDay",
    );
    expect(automationCronExpressionError("0 0 * * MON", translate)).toBe(
      "automation:useA5FieldCronExpressionMinuteHourDay",
    );
  });
});

describe("automationTimezoneError", () => {
  const translate = (message: string) => message;

  it("accepts real IANA zones", () => {
    expect(automationTimezoneError("Europe/Rome", translate)).toBeNull();
    expect(automationTimezoneError("UTC", translate)).toBeNull();
    expect(automationTimezoneError("  America/New_York  ", translate)).toBeNull();
  });

  it("rejects an empty value — committing it would unrender the row for good", () => {
    expect(automationTimezoneError("", translate)).toBe("automation:addATimezone");
    expect(automationTimezoneError("   ", translate)).toBe("automation:addATimezone");
  });

  it("rejects unknown zones", () => {
    expect(automationTimezoneError("Europe/Atlantis", translate)).toBe(
      "automation:unknownTimezone",
    );
    expect(automationTimezoneError("not a zone", translate)).toBe("automation:unknownTimezone");
  });
});

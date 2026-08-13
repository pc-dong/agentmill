import { describe, expect, it } from "vitest";
import {
  assertValidCron,
  cronFromIntervalHours,
  estimateIntervalHoursFromCron,
  nextCronRunAt,
} from "./cron.js";

describe("cron helpers", () => {
  it("validates and computes next run", () => {
    expect(assertValidCron("0 9 * * *")).toBe("0 9 * * *");
    expect(() => assertValidCron("not a cron")).toThrow(/invalid cron/);
    const next = nextCronRunAt("0 9 * * *", "2026-08-12T01:00:00.000Z");
    expect(typeof next).toBe("string");
    expect(new Date(next).getTime()).toBeGreaterThan(
      new Date("2026-08-12T01:00:00.000Z").getTime(),
    );
  });

  it("maps interval hours to cron presets", () => {
    expect(cronFromIntervalHours(1)).toBe("0 * * * *");
    expect(cronFromIntervalHours(6)).toBe("0 */6 * * *");
    expect(cronFromIntervalHours(24)).toBe("0 9 * * *");
    expect(cronFromIntervalHours(168)).toBe("0 9 * * 1");
    expect(estimateIntervalHoursFromCron("0 */6 * * *")).toBe(6);
  });
});

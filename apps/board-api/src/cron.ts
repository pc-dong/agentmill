import { CronExpressionParser } from "cron-parser";

/** Standard 5-field cron: minute hour day-of-month month day-of-week (local TZ). */
export function assertValidCron(expr: string): string {
  const cron = expr.trim();
  if (!cron) throw new Error("cron expression required");
  try {
    CronExpressionParser.parse(cron, { currentDate: new Date() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid cron: ${msg}`);
  }
  return cron;
}

export function nextCronRunAt(
  cron: string,
  from: Date | string = new Date(),
): string {
  const currentDate = typeof from === "string" ? new Date(from) : from;
  const expr = CronExpressionParser.parse(assertValidCron(cron), {
    currentDate,
  });
  return expr.next().toDate().toISOString();
}

/** Approximate cron from legacy interval hours (best-effort). */
export function cronFromIntervalHours(hours: number): string {
  const h = Math.max(1, Math.round(hours));
  if (h === 1) return "0 * * * *";
  if (h < 24 && 24 % h === 0) return `0 */${h} * * *`;
  if (h === 24) return "0 9 * * *";
  if (h === 24 * 7) return "0 9 * * 1";
  if (h % 24 === 0) {
    const days = h / 24;
    if (days <= 6) return `0 9 */${days} * *`;
  }
  // Fallback: every N hours when possible, else daily 09:00
  if (h < 24) return `0 */${h} * * *`;
  return "0 9 * * *";
}

export function estimateIntervalHoursFromCron(cron: string): number {
  const c = cron.trim();
  const everyHour = /^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/.exec(c);
  if (everyHour) return Number(everyHour[1]);
  if (/^0\s+\*\s+\*\s+\*\s+\*$/.test(c)) return 1;
  if (/^0\s+\d+\s+\*\s+\*\s+\*$/.test(c)) return 24;
  if (/^0\s+\d+\s+\*\s+\*\s+\d+$/.test(c)) return 24 * 7;
  return 24;
}

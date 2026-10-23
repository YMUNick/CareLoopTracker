// Business-day arithmetic in Abu Dhabi local time (Asia/Dubai, UTC+4, no DST).
// The UAE weekend is Saturday and Sunday. Everything here is pure so it can be
// tested with a fixed clock.

const OFFSET_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day index (days since epoch in UTC+4). */
export function localDayIndex(d: Date): number {
  return Math.floor((d.getTime() + OFFSET_MS) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday, in local time. */
export function localWeekday(d: Date): number {
  return new Date(d.getTime() + OFFSET_MS).getUTCDay();
}

export function isWeekend(d: Date): boolean {
  const w = localWeekday(d);
  return w === 0 || w === 6;
}

/** End of the local day (23:59:59.999 UTC+4) that is `n` business days after `start`. */
export function addBusinessDays(start: Date, n: number): Date {
  let day = localDayIndex(start);
  let added = 0;
  while (added < n) {
    day += 1;
    if (!isWeekend(new Date(day * DAY_MS - OFFSET_MS))) added += 1;
  }
  return new Date((day + 1) * DAY_MS - OFFSET_MS - 1);
}

/** Business days strictly after `from`'s local day up to and including `to`'s local day. */
export function businessDaysBetween(from: Date, to: Date): number {
  const a = localDayIndex(from);
  const b = localDayIndex(to);
  if (b <= a) return 0;
  let n = 0;
  for (let day = a + 1; day <= b; day++) {
    if (!isWeekend(new Date(day * DAY_MS - OFFSET_MS))) n += 1;
  }
  return n;
}

/** A local time-of-day (UTC+4) on the business day `n` business days before `from`. */
export function businessDaysAgo(from: Date, n: number, hour = 9): Date {
  let day = localDayIndex(from);
  let back = 0;
  while (back < n) {
    day -= 1;
    if (!isWeekend(new Date(day * DAY_MS - OFFSET_MS))) back += 1;
  }
  return new Date(day * DAY_MS - OFFSET_MS + hour * 60 * 60 * 1000);
}

export function formatLocal(iso: string): string {
  const d = new Date(new Date(iso).getTime() + OFFSET_MS);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function formatLocalDate(iso: string): string {
  return formatLocal(iso).slice(0, 10);
}

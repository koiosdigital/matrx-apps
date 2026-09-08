/**
 * Civil-date arithmetic, for stepping recurrence rules.
 *
 * Recurrences must advance the CALENDAR date and then be rebuilt at the
 * original wall-clock time in the calendar's own timezone. Stepping by
 * 86400 seconds instead would silently shift a 9am standup to 8am the
 * week the clocks change — the classic recurring-event bug.
 *
 * Days-from-civil / civil-from-days are Howard Hinnant's algorithms, exact
 * for the proleptic Gregorian calendar over any range we care about.
 */

export interface Civil {
  year: number;
  month: number;
  day: number;
}

export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z: number): Civil {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { year: m <= 2 ? y + 1 : y, month: m, day: d };
}

/** 0 = Sunday, matching both RFC 5545's BYDAY order and Time.weekday. */
export function weekdayFromDays(z: number): number {
  return z >= -4 ? (z + 4) % 7 : ((z + 5) % 7) + 6;
}

export function addMonths(c: Civil, n: number): Civil {
  const total = c.year * 12 + (c.month - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  // Clamp: the 31st of a 30-day month lands on the 30th rather than
  // rolling into the next month.
  const last = daysInMonth(year, month);
  return { year, month, day: Math.min(c.day, last) };
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

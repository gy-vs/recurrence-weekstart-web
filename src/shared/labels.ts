// Locale-only helpers. Intl.DateTimeFormat is allowed to change NOTHING but
// rendered strings: column order, week windows and period keys all come from
// the server-provided CalendarConfig via src/shared/rrule.ts.
import type {WeekdayToken} from './rrule';
import {keyToWall, WEEKDAY_TOKENS, type Weekday} from './rrule';

// A date whose MO-based weekday index is known, independent of any calendar.
// MO=0..SU=6 maps to fixed ISO calendar dates 1972-01-03 (Mon)..1972-01-09 (Sun).
const LABEL_EPOCH_MONDAY = Date.UTC(1972, 0, 3);

export type LabelOptions = {locale?: string; zone?: string; hour12?: boolean};

/** Short weekday label for MO=0..SU=6, in display order for the given WKST. */
export function weekdayHeaderOrder(wkst: Weekday): Weekday[] {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => (((d + wkst) % 7) as Weekday));
}
export function weekdayShortLabel(wd: Weekday, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, {weekday: 'short', timeZone: 'UTC'}).format(new Date(LABEL_EPOCH_MONDAY + wd * 86_400_000));
}
export function weekdayLongLabel(token: WeekdayToken, locale = 'en'): string {
  const wd = WEEKDAY_TOKENS.indexOf(token);
  return new Intl.DateTimeFormat(locale, {weekday: 'long', timeZone: 'UTC'}).format(new Date(LABEL_EPOCH_MONDAY + wd * 86_400_000));
}

/** Day-cell label: locale changes the spelling, never the day it attaches to. */
export function dayCellLabel(dayKey: string, locale = 'en'): {day: string; month: string; year: string} {
  const w = keyToWall(dayKey);
  const date = new Date(Date.UTC(w.y, w.m - 1, w.d));
  const fmt = new Intl.DateTimeFormat(locale, {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
  const parts = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {day: parts.day, month: parts.month, year: parts.year};
}

export function monthLabel(dayKey: string, locale = 'en'): string {
  const w = keyToWall(dayKey);
  return new Intl.DateTimeFormat(locale, {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(new Date(Date.UTC(w.y, w.m - 1, w.d)));
}

/** Format an absolute instant in the RULE zone (not the browser zone). */
export function instantInZone(instantIso: string, zone: string, locale: string, hour12?: boolean): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium', timeStyle: 'short', timeZone: zone === 'UTC' ? 'UTC' : zone,
      hour12,
    }).format(new Date(instantIso));
  } catch {
    return instantIso;
  }
}

export function zoneOffsetLabel(zone: string, instantIso: string, locale = 'en'): string {
  try {
    const name = new Intl.DateTimeFormat(locale, {timeZone: zone === 'UTC' ? 'UTC' : zone, timeZoneName: 'longOffset'})
      .formatToParts(new Date(instantIso)).find((p) => p.type === 'timeZoneName')?.value ?? '';
    return name === 'GMT' ? 'UTC' : name.replace(/^GMT/, 'UTC');
  } catch {
    return zone;
  }
}

export const SUPPORTED_LOCALES = ['en', 'zh', 'de', 'ar', 'ja'];

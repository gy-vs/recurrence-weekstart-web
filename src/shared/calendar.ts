// Single source of truth for weekly recurrence math.
// Imported by BOTH the server (preview API) and the client (grid, drag, keyboard).
// The browser locale never reaches any function in this file except the label helpers.

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

// Monday-first canonical order. JS getUTCDay(): SU=0..SA=6.
export const WEEKDAY_ORDER: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export const JS_DOW: Record<Weekday, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
export const DOW_TO_WEEKDAY: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// ISO 8601 day number, 1=Monday..7=Sunday — what the server reports as firstDayOfWeek.
export const ISO_DOW: Record<Weekday, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

export interface Day {
  y: number;
  m: number; // 1-12
  d: number;
}

export interface WallTime {
  h: number;
  mi: number;
}

export interface DtStart extends Day, WallTime {
  tzid: string;
}

export interface RuleDoc {
  dtstart: DtStart;
  interval: number;
  wkst: Weekday;
  byday: Weekday[];
  count?: number;
  until?: string; // UTC instant, e.g. 20260601T000000Z
}

export interface CalendarConfig {
  wkst: Weekday;
  firstDayOfWeek: number; // ISO 1..7
  columns: Weekday[]; // ordered grid columns, wkst first
}

export interface Occurrence {
  index: number;
  weekday: Weekday;
  date: string; // wall date in the rule's zone: YYYY-MM-DD
  wallTime: string; // HH:MM wall clock, unchanged across DST
  tzid: string;
  iso: string; // absolute UTC instant
  weekKey: string; // wkst-aligned week start, YYYY-MM-DD
  periodIndex: number;
  periodKey: string; // interval block start: YYYY-MM-DD#interval
}

// ---------- pure day math (wall dates, no timezone/locale involvement) ----------

export function dayUtc(day: Day): number {
  return Date.UTC(day.y, day.m - 1, day.d);
}

export function fromUtcDay(ms: number): Day {
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

export function addDays(day: Day, n: number): Day {
  return fromUtcDay(dayUtc(day) + n * 86400000);
}

export function diffDays(a: Day, b: Day): number {
  return Math.round((dayUtc(a) - dayUtc(b)) / 86400000);
}

export function minDay(a: Day, b: Day): Day {
  return dayUtc(a) <= dayUtc(b) ? a : b;
}

export function maxDay(a: Day, b: Day): Day {
  return dayUtc(a) >= dayUtc(b) ? a : b;
}

export function sameDay(a: Day | null, b: Day | null): boolean {
  return !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
}

export function isoDay(day: Day): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(day.y, 4)}-${p(day.m)}-${p(day.d)}`;
}

export function compactDay(day: Day): string {
  return isoDay(day).replace(/-/g, '');
}

export function parseCompactDate(s: string): Day {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (!y || !m || !d) throw new Error(`bad date ${s}`);
  return { y, m, d };
}

export function weekdayOf(day: Day): Weekday {
  return DOW_TO_WEEKDAY[new Date(dayUtc(day)).getUTCDay()];
}

export function calendarConfig(wkst: Weekday): CalendarConfig {
  return { wkst, firstDayOfWeek: ISO_DOW[wkst], columns: weekdayColumns(wkst) };
}

// Grid columns follow WKST, never Intl.DateTimeFormat.resolvedOptions().weekday-only calculators.
export function weekdayColumns(wkst: Weekday): Weekday[] {
  const i = WEEKDAY_ORDER.indexOf(wkst);
  return WEEKDAY_ORDER.slice(i).concat(WEEKDAY_ORDER.slice(0, i));
}

// Week start on or before `day` according to the rule's WKST.
export function weekStart(day: Day, wkst: Weekday): Day {
  const today = new Date(dayUtc(day)).getUTCDay();
  const first = JS_DOW[wkst];
  const delta = (today - first + 7) % 7;
  return addDays(day, -delta);
}

export function weekKey(day: Day, wkst: Weekday): string {
  return isoDay(weekStart(day, wkst));
}

// Period 0 is the interval block containing the DTSTART week. Blocks are
// `interval` weeks wide and aligned to the DTSTART week's WKST boundary.
export function periodIndex(day: Day, anchor: Day, wkst: Weekday, interval: number): number {
  const anchorWeek = weekStart(anchor, wkst);
  const thisWeek = weekStart(day, wkst);
  return Math.floor(diffDays(thisWeek, anchorWeek) / 7 / interval);
}

export function periodStartDay(day: Day, anchor: Day, wkst: Weekday, interval: number): Day {
  const anchorWeek = weekStart(anchor, wkst);
  const k = periodIndex(day, anchor, wkst, interval);
  return addDays(anchorWeek, k * 7 * interval);
}

export function periodEndDay(day: Day, anchor: Day, wkst: Weekday, interval: number): Day {
  return addDays(periodStartDay(day, anchor, wkst, interval), 7 * interval - 1);
}

export function periodKey(day: Day, anchor: Day, wkst: Weekday, interval: number): string {
  return `${isoDay(periodStartDay(day, anchor, wkst, interval))}#${interval}`;
}

export function enumerateDays(a: Day, b: Day): Day[] {
  const [lo, hi] = dayUtc(a) <= dayUtc(b) ? [a, b] : [b, a];
  const n = diffDays(hi, lo) + 1;
  return Array.from({ length: n }, (_, i) => addDays(lo, i));
}

export function uniqueWeekdays(days: Day[], wkst: Weekday): Weekday[] {
  const present = new Set(days.map(weekdayOf));
  return weekdayColumns(wkst).filter((w) => present.has(w));
}

export interface LassoResult {
  days: Day[];
  anchor: Day; // period origin while selecting = earliest lasso day
  byday: Weekday[]; // wkst order
  periodIndexes: number[];
  periodKeys: string[];
  rangeStart: Day;
  rangeEnd: Day; // last day of the last touched period block
  periodCount: number;
}

// Used identically by mouse drag commit and keyboard commit, so both can only
// ever land on the same period.
export function interpretLasso(start: Day, end: Day, wkst: Weekday, interval: number): LassoResult {
  const first = minDay(start, end);
  const last = maxDay(start, end);
  const days = enumerateDays(first, last);
  const indexes = new Set(days.map((d) => periodIndex(d, first, wkst, interval)));
  const periodIndexes = [...indexes].sort((a, b) => a - b);
  const pStart = periodStartDay(first, first, wkst, interval);
  const pEnd = periodEndDay(last, first, wkst, interval);
  return {
    days,
    anchor: first,
    byday: uniqueWeekdays(days, wkst),
    periodIndexes,
    periodKeys: periodIndexes.map((k) => `${isoDay(addDays(weekStart(first, wkst), k * 7 * interval))}#${interval}`),
    rangeStart: pStart,
    rangeEnd: pEnd,
    periodCount: periodIndexes.length,
  };
}

export interface SelectionSummary {
  wkst: Weekday;
  interval: number;
  periodCount: number;
  rangeStart: string;
  rangeEnd: string;
  byday: Weekday[];
  periodKeys: string[];
}

export function summarizeSelection(days: Day[], wkst: Weekday, interval: number): SelectionSummary | null {
  if (!days.length) return null;
  const first = days.reduce(minDay);
  const last = days.reduce(maxDay);
  const indexes = new Set(days.map((d) => periodIndex(d, first, wkst, interval)));
  const sortedIndexes = [...indexes].sort((a, b) => a - b);
  const anchorWeek = weekStart(first, wkst);
  return {
    wkst,
    interval,
    periodCount: sortedIndexes.length,
    rangeStart: isoDay(periodStartDay(first, first, wkst, interval)),
    rangeEnd: isoDay(periodEndDay(last, first, wkst, interval)),
    byday: uniqueWeekdays(days, wkst),
    periodKeys: sortedIndexes.map((k) => `${isoDay(addDays(anchorWeek, k * 7 * interval))}#${interval}`),
  };
}

export interface ReinterpretNotice {
  changed: boolean;
  before: SelectionSummary | null;
  after: SelectionSummary | null;
}

// Re-interpret an UNSAVED lasso under a new WKST/interval. Concrete selected
// dates are preserved; only their grouping into weeks/periods changes.
export function reinterpretSelection(
  days: Day[],
  before: { wkst: Weekday; interval: number },
  after: { wkst: Weekday; interval: number },
): ReinterpretNotice {
  const b = summarizeSelection(days, before.wkst, before.interval);
  const a = summarizeSelection(days, after.wkst, after.interval);
  const changed =
    !!b && !!a && (b.periodCount !== a.periodCount || b.rangeStart !== a.rangeStart || b.rangeEnd !== a.rangeEnd || b.byday.join() !== a.byday.join());
  return { changed, before: b, after: a };
}

export function addMonths(day: Day, delta: number): Day {
  const k = day.y * 12 + (day.m - 1) + delta;
  const y = Math.floor(k / 12);
  const m = (k % 12) + 1;
  const d = Math.min(day.d, daysInMonth(y, m));
  return { y, m, d };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 42-cell (6 week) month window covering `month`, aligned to wkst.
export function monthGrid(month: Day, wkst: Weekday): Day[] {
  const first: Day = { y: month.y, m: month.m, d: 1 };
  const lead = weekStart(first, wkst);
  return Array.from({ length: 42 }, (_, i) => addDays(lead, i));
}

// ---------- timezone wall-clock handling (Intl, no locale-dependent output) ----------

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(tzid: string): Intl.DateTimeFormat {
  let f = offsetFormatterCache.get(tzid);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    offsetFormatterCache.set(tzid, f);
  }
  return f;
}

// UTC offset (ms) in effect at the given absolute instant inside tzid.
export function zoneOffsetAt(utcMs: number, tzid: string): number {
  if (tzid === 'UTC') return 0;
  const parts = offsetFormatter(tzid).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get('hour') % 24; // some ICU builds report midnight as 24
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return wall - utcMs;
}

// Resolve a wall clock time in a zone to an absolute UTC instant (fixed point,
// two-pass). Wall time is authoritative, so DST never shifts the 09:00 meeting.
export function wallToUtc(day: Day, t: WallTime, tzid: string): number {
  const target = Date.UTC(day.y, day.m - 1, day.d, t.h, t.mi, 0);
  if (tzid === 'UTC') return target;
  let utc = target - zoneOffsetAt(target, tzid);
  utc = target - zoneOffsetAt(utc, tzid);
  return utc;
}

// ---------- RRULE parse / serialize (WEEKLY subset, RFC 5545) ----------

const WD: Record<string, Weekday> = { MO: 'MO', TU: 'TU', WE: 'WE', TH: 'TH', FR: 'FR', SA: 'SA', SU: 'SU' };

export interface ParseResult {
  doc: RuleDoc | null;
  diagnostics: string[];
}

export function defaultRule(): RuleDoc {
  return {
    dtstart: { y: 2026, m: 1, d: 5, h: 9, mi: 0, tzid: 'Asia/Shanghai' },
    interval: 1,
    wkst: 'MO',
    byday: ['MO', 'WE', 'FR'],
  };
}

export function parseRule(content: string): ParseResult {
  const diagnostics: string[] = [];
  let dtstart: DtStart | null = null;
  let interval = 1;
  let wkst: Weekday | null = null;
  let byday: Weekday[] | [] = [];
  let count: number | undefined;
  let until: string | undefined;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const semi = line.indexOf(';');
    const colon = line.indexOf(':');
    if (colon < 0) {
      diagnostics.push(`ignored malformed line: ${line}`);
      continue;
    }
    const name = line.slice(0, semi >= 0 && semi < colon ? semi : colon).toUpperCase();
    const params = new Map<string, string>();
    if (semi >= 0 && semi < colon) {
      for (const pair of line.slice(semi + 1, colon).split(';')) {
        const [k, ...rest] = pair.split('=');
        params.set(k.toUpperCase(), rest.join('='));
      }
    }
    const value = line.slice(colon + 1);

    if (name === 'DTSTART') {
      try {
        const isUtc = value.endsWith('Z');
        const tzid = isUtc ? 'UTC' : params.get('TZID') ?? 'UTC';
        const day = parseCompactDate(value.slice(0, 8));
        const hasTime = value.length >= 15 && value.charAt(8) === 'T';
        const h = hasTime ? Number(value.slice(9, 11)) : 0;
        const mi = hasTime ? Number(value.slice(11, 13)) : 0;
        dtstart = { ...day, h: Number.isFinite(h) ? h : 0, mi: Number.isFinite(mi) ? mi : 0, tzid };
      } catch {
        diagnostics.push(`bad DTSTART: ${value}`);
      }
    } else if (name === 'RRULE') {
      for (const part of value.split(';')) {
        const [k, v] = part.split('=');
        switch (k.toUpperCase()) {
          case 'FREQ':
            if (v.toUpperCase() !== 'WEEKLY') diagnostics.push('only FREQ=WEEKLY is supported');
            break;
          case 'INTERVAL':
            interval = Math.max(1, Math.trunc(Number(v)) || 1);
            break;
          case 'WKST':
            wkst = WD[v.toUpperCase()] ?? null;
            if (!wkst) diagnostics.push(`bad WKST: ${v}`);
            break;
          case 'BYDAY':
            byday = v.split(',').map((x) => WD[x.trim().toUpperCase()]).filter(Boolean) as Weekday[];
            break;
          case 'COUNT':
            count = Math.max(1, Math.trunc(Number(v)) || 1);
            break;
          case 'UNTIL':
            until = v;
            break;
          default:
            break;
        }
      }
    } else if (name !== 'END' && name !== 'BEGIN') {
      diagnostics.push(`ignored unsupported property: ${name}`);
    }
  }

  if (!dtstart) {
    diagnostics.push('missing DTSTART');
    return { doc: null, diagnostics };
  }
  if (!byday.length) {
    diagnostics.push('missing BYDAY; defaulting to the DTSTART weekday');
    byday = [weekdayOf(dtstart)];
  }
  return {
    doc: { dtstart, interval, wkst: wkst ?? weekdayOf(dtstart), byday: dedupeWeekdays(byday, wkst ?? weekdayOf(dtstart)), count, until },
    diagnostics,
  };
}

function dedupeWeekdays(days: Weekday[], wkst: Weekday): Weekday[] {
  return weekdayColumns(wkst).filter((w) => days.includes(w));
}

export function serializeRule(doc: RuleDoc): string {
  const t = doc.dtstart;
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${p(t.y, 4)}${p(t.m)}${p(t.d)}T${p(t.h)}${p(t.mi)}00`;
  const dtLine = t.tzid === 'UTC' ? `DTSTART:${stamp}Z` : `DTSTART;TZID=${t.tzid}:${stamp}`;
  const parts = [
    'FREQ=WEEKLY',
    `INTERVAL=${doc.interval}`,
    `WKST=${doc.wkst}`,
    `BYDAY=${dedupeWeekdays(doc.byday, doc.wkst).join(',')}`,
  ];
  if (doc.count) parts.push(`COUNT=${doc.count}`);
  if (doc.until) parts.push(`UNTIL=${doc.until}`);
  return `${dtLine}\nRRULE:${parts.join(';')}`;
}

// ---------- occurrence expansion ----------

export interface ExpandOptions {
  maxCount?: number; // cap when neither COUNT nor UNTIL is present
  horizonDays?: number;
}

export function expandWeekly(doc: RuleDoc, opts: ExpandOptions = {}): Occurrence[] {
  const maxCount = doc.count ?? opts.maxCount ?? 12;
  const horizonDays = opts.horizonDays ?? 370;
  const { dtstart, interval, wkst, byday } = doc;
  const anchor: Day = { y: dtstart.y, m: dtstart.m, d: dtstart.d };
  const startInstant = wallToUtc(anchor, dtstart, dtstart.tzid);
  const untilInstant = doc.until ? parseUntilInstant(doc.until) : Infinity;
  const horizon = startInstant + horizonDays * 86400000;
  const out: Occurrence[] = [];
  const ordered = weekdayColumns(wkst).filter((w) => byday.includes(w));
  const p2 = (n: number) => String(n).padStart(2, '0');

  for (let k = 0; out.length < maxCount; k++) {
    if (k % interval !== 0) continue;
    const weekBase = addDays(weekStart(anchor, wkst), k * 7);
    for (const code of ordered) {
      const day = addDays(weekBase, weekdayColumns(wkst).indexOf(code));
      const instant = wallToUtc(day, dtstart, dtstart.tzid);
      if (instant < startInstant) continue;
      if (instant > untilInstant || instant > horizon) break;
      out.push({
        index: out.length + 1,
        weekday: code,
        date: isoDay(day),
        wallTime: `${p2(dtstart.h)}:${p2(dtstart.mi)}`,
        tzid: dtstart.tzid,
        iso: new Date(instant).toISOString(),
        weekKey: weekKey(day, wkst),
        periodIndex: Math.floor(k / interval),
        periodKey: periodKey(day, anchor, wkst, interval),
      });
      if (out.length >= maxCount) break;
    }
    if (dayUtc(weekBase) - startInstant > (horizonDays + 14) * 86400000) break;
  }
  return out;
}

function parseUntilInstant(value: string): number {
  if (value.endsWith('Z')) {
    const c = value.slice(0, 8);
    const day = parseCompactDate(c);
    const h = Number(value.slice(9, 11));
    const mi = Number(value.slice(11, 13));
    const s = Number(value.slice(13, 15));
    return Date.UTC(day.y, day.m - 1, day.d, h, mi, s);
  }
  // Floating UNTIL is treated as UTC for this weekly subset.
  const day = parseCompactDate(value.slice(0, 8));
  return Date.UTC(day.y, day.m - 1, day.d);
}

export function preview(doc: RuleDoc, opts?: ExpandOptions) {
  return {
    calendar: calendarConfig(doc.wkst),
    rule: {
      dtstart: { ...doc.dtstart },
      interval: doc.interval,
      wkst: doc.wkst,
      byday: dedupeWeekdays(doc.byday, doc.wkst),
      ...(doc.count ? { count: doc.count } : {}),
      ...(doc.until ? { until: doc.until } : {}),
    },
    occurrences: expandWeekly(doc, opts),
  };
}

// ---------- locale is allowed to affect LABELS ONLY, never computation ----------

const labelCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = labelCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    labelCache.set(key, f);
  }
  return f;
}

// Reference week 2026-01-04 (Sunday) .. 2026-01-10 (Saturday), labeled in UTC.
export function weekdayLabel(locale: string, wd: Weekday, width: Intl.DateTimeFormatOptions['weekday'] = 'short'): string {
  const ref = new Date(Date.UTC(2026, 0, 4 + JS_DOW[wd]));
  return formatter(locale, { weekday: width }).format(ref);
}

export function monthLabel(locale: string, day: Day): string {
  return formatter(locale, { year: 'numeric', month: 'long' }).format(new Date(dayUtc(day)));
}

export function dayLabel(locale: string, day: Day): string {
  return formatter(locale, { day: 'numeric' }).format(new Date(dayUtc(day)));
}

export function fullDateLabel(locale: string, day: Day): string {
  return formatter(locale, { dateStyle: 'full' }).format(new Date(dayUtc(day)));
}

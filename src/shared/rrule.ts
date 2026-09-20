// Shared recurrence core — the ONLY place week/period math lives.
// Both the server (preview API) and the client (grid, drag, keyboard) import it.
// Locale is never used here: labels live in labels.ts.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // MO=0 ... SU=6
export const MO: Weekday = 0, TU: Weekday = 1, WE: Weekday = 2, TH: Weekday = 3, FR: Weekday = 4, SA: Weekday = 5, SU: Weekday = 6;
export const WEEKDAY_TOKENS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WeekdayToken = (typeof WEEKDAY_TOKENS)[number];
export const WEEKDAY_BY_TOKEN: Record<string, Weekday> = {MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6};

export type Rule = {
  freq: 'WEEKLY';
  interval: number;
  byday: Weekday[];
  wkst: Weekday;
  dtstart: WallDateTime;
  zone: string; // IANA name, 'UTC', or fixed offset like 'UTC+09:00'
  count: number | null;
};

export type WallDateTime = { y: number; m: number; d: number; h: number; mi: number };
export type Diagnostic = { line: number; message: string };

export class RuleError extends Error {
  diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => `line ${d.line}: ${d.message}`).join('; '));
    this.diagnostics = diagnostics;
  }
}

// ---------- wall clock primitives (dates are carried as UTC Date components) ----------

export function wallToDate(w: WallDateTime): Date {
  return new Date(Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, 0));
}
export function dateToWall(date: Date): WallDateTime {
  return {y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), h: date.getUTCHours(), mi: date.getUTCMinutes()};
}
export function addDays(w: WallDateTime, delta: number): WallDateTime {
  return dateToWall(new Date(wallToDate(w).getTime() + delta * 86_400_000));
}
export function wallDateOnly(w: WallDateTime): WallDateTime {
  return {y: w.y, m: w.m, d: w.d, h: 0, mi: 0};
}
export function compareWall(a: WallDateTime, b: WallDateTime): number {
  return wallToDate(a).getTime() - wallToDate(b).getTime();
}
export function dayKey(w: WallDateTime): string {
  return `${pad4(w.y)}-${pad2(w.m)}-${pad2(w.d)}`;
}
export function keyToWall(key: string): WallDateTime {
  const [y, m, d] = key.split('-').map(Number);
  return {y, m, d, h: 0, mi: 0};
}
export function keyToDate(key: string): Date {
  return wallToDate(keyToWall(key));
}
export function diffDays(aKey: string, bKey: string): number {
  return Math.round((keyToDate(aKey).getTime() - keyToDate(bKey).getTime()) / 86_400_000);
}
function pad2(n: number) { return String(n).padStart(2, '0'); }
function pad4(n: number) { return String(n).padStart(4, '0'); }

/** MO-based weekday index of a wall date. */
export function weekdayOf(w: WallDateTime): Weekday {
  return ((wallToDate(w).getUTCDay() + 6) % 7) as Weekday;
}

// ---------- WKST anchor / period key ----------

/** Wall date of the first day (WKST day) of the week containing `w`. */
export function weekAnchorDate(wkst: Weekday, w: WallDateTime): WallDateTime {
  const delta = (weekdayOf(w) - wkst + 7) % 7;
  return wallDateOnly(addDays(w, -delta));
}
export function weekAnchorKey(wkst: Weekday, key: string): string {
  return dayKey(weekAnchorDate(wkst, keyToWall(key)));
}
/** Stable identity of a recurrence period: the wall date key of its WKST week. */
export function periodKey(wkst: Weekday, w: WallDateTime): string {
  return dayKey(weekAnchorDate(wkst, w));
}
export function periodIndexBetween(anchor0Key: string, wkst: Weekday, key: string, interval: number): number {
  const weeks = diffDays(weekAnchorKey(wkst, key), anchor0Key) / 7;
  return Math.floor(weeks / interval);
}

// ---------- time zones (IANA via Intl, plus fixed offsets) ----------

function fixedZoneOffsetMinutes(zone: string): number | null {
  if (zone === 'UTC' || zone === 'Z' || zone === 'GMT') return 0;
  const m = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(zone);
  if (!m) return null;
  const hours = Number(m[2]);
  const mins = m[3] ? Number(m[3]) : 0;
  if (hours > 23 || mins > 59) return null;
  return (m[1] === '-' ? -1 : 1) * (hours * 60 + mins);
}

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
/** Offset of `zone` at the given instant, in minutes east of UTC. */
export function offsetMinutesAt(zone: string, instant: Date): number {
  const fixed = fixedZoneOffsetMinutes(zone);
  if (fixed !== null) return fixed;
  let fmt = offsetFormatterCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    offsetFormatterCache.set(zone, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(instant).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUTC - instant.getTime()) / 60_000);
}

/** Interpret a wall clock time in `zone` as an absolute instant. */
export function wallToInstant(zone: string, wall: WallDateTime): Date {
  const naive = wallToDate(wall).getTime();
  let offset = offsetMinutesAt(zone, new Date(naive));
  let instant = new Date(naive - offset * 60_000);
  const offset2 = offsetMinutesAt(zone, instant); // refine across DST transitions
  if (offset2 !== offset) instant = new Date(naive - offset2 * 60_000);
  return instant;
}
export function instantToWall(zone: string, instant: Date): WallDateTime {
  const fixed = fixedZoneOffsetMinutes(zone);
  if (fixed !== null) return dateToWall(new Date(instant.getTime() + fixed * 60_000));
  let fmt = offsetFormatterCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    offsetFormatterCache.set(zone, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(instant).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return {y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute};
}

// ---------- parse / serialize ----------

const DTSTART_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

export function parseRule(content: string): {rule: Rule; diagnostics: Diagnostic[]} {
  const diagnostics: Diagnostic[] = [];
  let interval = 1, wkst: Weekday = MO, count: number | null = null;
  const collected: {byday: Weekday[] | null} = {byday: null};
  let dtstart: WallDateTime | null = null;
  let zone = 'UTC';
  const lines = content.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const lineNo = i + 1;
    if (!line || line.startsWith('#')) return;
    const colon = line.indexOf(':');
    const name = colon === -1 ? line : line.slice(0, colon).toUpperCase();
    const value = colon === -1 ? '' : line.slice(colon + 1);
    if (name === 'RRULE') {
      value.split(';').filter(Boolean).forEach((part) => {
        const eq = part.indexOf('=');
        const key = (eq === -1 ? part : part.slice(0, eq)).toUpperCase();
        const v = (eq === -1 ? '' : part.slice(eq + 1)).toUpperCase();
        if (key === 'FREQ' && v !== 'WEEKLY') diagnostics.push({line: lineNo, message: `unsupported FREQ ${v} (only WEEKLY)`});
        else if (key === 'INTERVAL') {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1) diagnostics.push({line: lineNo, message: `INTERVAL must be a positive integer, got ${v}`});
          else interval = n;
        } else if (key === 'WKST') {
          if (!(v in WEEKDAY_BY_TOKEN)) diagnostics.push({line: lineNo, message: `WKST must be MO..SU, got ${v}`});
          else wkst = WEEKDAY_BY_TOKEN[v as WeekdayToken];
        } else if (key === 'BYDAY') {
          const days: Weekday[] = [];
          v.split(',').forEach((tok) => {
            if (!(tok in WEEKDAY_BY_TOKEN)) diagnostics.push({line: lineNo, message: `BYDAY token must be MO..SU, got ${tok}`});
            else if (!days.includes(WEEKDAY_BY_TOKEN[tok as WeekdayToken])) days.push(WEEKDAY_BY_TOKEN[tok as WeekdayToken]);
          });
          days.sort((a, b) => a - b);
          collected.byday = days;
        } else if (key !== 'FREQ') {
          diagnostics.push({line: lineNo, message: `unsupported RRULE part ${key}`});
        }
      });
    } else if (name === 'DTSTART') {
      const m = DTSTART_RE.exec(value);
      if (!m) diagnostics.push({line: lineNo, message: 'DTSTART must look like 20260105T090000'});
      else {
        const w = {y: +m[1], m: +m[2], d: +m[3], h: +m[4], mi: +m[5]};
        if (m[7] === 'Z') zone = 'UTC';
        dtstart = w;
      }
    } else if (name === 'TZID') {
      zone = value;
      if (fixedZoneOffsetMinutes(value) === null) {
        try {
          new Intl.DateTimeFormat('en-US', {timeZone: value});
        } catch {
          diagnostics.push({line: lineNo, message: `unknown time zone ${value}`});
        }
      }
    } else if (name === 'COUNT') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) diagnostics.push({line: lineNo, message: `COUNT must be a positive integer, got ${value}`});
      else count = n;
    } else {
      diagnostics.push({line: lineNo, message: `unknown directive ${name}`});
    }
  });
  if (!dtstart) diagnostics.push({line: lines.length, message: 'DTSTART is required'});
  if (diagnostics.length) throw new RuleError(diagnostics);
  const start = dtstart!;
  return {
    rule: {
      freq: 'WEEKLY',
      interval,
      wkst,
      byday: collected.byday && collected.byday.length > 0 ? collected.byday : [weekdayOf(start)],
      dtstart: start,
      zone,
      count,
    },
    diagnostics,
  };
}

export function serializeRule(rule: Rule): string {
  const byday = rule.byday.slice().sort((a, b) => a - b).map((d) => WEEKDAY_TOKENS[d]).join(',');
  const w = rule.dtstart;
  const dt = `${pad4(w.y)}${pad2(w.m)}${pad2(w.d)}T${pad2(w.h)}${pad2(w.mi)}00`;
  const lines = [
    `RRULE:FREQ=WEEKLY;INTERVAL=${rule.interval};BYDAY=${byday};WKST=${WEEKDAY_TOKENS[rule.wkst]}`,
    `DTSTART:${dt}`,
  ];
  if (rule.zone !== 'UTC') lines.push(`TZID:${rule.zone}`);
  if (rule.count !== null) lines.push(`COUNT:${rule.count}`);
  return lines.join('\n') + '\n';
}

// ---------- occurrence expansion ----------

export type Occurrence = {
  index: number;          // position since DTSTART (0-based)
  date: string;           // wall day key in rule zone, e.g. "2026-01-05"
  time: string;           // "HH:MM" wall
  weekday: Weekday;
  periodIndex: number;    // k in anchor0 + k*INTERVAL weeks
  periodKey: string;      // WKST-week anchor of the occurrence
  instant: string;        // ISO instant
};

export type ExpandOptions = { rangeStart?: Date; rangeEnd?: Date; maxPeriods?: number };

export function expandOccurrences(rule: Rule, opts: ExpandOptions = {}): Occurrence[] {
  const startWall = rule.dtstart;
  const startInstant = wallToInstant(rule.zone, startWall);
  const anchor0 = weekAnchorDate(rule.wkst, startWall);
  const rangeStart = opts.rangeStart ?? new Date(startInstant.getTime() - 3 * 86_400_000);
  const rangeEnd = opts.rangeEnd ?? new Date(startInstant.getTime() + 84 * 86_400_000);
  const rangeEndWall = instantToWall(rule.zone, rangeEnd);
  const maxPeriods = opts.maxPeriods ?? 2000;

  const out: Occurrence[] = [];
  for (let k = 0; k <= maxPeriods; k++) {
    const periodAnchor = addDays(anchor0, k * 7 * rule.interval);
    // Stop only once the LATEST possible candidate in the period is past the window.
    const maxWd = rule.byday.reduce((a, b) => (((b - rule.wkst + 7) % 7) > ((a - rule.wkst + 7) % 7) ? b : a));
    const lastCand: WallDateTime = {
      ...addDays(periodAnchor, (maxWd - rule.wkst + 7) % 7),
      h: startWall.h, mi: startWall.mi,
    };
    if (compareWall(lastCand, rangeEndWall) > 0) break;
    for (const wd of rule.byday) {
      const candWall: WallDateTime = {
        ...addDays(periodAnchor, ((wd - rule.wkst + 7) % 7)),
        h: startWall.h, mi: startWall.mi,
      };
      if (compareWall(candWall, startWall) < 0) continue; // never before DTSTART
      const candInstant = wallToInstant(rule.zone, candWall);
      if (candInstant.getTime() < rangeStart.getTime() || candInstant.getTime() > rangeEnd.getTime()) continue;
      out.push({
        index: out.length,
        date: dayKey(candWall),
        time: `${pad2(candWall.h)}:${pad2(candWall.mi)}`,
        weekday: weekdayOf(candWall),
        periodIndex: k,
        periodKey: periodKey(rule.wkst, candWall),
        instant: candInstant.toISOString(),
      });
      if (rule.count !== null && out.length >= rule.count) return out;
    }
  }
  return out;
}

// ---------- server-facing preview bundle ----------

export type CalendarConfig = {
  wkst: WeekdayToken;
  weekStartsOn: Weekday; // MO=0..SU=6
  zone: string;
};
export type PreviewBundle = {
  calendar: CalendarConfig;
  rule: {
    freq: 'WEEKLY';
    interval: number;
    byday: WeekdayToken[];
    wkst: WeekdayToken;
    count: number | null;
    dtstart: { wall: string; instant: string; zone: string };
  };
  grid: { start: string; end: string }; // wall-day window covered by weeks
  occurrences: Occurrence[];
};

export function buildPreview(rule: Rule, rangeStart?: Date, rangeEnd?: Date): PreviewBundle {
  const startInstant = wallToInstant(rule.zone, rule.dtstart);
  const rangeStartN = rangeStart ?? new Date(startInstant.getTime() - 3 * 86_400_000);
  const rangeEndN = rangeEnd ?? new Date(startInstant.getTime() + 84 * 86_400_000);
  const occurrences = expandOccurrences(rule, {rangeStart: rangeStartN, rangeEnd: rangeEndN});
  const w0 = instantToWall(rule.zone, rangeStartN);
  const w1 = instantToWall(rule.zone, rangeEndN);
  // The grid covers the full snapped preview window (leading week(s) before
  // DTSTART are rendered empty/banded so the first-period boundary is visible);
  // occurrence rows themselves still never predate DTSTART.
  const gridStart = weekAnchorDate(rule.wkst, w0);
  const gridEnd = addDays(weekAnchorDate(rule.wkst, w1), 6);
  const dtInstant = wallToInstant(rule.zone, rule.dtstart);
  return {
    calendar: {wkst: WEEKDAY_TOKENS[rule.wkst], weekStartsOn: rule.wkst, zone: rule.zone},
    rule: {
      freq: 'WEEKLY',
      interval: rule.interval,
      byday: rule.byday.slice().sort((a, b) => a - b).map((d) => WEEKDAY_TOKENS[d]),
      wkst: WEEKDAY_TOKENS[rule.wkst],
      count: rule.count,
      dtstart: {wall: `${dayKey(rule.dtstart)}T${pad2(rule.dtstart.h)}:${pad2(rule.dtstart.mi)}`, instant: dtInstant.toISOString(), zone: rule.zone},
    },
    grid: {start: dayKey(gridStart), end: dayKey(gridEnd)},
    occurrences,
  };
}

/**
 * Reconstruct the canonical Rule from a SERVER preview bundle. The client
 * uses this (rather than re-parsing text) so the grid and all selection math
 * run on the exact CalendarConfig the server computed — never a local guess.
 */
export function ruleFromPreview(bundle: PreviewBundle): Rule {
  return {
    freq: 'WEEKLY',
    interval: bundle.rule.interval,
    byday: bundle.rule.byday.map((t) => WEEKDAY_BY_TOKEN[t] as Weekday),
    wkst: bundle.calendar.weekStartsOn,
    count: bundle.rule.count,
    zone: bundle.calendar.zone,
    dtstart: instantToWall(bundle.calendar.zone, new Date(bundle.rule.dtstart.instant)),
  };
}

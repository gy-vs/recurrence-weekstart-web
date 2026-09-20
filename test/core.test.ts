import {describe, expect, it} from 'vitest';
import {
  addDays, buildPreview, dateToWall, dayKey, diffDays, expandOccurrences, instantToWall,
  keyToWall, parseRule, periodIndexBetween, periodKey, ruleFromPreview, serializeRule,
  wallDateOnly, wallToDate, wallToInstant, weekAnchorDate, weekAnchorKey, weekdayOf,
  WEEKDAY_BY_TOKEN, type Rule,
} from '../src/shared/rrule';

const SU = WEEKDAY_BY_TOKEN.SU, MO = WEEKDAY_BY_TOKEN.MO;

function rule(p: Partial<Rule> = {}): Rule {
  return {
    freq: 'WEEKLY', interval: 1, byday: [MO], wkst: MO, count: null, zone: 'UTC',
    dtstart: {y: 2026, m: 1, d: 5, h: 9, mi: 0},
    ...p,
  };
}

describe('week anchor math — Sunday vs Monday starts', () => {
  // 2026-01-04 is Sunday, 2026-01-05 Monday
  const sun = {y: 2026, m: 1, d: 4, h: 0, mi: 0};
  const mon = {y: 2026, m: 1, d: 5, h: 0, mi: 0};
  const sat = {y: 2026, m: 1, d: 10, h: 0, mi: 0};

  it('anchors a Sunday..Saturday week under WKST=SU', () => {
    expect(dayKey(weekAnchorDate(SU, mon))).toBe('2026-01-04');
    expect(dayKey(weekAnchorDate(SU, sat))).toBe('2026-01-04');
    expect(weekdayOf(sun)).toBe(6);
    expect(weekdayOf(mon)).toBe(0);
  });
  it('anchors a Monday..Sunday week under WKST=MO', () => {
    expect(dayKey(weekAnchorDate(MO, sun))).toBe('2025-12-29');
    expect(dayKey(weekAnchorDate(MO, sat))).toBe('2026-01-05');
    expect(dayKey(weekAnchorDate(MO, mon))).toBe('2026-01-05');
  });
  it('periodKey is the same for all 7 days of a week and differs across WKST', () => {
    // Monday 2026-01-05 .. Sunday 2026-01-11 is one MO week
    for (let i = 0; i < 7; i++) {
      expect(periodKey(MO, addDays(mon, i))).toBe('2026-01-05');
    }
    // Under WKST=SU the Mon..Sat (Jan5..Jan10) sit in the Jan-4 Sunday week,
    // while Sunday Jan-11 anchors its own week.
    for (let i = 0; i <= 5; i++) {
      expect(periodKey(SU, addDays(mon, i))).toBe('2026-01-04');
    }
    expect(periodKey(SU, addDays(mon, 6))).toBe('2026-01-11');
    expect(periodKey(SU, sun)).toBe('2026-01-04');
    expect(periodKey(SU, sat)).toBe('2026-01-04');
  });
  it('grid week windows never depend on the surrounding locale helpers', () => {
    // The header order module rotates by WKST; here we assert the math boundary.
    expect(weekAnchorKey(SU, '2026-01-04')).toBe('2026-01-04');
    expect(weekAnchorKey(MO, '2026-01-04')).toBe('2025-12-29');
  });
});

describe('cross-year weeks', () => {
  it('WKST=MO keeps 2025-12-29..2026-01-04 as one period keyed 2025-12-29', () => {
    const days = ['2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02','2026-01-03','2026-01-04'];
    expect(new Set(days.map((d) => periodKey(MO, keyToWall(d)))).size).toBe(1);
  });
  it('WKST=SU keeps 2025-12-28..2026-01-03 as one period keyed 2025-12-28', () => {
    const days = ['2025-12-28','2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02','2026-01-03'];
    expect(new Set(days.map((d) => periodKey(SU, keyToWall(d)))).size).toBe(1);
    // and Jan 4 2026 starts the NEXT period
    expect(periodKey(SU, keyToWall('2026-01-04'))).toBe('2026-01-04');
  });
  it('biweekly anchor math across the year boundary stays aligned', () => {
    const r = rule({dtstart: {y: 2025, m: 12, d: 29, h: 9, mi: 0}, interval: 2, wkst: MO});
    expect(periodIndexBetween(dayKey(weekAnchorDate(MO, r.dtstart)), MO, '2026-01-12', 2)).toBe(1);
    expect(periodIndexBetween(dayKey(weekAnchorDate(MO, r.dtstart)), MO, '2026-01-05', 2)).toBe(0);
    expect(periodIndexBetween(dayKey(weekAnchorDate(MO, r.dtstart)), MO, '2025-12-29', 2)).toBe(0);
  });
});

describe('biweekly interval expansion under both WKST values', () => {
  const range = {rangeStart: new Date(Date.UTC(2025, 11, 22)), rangeEnd: new Date(Date.UTC(2026, 1, 15, 23, 59))};
  it('WKST=MO INTERVAL=2 BYDAY=MO,WE,FR repeats in alternating Mon-anchored weeks', () => {
    const r = rule({dtstart: {y: 2025, m: 12, d: 29, h: 9, mi: 0}, interval: 2, byday: [0, 2, 4], wkst: MO});
    const occ = expandOccurrences(r, range);
    const anchors = [...new Set(occ.map((o) => o.periodKey))];
    expect(anchors).toEqual(['2025-12-29', '2026-01-12', '2026-01-26', '2026-02-09']);
    expect(diffDays(anchors[1], anchors[0])).toBe(14);
    expect(occ.every((o) => ['2025-12-29','2026-01-12','2026-01-26','2026-02-09'].includes(weekAnchorKey(MO, o.date)))).toBe(true);
    // period keys actually present on the occurrence objects
    expect(occ[0]).toMatchObject({date: '2025-12-29', periodIndex: 0, periodKey: '2025-12-29'});
    expect(occ.find((o) => o.date === '2026-01-12')!.periodIndex).toBe(1);
  });
  it('WKST=SU with the same BYDAY shifts the active bands by up to a week', () => {
    const r = rule({dtstart: {y: 2025, m: 12, d: 28, h: 9, mi: 0}, interval: 2, byday: [0, 2, 4], wkst: SU});
    const occ = expandOccurrences(r, range);
    const anchors = [...new Set(occ.map((o) => o.periodKey))];
    // Sunday-anchored bands: Dec28, Jan11, Jan25, Feb8
    expect(anchors).toEqual(['2025-12-28', '2026-01-11', '2026-01-25', '2026-02-08']);
    // Monday 2025-12-29 belongs to the Dec-28 band under SU but the Dec-29 band under MO
    expect(periodKey(SU, keyToWall('2025-12-29'))).toBe('2025-12-28');
    expect(periodKey(MO, keyToWall('2025-12-29'))).toBe('2025-12-29');
  });
});

describe('time zones and cross-midnight days', () => {
  it('maps wall times to instants with zone offsets and DST', () => {
    const winter = wallToInstant('Asia/Tokyo', {y: 2026, m: 1, d: 5, h: 9, mi: 0});
    expect(winter.toISOString()).toBe('2026-01-05T00:00:00.000Z');
    expect(instantToWall('Asia/Tokyo', winter)).toEqual({y: 2026, m: 1, d: 5, h: 9, mi: 0});
    const la = wallToInstant('America/Los_Angeles', {y: 2026, m: 3, d: 8, h: 9, mi: 0});
    expect(la.toISOString()).toBe('2026-03-08T16:00:00.000Z'); // PDT UTC-7 (after 2AM spring-forward)
    const laWinter = wallToInstant('America/Los_Angeles', {y: 2026, m: 1, d: 5, h: 9, mi: 0});
    expect(laWinter.toISOString()).toBe('2026-01-05T17:00:00.000Z'); // PST UTC-8
  });
  it('a late-evencement wall time lands on a different UTC date but keeps its wall periodKey', () => {
    const r = rule({zone: 'Asia/Tokyo', dtstart: {y: 2026, m: 1, d: 3, h: 23, mi: 30}, byday: [5], wkst: SU});
    const occ = expandOccurrences(r, {rangeStart: new Date(Date.UTC(2026, 0, 1)), rangeEnd: new Date(Date.UTC(2026, 1, 10))});
    const first = occ[0];
    expect(first.date).toBe('2026-01-03'); // wall date (Saturday) in Tokyo
    expect(first.instant).toBe('2026-01-03T14:30:00.000Z'); // UTC date matches, +9 earlier
    // New York late night crosses the UTC midnight boundary:
    const ny = rule({zone: 'America/New_York', dtstart: {y: 2026, m: 1, d: 5, h: 22, mi: 0}, byday: [0], wkst: MO});
    const nyOcc = expandOccurrences(ny, {rangeStart: new Date(Date.UTC(2026, 0, 5)), rangeEnd: new Date(Date.UTC(2026, 0, 20))});
    expect(nyOcc[0].date).toBe('2026-01-05');
    expect(nyOcc[0].instant).toBe('2026-01-06T03:00:00.000Z'); // next UTC day, same wall period
    expect(nyOcc[0].periodKey).toBe('2026-01-05');
  });
});

describe('parse / serialize roundtrip and preview bundle', () => {
  it('roundtrips WKST/INTERVAL/BYDAY without locale influence', () => {
    const text = 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;WKST=SU\nDTSTART:20251228T090000\nTZID:UTC\n';
    const {rule: r} = parseRule(text);
    expect(r.wkst).toBe(SU);
    expect(r.interval).toBe(2);
    expect(r.byday).toEqual([0, 2, 4]);
    expect(parseRule(serializeRule(r)).rule).toEqual(r);
  });
  it('buildPreview returns calendar config plus per-occurrence period keys', () => {
    const r = rule({interval: 2, byday: [0, 2], wkst: MO, dtstart: {y: 2025, m: 12, d: 29, h: 9, mi: 0}});
    const b = buildPreview(r, new Date(Date.UTC(2025, 11, 28)), new Date(Date.UTC(2026, 1, 10)));
    expect(b.calendar).toEqual({wkst: 'MO', weekStartsOn: MO, zone: 'UTC'});
    expect(b.grid.start).toBe('2025-12-22'); // window snapped back to its MO week (leading band)
    expect(b.grid.end).toBe('2026-02-15');   // Feb 10 lives in the Feb-9..Feb-15 MO week
    expect(b.occurrences.every((o) => typeof o.periodKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.periodKey))).toBe(true);
  });
  it('client reconstructs the identical rule from the server bundle (incl. zoned wall time)', () => {
    const original = rule({
      zone: 'Asia/Tokyo', interval: 2, wkst: SU, byday: [0, 6],
      dtstart: {y: 2026, m: 1, d: 3, h: 23, mi: 30},
    });
    const b = buildPreview(original);
    const rebuilt = ruleFromPreview(b);
    expect(rebuilt).toEqual(original);
    // expanding with the rebuilt rule yields identical period keys
    const again = expandOccurrences(rebuilt, {rangeStart: new Date(b.occurrences[0].instant), rangeEnd: new Date(Date.UTC(2026, 2, 1))});
    expect(again.map((o) => o.periodKey)).toEqual(
      expandOccurrences(original, {rangeStart: new Date(b.occurrences[0].instant), rangeEnd: new Date(Date.UTC(2026, 2, 1))}).map((o) => o.periodKey));
  });
  it('rejects bad WKST/INTERVAL with diagnostics', () => {
    expect(() => parseRule('RRULE:FREQ=WEEKLY;WKST=XX\nDTSTART:20260105T090000\n')).toThrow();
    expect(() => parseRule('RRULE:FREQ=WEEKLY;INTERVAL=0\nDTSTART:20260105T090000\n')).toThrow();
  });
});

describe('wall primitives stability', () => {
  it('date round trips through UTC components without browser zone leakage', () => {
    const w = {y: 2026, m: 12, d: 31, h: 23, mi: 59};
    expect(dateToWall(wallToDate(w))).toEqual(w);
    expect(wallDateOnly(addDays(w, 1))).toEqual({y: 2027, m: 1, d: 1, h: 0, mi: 0});
  });
});

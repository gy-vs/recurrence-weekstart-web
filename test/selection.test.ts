import {describe, expect, it} from 'vitest';
import {parseRule, serializeRule, WEEKDAY_BY_TOKEN, type Rule} from '../src/shared/rrule';
import {
  activePeriodKeys, defaultSelection, gridWeeks, mergeSweep, moveFocusedKey,
  normalize, periodDaysForKey, reinterpretForWkst, ruleFromSelection,
  selectionToRule, sweepDays, toggleDay,
} from '../src/shared/selection';
import {weekdayHeaderOrder, weekdayShortLabel} from '../src/shared/labels';

const SU = WEEKDAY_BY_TOKEN.SU, MO = WEEKDAY_BY_TOKEN.MO;

function r(text: string): Rule {
  return parseRule(text).rule;
}
const BIWEEKLY_MO = 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;WKST=MO\nDTSTART:20251229T090000\nTZID:UTC\n';
const WEEKLY_SU = 'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU;WKST=SU\nDTSTART:20260103T090000\nTZID:UTC\n';

describe('mouse drag and keyboard navigation land on identical periods', () => {
  const base = r(BIWEEKLY_MO);
  const start = '2025-12-29', end = '2026-02-01';

  it('a pointer sweep from Monday to Friday paints exactly the same days as shift+arrows', () => {
    // mouse: pointerdown Mon, move to Fri
    const mouse = mergeSweep([], '2025-12-29', '2026-01-02');
    // keyboard: focus Mon, then 4x Shift+ArrowRight
    let kb: ReturnType<typeof normalize> = ['2025-12-29'];
    let focus = '2025-12-29';
    for (let i = 0; i < 4; i++) {
      focus = moveFocusedKey(focus, 'right', base, start, end);
      kb = mergeSweep(kb, '2025-12-29', focus);
    }
    expect(kb).toEqual(mouse);
    expect(kb).toEqual(['2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02']);
  });

  it('vertical arrow moves by the WKST week (7 days) and stays in the same weekday column', () => {
    const f1 = moveFocusedKey('2025-12-29', 'down', base, start, end); // Mon -> next Mon
    expect(f1).toBe('2026-01-05');
    // under WKST=SU, down from Sunday 2026-01-04 goes to Sunday 2026-01-11
    const su = r(WEEKLY_SU);
    expect(moveFocusedKey('2026-01-04', 'down', su, '2025-12-28', end)).toBe('2026-01-11');
  });

  it('PageUp/PageDown jump WKST weeks; Alt variants jump INTERVAL periods', () => {
    const f = '2026-01-07'; // Wednesday in the second rendered week
    expect(moveFocusedKey(f, 'weekPrev', base, start, end)).toBe('2025-12-29'); // MO week anchor
    expect(moveFocusedKey(f, 'weekNext', base, start, end)).toBe('2026-01-12');
    expect(moveFocusedKey(f, 'periodPrev', base, start, end)).toBe('2025-12-29'); // prior active band
    expect(moveFocusedKey(f, 'periodNext', base, start, end)).toBe('2026-01-12'); // next active band (+2w)
    // the period-jumped cell and the drag paint share period membership:
    expect(periodDaysForKey(base, moveFocusedKey(f, 'periodNext', base, start, end)))
      .toEqual(['2026-01-12','2026-01-13','2026-01-14','2026-01-15','2026-01-16','2026-01-17','2026-01-18']);
    // jumping again from the new active band moves a full INTERVAL forward
    const landed = moveFocusedKey(f, 'periodNext', base, start, end);
    expect(moveFocusedKey(landed, 'periodNext', base, start, end)).toBe('2026-01-26');
  });

  it('grid columns are WKST weeks even for Sunday-start rules', () => {
    const su = r(WEEKLY_SU);
    const weeks = gridWeeks('2025-12-28', '2026-01-17');
    expect(weeks[0]).toEqual(['2025-12-28','2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02','2026-01-03']);
    expect(weeks[1][0]).toBe('2026-01-04');
    // header order rotates by WKST: SU first (index 6), MO last
    expect(weekdayHeaderOrder(SU)).toEqual([6,0,1,2,3,4,5]);
    expect(weekdayHeaderOrder(MO)).toEqual([0,1,2,3,4,5,6]);
    void su;
  });

  it('locale changes only labels, not column order or period math', () => {
    const de = weekdayShortLabel(0, 'de');
    const ar = weekdayShortLabel(0, 'ar');
    const ja = weekdayShortLabel(6, 'ja');
    expect(de).not.toBe(ar);
    expect(de).toBeTruthy();
    expect(ja).toBeTruthy();
    // regardless of locale, header order is driven solely by WKST
    expect(weekdayHeaderOrder(SU)).toEqual([6,0,1,2,3,4,5]);
    // and every day in a swept range maps to one fixed MO-anchored period
    const swept = sweepDays('2025-12-29', '2026-01-04');
    expect(new Set(swept.slice(0, 7).map((k) => periodKeyOf(base, k)))).toEqual(new Set(['2025-12-29']));
  });
});

function periodKeyOf(rule: Rule, key: string) {
  return periodDaysForKey(rule, key)[0];
}

describe('active bands and selection -> rule derivation', () => {
  const base = r(BIWEEKLY_MO);
  it('marks alternating bands active for INTERVAL=2 (incl. cross-year band)', () => {
    const bands = activePeriodKeys(base, '2025-12-29', '2026-02-02');
    expect([...bands]).toEqual(['2025-12-29', '2026-01-12', '2026-01-26']);
  });
  it('painting MO,WE,FR across two active bands derives BYDAY=MO,WE,FR and INTERVAL=2', () => {
    const days = normalize([
      ...['2025-12-29','2025-12-31','2026-01-02'],
      ...['2026-01-12','2026-01-14','2026-01-16'],
    ]);
    const shape = selectionToRule(base, days);
    expect(shape.byday).toEqual([0, 2, 4]);
    expect(shape.gapPeriods).toBe(2);
    const derived = ruleFromSelection(base, days);
    expect(derived.interval).toBe(2);
    expect(derived.byday).toEqual([0, 2, 4]);
    expect(derived.dtstart).toMatchObject({y: 2025, m: 12, d: 29, h: 9, mi: 0});
  });
  it('flags a selection stretched over an off-week gap', () => {
    const days = normalize(['2025-12-29', '2026-01-05']); // two consecutive Mondays
    const shape = selectionToRule(base, days);
    expect(shape.spansInactiveGap).toBe(true);
    expect(shape.gapPeriods).toBe(1);
  });
  it('toggle preserves deterministic sorted keys', () => {
    let s = normalize([]);
    s = toggleDay(s, '2026-01-07');
    s = toggleDay(s, '2026-01-05');
    expect(s).toEqual(['2026-01-05', '2026-01-07']);
    s = toggleDay(s, '2026-01-05');
    expect(s).toEqual(['2026-01-07']);
  });
});

describe('runtime WKST switch re-interprets unsaved selection', () => {
  it('day keys are preserved but periods re-anchor, with an explicit change notice', () => {
    const mo = r(BIWEEKLY_MO);
    // Thu Jan1..Sat Jan3 are all in the MO week of Dec29.
    const days = normalize(['2026-01-01', '2026-01-02', '2026-01-03']);
    const {rule: next, notice} = reinterpretForWkst(mo, days, SU);
    expect(next.wkst).toBe(SU);
    // the picked calendar days themselves never move
    expect(days).toEqual(['2026-01-01','2026-01-02','2026-01-03']);
    expect(notice.oldAnchors).toEqual(['2025-12-29']);
    // under SU all three belong to the Sunday Dec28 week
    expect(notice.newAnchors).toEqual(['2025-12-28']);
    expect(notice.anchorsMoved.map((m) => m.day)).toEqual(['2026-01-01','2026-01-02','2026-01-03']);
    expect(notice.anchorsMoved.every((m) => m.oldPeriod === '2025-12-29' && m.newPeriod === '2025-12-28')).toBe(true);
    // BYDAY remains the same weekdays (MO-based)
    expect(next.byday).toEqual(selectionToRule(mo, days).byday);
  });
  it('switching WKST can split one MO week across two SU weeks', () => {
    const mo = r(BIWEEKLY_MO);
    // Fri Jan2 (MO week Dec29) + Mon Jan5 (MO week Jan5)
    const days = normalize(['2026-01-02', '2026-01-05']);
    const {notice} = reinterpretForWkst(mo, days, SU);
    expect(notice.oldAnchors).toEqual(['2025-12-29', '2026-01-05']);
    // under SU: Fri Jan2 -> Dec28 week; Mon Jan5 -> Jan4 week
    expect(notice.newAnchors).toEqual(['2025-12-28', '2026-01-04']);
  });
  it('switching an identical WKST is a no-op at the call site', () => {
    const mo = r(BIWEEKLY_MO);
    const {rule: next, notice} = reinterpretForWkst(mo, ['2025-12-29'], MO);
    expect(next.wkst).toBe(MO);
    expect(notice.anchorsMoved).toEqual([]);
  });
  it('biweekly stride is recomputed when painted weeks change spacing under new WKST', () => {
    const mo = r(BIWEEKLY_MO);
    // Mondays of two active MO bands: Dec29 and Jan12 (2 weeks apart)
    const days = normalize(['2025-12-29','2026-01-12']);
    const {rule: next, notice} = reinterpretForWkst(mo, days, SU);
    // under SU those days anchor Dec28 and Jan11 -> still 2 weeks apart
    expect(notice.oldStride).toBe(2);
    expect(next.interval).toBe(2);
  });
});

describe('refresh does not drift', () => {
  it('default selection reconstructed from the rule equals server BYDAY in first active period', () => {
    const mo = r(BIWEEKLY_MO);
    expect(defaultSelection(mo)).toEqual(['2025-12-29','2025-12-31','2026-01-02']);
    const su = r(WEEKLY_SU);
    expect(defaultSelection(su)).toEqual(['2026-01-03','2026-01-04']); // Sat, Sun in first SU week
  });
  it('saved selection -> rule -> text -> re-parsed rule yields the same default selection', () => {
    const base = r(BIWEEKLY_MO);
    const days = normalize([
      ...['2025-12-29','2025-12-31','2026-01-02'],
      ...['2026-01-12','2026-01-14','2026-01-16'],
    ]);
    const saved = ruleFromSelection(base, days);
    const reparsed = r(serializeRule(saved));
    expect(defaultSelection(reparsed)).toEqual(['2025-12-29','2025-12-31','2026-01-02']);
    expect(reparsed.interval).toBe(2);
    expect(reparsed.wkst).toBe(MO);
  });
});

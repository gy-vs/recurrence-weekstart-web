// Selection & period logic for the weekly grid.
// Pure functions only — the React UI, pointer drag and keyboard handler all
// call the SAME primitives, so keyboard navigation and mouse drag can never
// disagree about which period a day belongs to.
import {
  addDays, compareWall, dayKey, diffDays, keyToWall, periodKey,
  weekAnchorDate, weekAnchorKey, weekdayOf, WEEKDAY_TOKENS,
  type Rule, type WallDateTime, type Weekday,
} from './rrule';

export type DaySet = string[]; // sorted unique wall-day keys

export function normalize(days: Iterable<string>): DaySet {
  return [...new Set(days)].sort();
}
export function addDay(days: DaySet, key: string): DaySet {
  return days.includes(key) ? days : normalize([...days, key]);
}
export function toggleDay(days: DaySet, key: string): DaySet {
  return days.includes(key) ? days.filter((d) => d !== key) : normalize([...days, key]);
}
/** Inclusive sweep between two cell keys (drag rectangle reduces to a day sweep). */
export function sweepDays(fromKey: string, toKey: string): DaySet {
  const lo = fromKey <= toKey ? fromKey : toKey;
  const hi = fromKey <= toKey ? toKey : fromKey;
  const days: DaySet = [];
  for (let d = lo; d <= hi; d = dayKey(addDays(keyToWall(d), 1))) days.push(d);
  return days;
}
export function mergeSweep(days: DaySet, fromKey: string, toKey: string): DaySet {
  return normalize([...days, ...sweepDays(fromKey, toKey)]);
}

/** One grid column = the WKST week containing every one of its 7 days. */
export function gridWeeks(gridStartKey: string, gridEndKey: string): DaySet[] {
  const weeks: DaySet[] = [];
  for (let anchor = gridStartKey; anchor <= gridEndKey; anchor = dayKey(addDays(keyToWall(anchor), 7))) {
    const days: DaySet = [];
    for (let i = 0; i < 7; i++) days.push(dayKey(addDays(keyToWall(anchor), i)));
    weeks.push(days);
  }
  return weeks;
}

// ---------- active-period bands (INTERVAL weeks on, others off) ----------

export function activePeriodKeys(rule: Rule, gridStartKey: string, gridEndKey: string): Set<string> {
  const anchor0Key = dayKey(weekAnchorDate(rule.wkst, rule.dtstart));
  const set = new Set<string>();
  for (let anchor = gridStartKey; anchor <= gridEndKey; anchor = dayKey(addDays(keyToWall(anchor), 7))) {
    const weeks = diffDays(anchor, anchor0Key) / 7;
    if (weeks >= 0 && Number.isInteger(weeks) && Math.floor(weeks / rule.interval) * rule.interval === weeks) set.add(anchor);
  }
  return set;
}
export function isActivePeriod(rule: Rule, key: string): boolean {
  const weeks = diffDays(weekAnchorKey(rule.wkst, key), weekAnchorKey(rule.wkst, dayKey(rule.dtstart))) / 7;
  return weeks >= 0 && Number.isInteger(weeks) && Math.floor(weeks / rule.interval) * rule.interval === weeks;
}
export function periodAnchorOf(rule: Rule, key: string): string {
  return periodKey(rule.wkst, keyToWall(key));
}

// ---------- selection -> rule ----------

export type SelectionShape = {
  byday: Weekday[];                 // MO=0..SU=6
  dtstart: WallDateTime;
  anchors: string[];               // WKST week anchors touched (sorted unique)
  gapPeriods: number;              // INTERVAL-equivalent stride between anchors
  spansInactiveGap: boolean;       // selection stretched over an off band
  crossesYearWeek: boolean;
};

/**
 * Interpret the painted days as a WEEKLY rule. BYDAY is the set of MO-based
 * weekdays selected; the period stride is derived from the WKST-week anchors
 * the selection occupies. Everything here is keyed off the rule WKST, so the
 * same day keys always yield the same rule regardless of browser locale.
 */
export function selectionToRule(base: Rule, days: DaySet): SelectionShape {
  if (!days.length) {
    return {byday: base.byday, dtstart: base.dtstart, anchors: [], gapPeriods: base.interval, spansInactiveGap: false, crossesYearWeek: false};
  }
  const byday = [...new Set(days.map((k) => weekdayOf(keyToWall(k))))].sort((a, b) => a - b);
  const anchors = normalize(days.map((k) => periodKey(base.wkst, keyToWall(k))));
  const first = days[0];
  const firstWall = keyToWall(first);
  const dtstart: WallDateTime = {...firstWall, h: base.dtstart.h, mi: base.dtstart.mi};

  const anchorWeeks = anchors.map((a) => diffDays(a, anchors[0]) / 7);
  const gaps = anchorWeeks.slice(1).map((w, i) => w - anchorWeeks[i]);
  const stride = gaps.length ? Math.max(...gaps) : 1;
  // An off-week gap is any stretch where the painted anchors skip week(s) that
  // the CURRENT rule would render as an active band boundary — i.e. the
  // selection is denser (consecutive weeks) than the rule's interval.
  const spansInactiveGap = gaps.some((g) => g > 1) ||
    (base.interval > 1 && gaps.some((g) => g < base.interval));

  const crossesYearWeek = days.some((k) => {
    const w = keyToWall(k);
    const anchor = weekAnchorDate(base.wkst, w);
    const end = addDays(anchor, 6);
    return anchor.y !== end.y;
  });
  return {byday, dtstart, anchors, gapPeriods: Math.max(1, stride), spansInactiveGap, crossesYearWeek};
}

export function ruleFromSelection(base: Rule, days: DaySet): Rule {
  const shape = selectionToRule(base, days);
  return {
    ...base,
    byday: shape.byday.length ? shape.byday : base.byday,
    dtstart: shape.dtstart,
    interval: shape.anchors.length > 1 ? shape.gapPeriods : base.interval,
  };
}

/**
 * Default selection after load/refresh: the earliest on/after-DTSTART
 * occurrence for each BYDAY weekday (the server expands the exact same set).
 * For WKST=SU with DTSTART=Saturday this means Sat of week 0 and Sun of week 1.
 */
export function defaultSelection(rule: Rule): DaySet {
  const startDay = dayKey(rule.dtstart);
  const seen = new Map<number, string>();
  // Search the first couple of weeks so wrap-around weekdays (e.g. Sunday
  // after a Saturday DTSTART under WKST=SU) are included.
  const anchor = weekAnchorDate(rule.wkst, rule.dtstart);
  for (let w = 0; w < 2; w++) {
    for (const wd of rule.byday) {
      if (seen.has(wd)) continue;
      const key = dayKey(addDays(anchor, w * 7 + (wd - rule.wkst + 7) % 7));
      if (key >= startDay) seen.set(wd, key);
    }
  }
  return normalize([...seen.values()]);
}

// ---------- re-interpret unsaved selection when WKST changes ----------

export type WkstChangeNotice = {
  oldWkst: Weekday;
  newWkst: Weekday;
  oldAnchors: string[];
  newAnchors: string[];
  anchorsMoved: {day: string; oldPeriod: string; newPeriod: string}[];
  strideChanged: boolean;
  oldStride: number;
  newStride: number;
  intervalSuggestion: number;
};

/**
 * Re-anchor the SAME painted day keys under a new WKST. Day keys are preserved
 * (the user's picked calendar days do not move); only period membership and
 * the derived stride change. Returns an explicit notice for the UI.
 */
export function reinterpretForWkst(oldRule: Rule, days: DaySet, newWkst: Weekday): {rule: Rule; notice: WkstChangeNotice} {
  const oldShape = selectionToRule(oldRule, days);
  const tempRule: Rule = {...oldRule, wkst: newWkst};
  const newShape = selectionToRule(tempRule, days);
  const anchorsMoved = days.map((day) => ({
    day,
    oldPeriod: periodKey(oldRule.wkst, keyToWall(day)),
    newPeriod: periodKey(newWkst, keyToWall(day)),
  })).filter((x) => x.oldPeriod !== x.newPeriod);
  const newInterval = newShape.anchors.length > 1 ? newShape.gapPeriods : oldRule.interval;
  return {
    rule: {
      ...tempRule,
      byday: newShape.byday.length ? newShape.byday : oldRule.byday,
      dtstart: newShape.dtstart,
      interval: newInterval,
    },
    notice: {
      oldWkst: oldRule.wkst,
      newWkst,
      oldAnchors: oldShape.anchors,
      newAnchors: newShape.anchors,
      anchorsMoved,
      strideChanged: oldShape.gapPeriods !== newShape.gapPeriods || newInterval !== oldRule.interval,
      oldStride: oldShape.anchors.length > 1 ? oldShape.gapPeriods : oldRule.interval,
      newStride: newInterval,
      intervalSuggestion: newInterval,
    },
  };
}

// ---------- keyboard navigation (same period math as the pointer path) ----------

export type Move = 'left' | 'right' | 'up' | 'down' | 'weekPrev' | 'weekNext' | 'periodPrev' | 'periodNext' | 'periodStart' | 'periodEnd';

/** Move a focused cell. Horizontal = adjacent day; vertical = same weekday one WKST-week away. */
export function moveFocusedKey(focusKey: string, move: Move, rule: Rule, gridStartKey: string, gridEndKey: string): string {
  const wall = keyToWall(focusKey);
  const anchor0 = weekAnchorDate(rule.wkst, rule.dtstart);
  const anchor0Key = dayKey(anchor0);
  /** Active-band slot of the week containing `key` (k where active bands are anchor0 + k*interval weeks). */
  const activeSlotOf = (key: string): number => {
    const weeks = diffDays(weekAnchorKey(rule.wkst, key), anchor0Key) / 7;
    return weeks < 0 ? -1 : Math.floor(weeks / rule.interval);
  };
  let next = focusKey;
  switch (move) {
    case 'left': next = dayKey(addDays(wall, -1)); break;
    case 'right': next = dayKey(addDays(wall, 1)); break;
    case 'up': next = dayKey(addDays(wall, -7)); break;
    case 'down': next = dayKey(addDays(wall, 7)); break;
    case 'weekPrev': next = weekAnchorKey(rule.wkst, dayKey(addDays(wall, -7))); break;
    case 'weekNext': next = weekAnchorKey(rule.wkst, dayKey(addDays(wall, 7))); break;
    // Period jumps land on ACTIVE bands (anchor0 + k*interval weeks), regardless
    // of whether focus currently sits in an on or off week.
    case 'periodPrev':
      next = dayKey(addDays(anchor0, Math.max(0, activeSlotOf(focusKey) - 1) * 7 * rule.interval));
      break;
    case 'periodNext':
      next = dayKey(addDays(anchor0, (activeSlotOf(focusKey) + 1) * 7 * rule.interval));
      break;
    case 'periodStart': next = periodKey(rule.wkst, wall); break;
    case 'periodEnd': next = dayKey(addDays(weekAnchorDate(rule.wkst, wall), 6)); break;
  }
  if (next < gridStartKey) next = gridStartKey;
  if (next > gridEndKey) next = gridEndKey;
  return next;
}

/** Select an entire active period from any cell in it (used by Shift+Enter etc.). */
export function periodDaysForKey(rule: Rule, key: string): DaySet {
  const anchor = periodKey(rule.wkst, keyToWall(key));
  return Array.from({length: 7}, (_, i) => dayKey(addDays(keyToWall(anchor), i)));
}

export function describeSelection(shape: SelectionShape): string {
  if (!shape.anchors.length) return '';
  const tokens = shape.byday.map((d) => WEEKDAY_TOKENS[d]).join(',');
  const weeks = shape.anchors.length;
  return `BYDAY=${tokens} over ${weeks} week${weeks === 1 ? '' : 's'}` +
    (shape.gapPeriods > 1 && shape.anchors.length > 1 ? `; INTERVAL≈${shape.gapPeriods}` : '') +
    (shape.spansInactiveGap ? '; spans an off-week gap' : '') +
    (shape.crossesYearWeek ? '; includes a cross-year week' : '');
}

export function clampToWindow(key: string, lo: string, hi: string): string {
  return key < lo ? lo : key > hi ? hi : key;
}

export {compareWall};

import {useCallback, useEffect, useRef} from 'react';
import {
  WEEKDAY_TOKENS, type Rule, type Weekday,
} from '../shared/rrule';
import {
  activePeriodKeys, gridWeeks, moveFocusedKey, normalize, periodDaysForKey,
  sweepDays, toggleDay, type DaySet, type Move,
} from '../shared/selection';
import {
  dayCellLabel, instantInZone, monthLabel, weekdayHeaderOrder, weekdayShortLabel,
  zoneOffsetLabel,
} from '../shared/labels';
import type {PreviewBundle} from '../shared/rrule';

type Props = {
  bundle: PreviewBundle;
  rule: Rule;
  selection: DaySet;
  focusKey: string;
  locale: string;
  onSelectionChange: (next: DaySet) => void;
  onSelectionCommit: (next: DaySet) => void;
  onFocusChange: (key: string) => void;
};

export default function WeekGrid({bundle, rule, selection, focusKey, locale, onSelectionChange, onSelectionCommit, onFocusChange}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const weeks = gridWeeks(bundle.grid.start, bundle.grid.end);
  const rowOrder = weekdayHeaderOrder(rule.wkst);
  const active = activePeriodKeys(rule, bundle.grid.start, bundle.grid.end);
  const occByDate = new Map(bundle.occurrences.map((o) => [o.date, o]));
  const periodIndexByAnchor = new Map(bundle.occurrences.map((o) => [o.periodKey, o.periodIndex]));
  const selSet = new Set(selection);

  // --- pointer drag -------------------------------------------------------
  const drag = useRef<{from: string; base: DaySet; moved: boolean} | null>(null);

  useEffect(() => {
    function dayAt(clientX: number, clientY: number): string | null {
      const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-day]');
      return el?.dataset.day ?? null;
    }
    function onMove(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      const key = dayAt(e.clientX, e.clientY);
      if (!key || key === d.from) return;
      d.moved = true;
      const removing = d.base.includes(d.from);
      const swept = sweepDays(d.from, key);
      const next = removing ? normalize(d.base.filter((k) => !swept.includes(k))) : normalize([...d.base, ...swept]);
      onSelectionChange(next);
    }
    function onUp() {
      const d = drag.current;
      drag.current = null;
      document.body.classList.remove('dragging-weekgrid');
      if (!d) return;
      if (!d.moved) onSelectionCommit(toggleDay(d.base, d.from));
      else onSelectionCommit(selectionRef.current);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);};
  }, [onSelectionChange, onSelectionCommit]);
  const selectionRef = useRef<DaySet>(selection);
  selectionRef.current = selection;

  const onCellPointerDown = useCallback((key: string) => (e: React.PointerEvent) => {
    // No preventDefault: native click focuses the cell (roving tabindex).
    drag.current = {from: key, base: selectionRef.current, moved: false};
    document.body.classList.add('dragging-weekgrid');
    onFocusChange(key);
  }, [onFocusChange]);

  // --- keyboard (same movement/period primitives as pointer) --------------
  const extend = useRef<{anchor: string; base: DaySet} | null>(null);
  const onKeyDown = (key: string) => (e: React.KeyboardEvent) => {
    const map: Record<string, Move> = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      PageUp: e.altKey ? 'periodPrev' : 'weekPrev',
      PageDown: e.altKey ? 'periodNext' : 'weekNext',
      Home: 'periodStart', End: 'periodEnd',
    };
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectionCommit(toggleDay(selectionRef.current, key));
      extend.current = null;
      return;
    }
    const move = map[e.key];
    if (!move) return;
    e.preventDefault();
    const target = moveFocusedKey(key, move, rule, bundle.grid.start, bundle.grid.end);
    focusCell(target);
    if (e.shiftKey) {
      if (!extend.current) extend.current = {anchor: key, base: selectionRef.current};
      const swept = sweepDays(extend.current.anchor, target);
      onSelectionChange(normalize([...extend.current.base, ...swept]));
    } else {
      extend.current = null;
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => { if (e.key === 'Shift') extend.current = null; };

  const jump = (move: Move) => {
    const target = moveFocusedKey(focusKey, move, rule, bundle.grid.start, bundle.grid.end);
    onFocusChange(target);
  };

  // Keep the keyboard-focused cell visible and programmatically focused when
  // the focus key moved via arrows or jump buttons (never reorders columns).
  useEffect(() => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-day="${focusKey}"]`);
    if (!el) return;
    el.scrollIntoView({block:'nearest', inline:'center', behavior:'auto'});
    const ae = document.activeElement as HTMLElement | null;
    if (ae !== el && ae && gridRef.current?.contains(ae)) el.focus({preventScroll:true});
  }, [focusKey]);

  const focusCell = (key: string) => {
    onFocusChange(key);
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`)?.focus({preventScroll:false});
  };

  return (
    <div className="grid-wrap">
      <div className="grid-jumpbar">
        <button type="button" onClick={() => jump('weekPrev')} title="PageUp">‹ Week ({WEEKDAY_TOKENS[rule.wkst]} start)</button>
        <button type="button" onClick={() => jump('weekNext')} title="PageDown">Week ›</button>
        <button type="button" onClick={() => jump('periodPrev')} title="Alt+PageUp">‹ Period ({rule.interval}w)</button>
        <button type="button" onClick={() => jump('periodNext')} title="Alt+PageDown">Period ›</button>
        <span className="period-readout" aria-live="polite">
          focused <code>{focusKey}</code> · period <code>{bundle.occurrences.find((o) => o.date === focusKey)?.periodKey ?? weekPeriodKey(rule, focusKey)}</code>
        </span>
      </div>
      <div className="grid-scroll" ref={gridRef} onKeyUp={onKeyUp}>
        <div className="weekgrid" role="grid" aria-rowcount={8} aria-colcount={weeks.length + 1}>
          <div role="row" className="wg-row wg-head">
            <div role="columnheader" className="wg-corner">WKST {WEEKDAY_TOKENS[rule.wkst]}</div>
            {weeks.map((days) => {
              const anchor = days[0];
              const isActive = active.has(anchor);
              return (
                <div role="columnheader" className={'wg-colhead' + (isActive ? ' active' : '')} key={anchor}>
                  <span className="wg-col-date">{dayCellLabel(anchor, locale).month} {dayCellLabel(anchor, locale).day}</span>
                  <span className="wg-col-period" title={isActive ? 'active period anchor' : 'off week'}>
                    {isActive ? `#${periodIndexByAnchor.get(anchor) ?? '·'}` : 'off'}
                  </span>
                </div>
              );
            })}
          </div>
          {rowOrder.map((wd: Weekday, rowIdx) => (
            <div role="row" className="wg-row" key={wd}>
              <div role="rowheader" className="wg-rowhead">
                <strong>{weekdayShortLabel(wd, locale)}</strong>
                <small>{WEEKDAY_TOKENS[wd]}</small>
              </div>
              {weeks.map((days) => {
                const day = days[rowIdx];
                const anchor = days[0];
                const isActive = active.has(anchor);
                const selected = selSet.has(day);
                const occ = occByDate.get(day);
                const focused = day === focusKey;
                const label = dayCellLabel(day, locale);
                return (
                  <div
                    role="gridcell"
                    key={day}
                    data-day={day}
                    tabIndex={focused ? 0 : -1}
                    aria-selected={selected}
                    aria-label={`${weekdayShortLabel(wd, locale)} ${label.month} ${label.day} ${label.year}${selected ? ', selected' : ''}${occ ? ', occurrence' : ''}`}
                    title={occ
                      ? `${monthLabel(day, locale)} · ${occ.periodKey} (#${occ.periodIndex}) · ${instantInZone(occ.instant, rule.zone, locale)} ${zoneOffsetLabel(rule.zone, occ.instant, locale)}`
                      : `${monthLabel(day, locale)} · period ${anchor}${isActive ? ' (active)' : ' (off week)'}`}
                    className={
                      'wg-cell' +
                      (isActive ? ' band' : '') +
                      (selected ? ' selected' : '') +
                      (occ ? ' occurrence' : '') +
                      (focused ? ' focus' : '')
                    }
                    onPointerDown={onCellPointerDown(day)}
                    onKeyDown={onKeyDown(day)}
                    onFocus={() => onFocusChange(day)}
                  >
                    <span className="wg-num">{label.day}</span>
                    {occ && <span className="wg-dot" aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function weekPeriodKey(rule: Rule, key: string): string {
  // Mirror of periodKey for columns without occurrences (off weeks).
  return periodDaysForKey(rule, key)[0];
}

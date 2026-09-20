import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlaskConical, Play, Save} from 'lucide-react';
import {
  parseRule, ruleFromPreview, serializeRule, RuleError, WEEKDAY_BY_TOKEN, WEEKDAY_TOKENS,
  type Diagnostic, type PreviewBundle, type Rule, type Weekday,
} from '../shared/rrule';
import {
  defaultSelection, describeSelection, reinterpretForWkst, ruleFromSelection,
  selectionToRule, type DaySet, type WkstChangeNotice,
} from '../shared/selection';
import {SUPPORTED_LOCALES, weekdayLongLabel} from '../shared/labels';
import WeekGrid from './WeekGrid';

type Summary = {id:string;name:string;revision:number;updatedAt:string};
type Row = Summary & {content:string};

const ZONES = ['UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Pacific/Auckland'];

export default function App(){
  const [items,setItems]=useState<Summary[]>([]);
  const [selected,setSelected]=useState('alpha');
  const [row,setRow]=useState<Row|null>(null);
  const [draft,setDraft]=useState('');
  const [analysis,setAnalysis]=useState<unknown>(null);
  const [status,setStatus]=useState('Ready');

  const [bundle,setBundle]=useState<PreviewBundle|null>(null);
  const [rule,setRule]=useState<Rule|null>(null);
  const [parseErrors,setParseErrors]=useState<Diagnostic[]>([]);
  const [selection,setSelection]=useState<DaySet>([]);
  const [focusKey,setFocusKey]=useState('');
  const [wkstNotice,setWkstNotice]=useState<WkstChangeNotice|null>(null);
  const [intervalWarn,setIntervalWarn]=useState('');
  const [locale,setLocale]=useState(()=>localStorage.getItem('rr-locale') ?? 'en');
  const [zoneOverride,setZoneOverride]=useState<string|null>(null);

  useEffect(()=>{fetch('/api/schedules').then(r=>r.json()).then(setItems)},[]);

  // Load a schedule: server rule becomes authoritative, selection reset from
  // the server-anchored first active period — same after refresh, no drift.
  useEffect(()=>{
    setStatus('Loading'); setBundle(null); setWkstNotice(null); setIntervalWarn(''); setZoneOverride(null);
    fetch('/api/schedules/'+selected).then(r=>r.json()).then((value:Row)=>{
      setRow(value); setDraft(value.content); setStatus('Loaded');
    });
  },[selected]);

  // Request an authoritative preview whenever the draft changes.
  const previewSeq = useRef(0);
  const keepSel = useRef<DaySet|null>(null);
  const requestPreview = useCallback(async(content:string)=>{
    try { parseRule(content); }
    catch (error) {
      if (error instanceof RuleError) { setParseErrors(error.diagnostics); setRule(null); setBundle(null); }
      return;
    }
    setParseErrors([]);
    const seq = ++previewSeq.current;
    setStatus('Previewing');
    const response = await fetch('/api/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content})});
    if (!response.ok) { setStatus('Preview failed'); return; }
    const next: PreviewBundle = await response.json();
    if (seq !== previewSeq.current) return; // stale response, ignore
    // The authoritative rule is reconstructed from the SERVER bundle, so the
    // grid/drag/keyboard all run on the server's CalendarConfig.
    const serverRule = ruleFromPreview(next);
    setBundle(next);
    setRule(serverRule);
    const kept = keepSel.current; keepSel.current = null;
    const init = kept ? kept.filter((k) => k >= next.grid.start && k <= next.grid.end) : defaultSelection(serverRule);
    setSelection(init);
    setFocusKey((cur) => {
      if (cur && cur >= next.grid.start && cur <= next.grid.end) return cur;
      return init[0] ?? next.occurrences[0]?.date ?? next.grid.start;
    });
    setStatus('Preview ready');
  },[]);

  useEffect(()=>{ if (draft !== '') void requestPreview(draft); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },[draft]);

  // Editing the rule re-requests the server preview; keepSel preserves painted
  // day keys across the roundtrip (used by WKST re-interpretation and commits).
  const pushRule = useCallback((next: Rule, opts?:{keepSelection?:DaySet})=>{
    setWkstNotice(null);
    if (opts?.keepSelection) keepSel.current = opts.keepSelection;
    setDraft(serializeRule(next));
  },[]);

  // --- selection -> live rule --------------------------------------------
  const onSelectionCommit = useCallback((next: DaySet)=>{
    if (!rule) return;
    setSelection(next);
    const shape = selectionToRule(rule, next);
    setIntervalWarn(shape.spansInactiveGap
      ? `Selection spans an off-week gap (INTERVAL=${rule.interval}). BYDAY ${shape.byday.map(d=>WEEKDAY_TOKENS[d]).join(',')} is taken from the painted days; the saved stride becomes ${shape.gapPeriods} weeks.`
      : (shape.crossesYearWeek ? 'Selection includes a week that crosses the year boundary; periods are anchored by WKST, not by calendar year.' : ''));
    if (!next.length) return;
    pushRule(ruleFromSelection(rule, next), {keepSelection: next});
  },[rule,pushRule]);

  // --- WKST switching: re-interpret the SAME day keys, explicit notice ----
  const changeWkst = (newWkst: Weekday)=>{
    if (!rule || newWkst === rule.wkst) return;
    const days = selection.length ? selection : defaultSelection(rule);
    const {rule: next, notice} = reinterpretForWkst(rule, days, newWkst);
    setWkstNotice(notice);
    setSelection(days); // day keys unchanged; their period bands move
    pushRule(next, {keepSelection: days});
  };

  const changeField = (patch: Partial<Rule>)=>{
    if (!rule) return;
    setWkstNotice(null);
    pushRule({...rule,...patch});
  };
  const changeZone = (zone:string)=>{ if(!rule)return; setZoneOverride(zone); pushRule({...rule,zone}); };

  async function save(){
    if(!row)return;
    setStatus('Saving');
    const response=await fetch('/api/schedules/'+row.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({content:draft,revision:row.revision})});
    const value=await response.json();
    if(!response.ok){setStatus('Revision conflict');return}
    setRow(value); setStatus('Saved');
  }
  async function analyze(){
    if(!row)return;
    setStatus('Analyzing');
    const response=await fetch('/api/schedules/'+row.id+'/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:draft})});
    setAnalysis(await response.json()); setStatus('Ready');
  }

  const resetSelection = ()=>{ if(rule){setSelection(defaultSelection(rule));setIntervalWarn('');} };
  const shape = useMemo(()=> rule ? selectionToRule(rule, selection) : null, [rule, selection]);

  return (
    <main className="shell">
      <header className="topbar">
        <FlaskConical size={20}/><strong>Recurrence Rule Studio</strong>
        <span className="spacer"/>
        <label className="locale-pick">
          Locale (labels only)
          <select value={locale} onChange={(e)=>{setLocale(e.target.value);localStorage.setItem('rr-locale',e.target.value)}}>
            {SUPPORTED_LOCALES.map((l)=><option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <small>Local workspace</small>
      </header>
      <section className="workspace">
        <aside className="pane">
          <h2>Items</h2>
          <div className="list">
            {items.map(item=><button className={item.id===selected?'active':''} onClick={()=>setSelected(item.id)} key={item.id}>
              {item.name}<br/><small>Revision {item.revision}</small>
            </button>)}
          </div>
        </aside>

        <section className="pane editor-pane">
          <div className="toolbar">
            <button className="primary" onClick={save}><Save size={15}/>Save</button>
            <button onClick={analyze}><Play size={15}/>Analyze</button>
            <span>{status}</span>
          </div>

          {rule && (
            <div className="rule-controls">
              <fieldset className="wkst-control">
                <legend>WKST — week starts on (server-authoritative)</legend>
                <div role="radiogroup" aria-label="WKST">
                  {WEEKDAY_TOKENS.map((tok)=>(
                    <button key={tok} role="radio" aria-checked={rule.wkst===WEEKDAY_BY_TOKEN[tok]}
                      className={rule.wkst===WEEKDAY_BY_TOKEN[tok]?'seg active':'seg'}
                      onClick={()=>changeWkst(WEEKDAY_BY_TOKEN[tok])}>
                      {tok}<br/><small>{weekdayLongLabel(tok,locale)}</small>
                    </button>
                  ))}
                </div>
              </fieldset>
              <label>INTERVAL (weeks)
                <input type="number" min={1} max={26} value={rule.interval}
                  onChange={(e)=>changeField({interval:Math.max(1,Number(e.target.value)||1)})}/>
              </label>
              <label>Start time (rule zone)
                <input type="time" value={`${String(rule.dtstart.h).padStart(2,'0')}:${String(rule.dtstart.mi).padStart(2,'0')}`}
                  onChange={(e)=>{const [h,mi]=e.target.value.split(':').map(Number);changeField({dtstart:{...rule.dtstart,h,mi}})}}/>
              </label>
              <label>Time zone
                <select value={zoneOverride ?? rule.zone} onChange={(e)=>changeZone(e.target.value)}>
                  {Array.from(new Set([...ZONES,rule.zone])).map(z=><option key={z} value={z}>{z}</option>)}
                </select>
              </label>
              <label>COUNT
                <input type="number" min={1} placeholder="unbounded" value={rule.count ?? ''}
                  onChange={(e)=>changeField({count:e.target.value===''?null:Math.max(1,Number(e.target.value)||1)})}/>
              </label>
              <button type="button" className="ghost" onClick={resetSelection}>Reset selection to rule</button>
            </div>
          )}

          {wkstNotice && (
            <div className="notice notice-wkst" role="alert">
              <strong>WKST changed {WEEKDAY_TOKENS[wkstNotice.oldWkst]} → {WEEKDAY_TOKENS[wkstNotice.newWkst]}.</strong>
              {' '}Picked days are unchanged, but their week ranges were re-interpreted under the new week start.
              {wkstNotice.anchorsMoved.length>0 && (
                <ul>
                  {wkstNotice.anchorsMoved.slice(0,6).map((m)=><li key={m.day}><code>{m.day}</code>: period {m.oldPeriod} → {m.newPeriod}</li>)}
                  {wkstNotice.anchorsMoved.length>6 && <li>…and {wkstNotice.anchorsMoved.length-6} more days</li>}
                </ul>
              )}
              {wkstNotice.anchorsMoved.length===0 && <div>No picked day crossed a week boundary.</div>}
              {wkstNotice.strideChanged && <div className="warn">Derived interval changed {wkstNotice.oldStride} → {wkstNotice.newStride} weeks; BYDAY/period alignment now matches the new WKST.</div>}
            </div>
          )}
          {intervalWarn && <div className="notice notice-warn" role="status">{intervalWarn}</div>}
          {parseErrors.length>0 && <div className="notice notice-err" role="alert">
            {parseErrors.map((d,i)=><div key={i}>line {d.line}: {d.message}</div>)}
          </div>}

          <textarea aria-label="Content" className={parseErrors.length?'invalid':''} value={draft} onChange={event=>setDraft(event.target.value)}/>
          {shape && <div className="selection-readout">{describeSelection(shape)}</div>}
        </section>

        <aside className="pane grid-pane">
          <h2>Occurrence grid</h2>
          {bundle && rule ? (
            <>
              <div className="cal-strip">
                <span className="pill">WKST {bundle.calendar.wkst}</span>
                <span className="pill">interval {rule.interval}w</span>
                <span className="pill">zone {bundle.calendar.zone}</span>
                <span className="pill muted">locale {locale} (labels only)</span>
              </div>
              <WeekGrid bundle={bundle} rule={rule} selection={selection} focusKey={focusKey} locale={locale}
                onSelectionChange={setSelection}
                onSelectionCommit={onSelectionCommit}
                onFocusChange={setFocusKey}/>
              <details className="occ-list" open>
                <summary>Server occurrences &amp; period keys ({bundle.occurrences.length})</summary>
                <ul>
                  {bundle.occurrences.slice(0,40).map((o)=>(
                    <li key={o.instant} className={selection.includes(o.date)?'sel':''}>
                      <code>{o.date}</code> {WEEKDAY_TOKENS[o.weekday]} · period <code>{o.periodKey}</code> #{o.periodIndex}
                      <small>{o.instant}</small>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : <p>Fix the rule text to render the grid.</p>}
        </aside>
      </section>
    </main>
  );
}

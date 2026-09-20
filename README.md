# Recurrence Rule Studio

Local workbench for WEEKLY occurrence sets, with a server-authoritative week calendar.

Run `npm install`, then `npm run dev` (API on :4174, Vite on :4173).

## Week model

- All week/period math lives in one place: `src/shared/rrule.ts` (imported by
  both the server preview API and the client grid). `src/shared/labels.ts` is
  the only module allowed to read a locale — it formats strings, never dates.
- `POST /api/preview` takes the rule text and returns:
  - `calendar` — `{wkst, weekStartsOn, zone}` the client must render against;
  - `occurrences[].periodKey` / `periodIndex` — the WKST-week anchor and band
    index every occurrence belongs to;
  - `grid.start/end` — the snapped wall-day window.
- The client reconstructs its rule from that bundle (`ruleFromPreview`); the
  browser locale changes column/day labels only. Drag painting and keyboard
  navigation share `src/shared/selection.ts`, so they can never disagree about
  which period a day is in.
- Changing WKST re-anchors the still-unsaved painted days and shows an exact
  notice listing which days moved between periods and whether the derived
  interval changed.

## Rule text

```
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;WKST=MO
DTSTART:20251229T090000
TZID:UTC
COUNT:12          # optional
```

Wall dates are in `TZID` (IANA, `UTC`, or fixed `UTC+09:00`); occurrence
instants are UTC ISO strings, so late-night wall times keep their wall period.

## Tests

`npm test` — 36 tests covering Sunday/Monday starts, cross-year weeks, multiple
locales, biweekly intervals, time-zone cross-midnight, runtime WKST switching,
keyboard/pointer period parity, and refresh stability.

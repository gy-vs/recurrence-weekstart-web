import {describe,expect,it} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/server/index';

const MO_RULE = 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;WKST=MO\nDTSTART:20251229T090000\nTZID:UTC\n';
const SU_RULE = 'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU;WKST=SU\nDTSTART:20260103T233000\nTZID:Asia/Tokyo\n';

describe('service',()=>{
  it('loads and conditionally updates a record',async()=>{
    const app=createApp();
    const before=await request(app).get('/api/schedules/alpha').expect(200);
    await request(app).put('/api/schedules/alpha').send({content:'updated',revision:before.body.revision}).expect(200);
    await request(app).put('/api/schedules/alpha').send({content:'stale',revision:before.body.revision}).expect(409);
  });
});

describe('POST /api/preview', () => {
  it('returns the calendar config and a periodKey for every occurrence (WKST=MO, biweekly)', async () => {
    const app = createApp();
    const res = await request(app).post('/api/preview')
      .send({content: MO_RULE, from: '2025-12-28T00:00:00Z', to: '2026-02-01T00:00:00Z'})
      .expect(200);
    expect(res.body.calendar).toEqual({wkst: 'MO', weekStartsOn: 0, zone: 'UTC'});
    expect(res.body.rule.interval).toBe(2);
    expect(res.body.rule.byday).toEqual(['MO','WE','FR']);
    expect(res.body.grid.start).toBe('2025-12-22'); // preview window snapped back to MO week
    const keys = res.body.occurrences.map((o: any) => o.periodKey);
    expect([...new Set(keys)]).toEqual(['2025-12-29','2026-01-12','2026-01-26']);
    for (const o of res.body.occurrences) {
      expect(o).toHaveProperty('periodIndex');
      expect(o.periodKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('honors WKST=SU and keeps wall dates in the rule zone (Tokyo late night is still its wall day)', async () => {
    const app = createApp();
    const res = await request(app).post('/api/preview')
      .send({content: SU_RULE, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z'})
      .expect(200);
    expect(res.body.calendar.wkst).toBe('SU');
    expect(res.body.calendar.zone).toBe('Asia/Tokyo');
    expect(res.body.grid.start).toBe('2025-12-28'); // Sunday-anchored
    const first = res.body.occurrences[0];
    expect(first.date).toBe('2026-01-03');
    expect(first.instant).toBe('2026-01-03T14:30:00.000Z'); // 23:30 Tokyo = 14:30 UTC
    // Saturday Jan 3 belongs to the Sunday Dec 28 week under WKST=SU
    expect(first.periodKey).toBe('2025-12-28');
    // Sunday Jan 4 anchors the NEXT Sunday-week (12/28 week runs Dec28..Jan3)
    const sun = res.body.occurrences.find((o: any) => o.date === '2026-01-04');
    expect(sun.periodKey).toBe('2026-01-04');
    // Saturday Jan 10 also belongs to the Jan 4 week
    const sat = res.body.occurrences.find((o: any) => o.date === '2026-01-10');
    expect(sat.periodKey).toBe('2026-01-04');
  });

  it('produces different band alignment for the same BYDAY under MO vs SU', async () => {
    const app = createApp();
    const common = 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;';
    const from = '2025-12-28T00:00:00Z', to = '2026-02-01T00:00:00Z';
    const mo = await request(app).post('/api/preview').send({content: common + 'WKST=MO\nDTSTART:20251229T090000\n', from, to}).expect(200);
    const su = await request(app).post('/api/preview').send({content: common + 'WKST=SU\nDTSTART:20251228T090000\n', from, to}).expect(200);
    const moAnchors = [...new Set(mo.body.occurrences.map((o: any) => o.periodKey))];
    const suAnchors = [...new Set(su.body.occurrences.map((o: any) => o.periodKey))];
    expect(moAnchors).toEqual(['2025-12-29','2026-01-12','2026-01-26']);
    expect(suAnchors).toEqual(['2025-12-28','2026-01-11','2026-01-25']);
  });

  it('returns 422 diagnostics for invalid rules instead of crashing', async () => {
    const app = createApp();
    const res = await request(app).post('/api/preview').send({content: 'RRULE:FREQ=WEEKLY;WKST=XX\nDTSTART:20260105T090000\n'}).expect(422);
    expect(res.body.error).toBe('invalid_rule');
    expect(Array.isArray(res.body.diagnostics)).toBe(true);
  });
});

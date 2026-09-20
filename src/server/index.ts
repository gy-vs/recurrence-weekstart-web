import express from 'express';
import {fileURLToPath} from 'node:url';
import {calendarConfig,parseRule,preview,type RuleDoc,type Weekday} from '../shared/calendar';

type RecordRow = {id:string;name:string;revision:number;content:string;updatedAt:string};
const rows: RecordRow[] = [
  {
    id:'alpha',
    name:'Primary occurrence sets',
    revision:3,
    content:'DTSTART;TZID=Asia/Shanghai:20260105T090000\nRRULE:FREQ=WEEKLY;INTERVAL=1;WKST=MO;BYDAY=MO,WE,FR',
    updatedAt:new Date(0).toISOString(),
  },
  {
    id:'beta',
    name:'Secondary occurrence sets',
    revision:5,
    content:'DTSTART;TZID=America/New_York:20251228T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=SU,SA',
    updatedAt:new Date(1000).toISOString(),
  },
];

export function createApp(){
  const app=express();
  app.use(express.json({limit:'1mb'}));

  // The calendar configuration the rule is evaluated with. The client is
  // required to render and select against THIS, never against its own locale.
  app.get('/api/recurrence/calendar',(req,res)=>{
    const wkst=String(req.query.wkst??'MO').toUpperCase() as Weekday;
    if(!['MO','TU','WE','TH','FR','SA','SU'].includes(wkst))return res.status(400).json({error:'bad_wkst'});
    res.json({source:'rule',localeAgnostic:true,calendar:calendarConfig(wkst)});
  });

  // Preview the raw (possibly unsaved) rule text. Returns the calendar config
  // plus the period key of every occurrence, so client grid/drag/jump all share
  // the server's grouping.
  app.post('/api/recurrence/preview',(req,res)=>{
    const content=String(req.body?.content??'');
    const {doc,diagnostics}=parseRule(content);
    if(!doc)return res.status(400).json({error:'invalid_rule',diagnostics});
    const result=preview(doc as RuleDoc);
    res.json({...result,diagnostics});
  });

  app.get('/api/bootstrap',(_req,res)=>res.json({family:"recurrence-rule",count:rows.length}));
  app.get('/api/schedules',(_req,res)=>res.json(rows.map(({content,...row})=>row)));
  app.get('/api/schedules/:id',(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});res.set('ETag',String(row.revision)).json(row)});
  app.put('/api/schedules/:id',(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});if(req.body.revision!==row.revision)return res.status(409).json({error:'revision_conflict',current:row});row.content=String(req.body.content??'');row.revision+=1;row.updatedAt=new Date().toISOString();res.json(row)});
  app.post('/api/schedules/:id/analyze',async(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});await new Promise(resolve=>setTimeout(resolve,req.params.id==='alpha'?100:20));const content=String(req.body.content??row.content);const {doc,diagnostics}=parseRule(content);res.json({id:row.id,revision:row.revision,lines:content.split(/\r?\n/).length,diagnostics,preview:doc?preview(doc):null})});
  return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){createApp().listen(4174,'127.0.0.1',()=>console.log('server http://127.0.0.1:4174'))}

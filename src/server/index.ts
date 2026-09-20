import express from 'express';
import {fileURLToPath} from 'node:url';
import {buildPreview, parseRule, RuleError, type PreviewBundle} from '../shared/rrule';

type RecordRow = {id:string;name:string;revision:number;content:string;updatedAt:string};
const rows: RecordRow[] = [
  {
    id:'alpha',name:'Primary occurrence sets',revision:3,updatedAt:new Date(0).toISOString(),
    content:[
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;WKST=MO',
      'DTSTART:20251229T090000',
      'TZID:UTC',
    ].join('\n')+'\n',
  },
  {
    id:'beta',name:'Secondary occurrence sets',revision:5,updatedAt:new Date(1000).toISOString(),
    content:[
      'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU;WKST=SU',
      'DTSTART:20251227T233000',
      'TZID:Asia/Tokyo',
    ].join('\n')+'\n',
  },
];

export function createApp(){
  const app=express();
  app.use(express.json({limit:'1mb'}));
  app.get('/api/bootstrap',(_req,res)=>res.json({family:"recurrence-rule",count:rows.length}));
  app.get('/api/schedules',(_req,res)=>res.json(rows.map(({content,...row})=>row)));
  app.get('/api/schedules/:id',(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});res.set('ETag',String(row.revision)).json(row)});
  app.put('/api/schedules/:id',(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});if(req.body.revision!==row.revision)return res.status(409).json({error:'revision_conflict',current:row});row.content=String(req.body.content??'');row.revision+=1;row.updatedAt=new Date().toISOString();res.json(row)});
  app.post('/api/schedules/:id/analyze',async(req,res)=>{const row=rows.find(value=>value.id===req.params.id);if(!row)return res.status(404).json({error:'not_found'});await new Promise(resolve=>setTimeout(resolve,req.params.id==='alpha'?100:20));res.json({id:row.id,revision:row.revision,lines:String(req.body.content??row.content).split(/\r?\n/).length,diagnostics:[]})});

  // Authoritative recurrence preview. The client must render its grid and
  // interpret drag/keyboard selection against `calendar` and the occurrence
  // `periodKey`s returned here — never against the browser locale.
  app.post('/api/preview',(req,res)=>{
    const content = typeof req.body?.content==='string' ? req.body.content : '';
    try {
      const {rule} = parseRule(content);
      const from = typeof req.body?.from==='string' ? new Date(req.body.from) : undefined;
      const to = typeof req.body?.to==='string' ? new Date(req.body.to) : undefined;
      const bundle: PreviewBundle = buildPreview(rule, from && !isNaN(from.getTime())?from:undefined, to && !isNaN(to.getTime())?to:undefined);
      res.json(bundle);
    } catch (error) {
      if (error instanceof RuleError) return res.status(422).json({error:'invalid_rule',diagnostics:error.diagnostics});
      throw error;
    }
  });

  return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){createApp().listen(4174,'127.0.0.1',()=>console.log('server http://127.0.0.1:4174'))}

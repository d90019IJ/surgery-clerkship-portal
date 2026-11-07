import test from 'node:test';
import assert from 'node:assert/strict';
import {reminderGroups,candidateMatches,prepareReminderBatch,confirmPreviewBatch} from '../web/reminder-workflow.mjs';
import {teacherKey} from '../web/contact-rules.mjs';
import {reminderItems,reminderSourceVersion} from '../web/reminder-rules.mjs';
import {batchCandidates} from '../server/reminder-batches.mjs';
const now=Date.parse('2026-11-07T04:00:00Z'),week=7*86400000;
function fixture(){
  const contact={id:'teacher',name:'示範老師',email:'one@example.com',secondary_email:'two@example.com',revision:'c1'};
  const rows=[1,2].map(i=>({id:'row'+i,studentId:'S'+i,name:'示範學生'+i,unit:'一般外科',included:true,course:i,batch:'測試',start:'2026-10-01',end:'2026-10-20',selectedTeacher:contact.name,record:{pairing_status:'paired',actual_teacher:contact.name,score:null,revision:'g1'}}));
  const reviews=[],directory={contacts:[contact],bindings:[{teacher_key:teacherKey(contact.name,rows[0].unit),contact_id:contact.id,revision:'b1'}]},batches=[],calls=[];
  const data=()=>({batches});
  const groups=()=>reminderGroups(reminderItems(rows,reviews,now),directory,data(),now);
  async function candidates(){return (await batchCandidates(rows,reviews,directory.contacts,directory.bindings,now)).candidates;}
  async function api(action,p={}){
    calls.push(action);
    if(action==='reminder-review'){
      const record={row_id:p.id,source_version:p.sourceVersion,confirmed:p.confirmed,reviewed_at:new Date(now).toISOString(),revision:crypto.randomUUID()};
      const i=reviews.findIndex(r=>r.row_id===p.id);if(i<0)reviews.push(record);else reviews[i]=record;return {record};
    }
    if(action==='reminder-batches')return {...data(),candidates:await candidates()};
    if(action==='reminder-batch-create'){
      const m=await candidates(),batch={id:'batch',revision:'v1',messages:m.filter(m=>p.selections.some(s=>s.teacherId===m.teacherId)).map(m=>({...m,current:true})),confirmed:[]};batches.push(batch);return {id:batch.id};
    }
    if(action==='reminder-batch-confirm'){const b=batches.find(b=>b.id===p.id);b.confirmed=p.confirmed;b.revision='v2';return {id:b.id,revision:b.revision};}
    throw Error('Forbidden/unexpected call: '+action);
  }
  return {rows,reviews,directory,batches,calls,groups,candidates,api};
}
test('select-all eligibility excludes recent sends, pending, failed and unknown; never mutates history',()=>{
  for(const status of ['sent','sending','unknown','failed',null]){
    const f=fixture(),batch={id:'prior',messages:[{teacherId:'teacher',dependencies:{reviews:[{rowId:'row1'}]},delivery:status?{status,sent_at:new Date(now-1000).toISOString()}:null}]};f.batches.push(batch);
    const before=structuredClone(f.batches),g=f.groups()[0];assert.equal(g.selectable,false,status);assert.ok(g.reason);assert.deepEqual(f.batches,before);
  }
});
test('weekly reminder becomes selectable only after a week and selection still starts separately from saved reviews',()=>{
  const f=fixture();f.batches.push({id:'prior',messages:[{dependencies:{reviews:[{rowId:'row1'}]},delivery:{status:'sent',sent_at:new Date(now-week).toISOString()}}]});
  assert.equal(f.groups()[0].selectable,true);
  f.directory.contacts[0].email='';assert.equal(f.groups()[0].selectable,false);
  f.directory.contacts[0].email='one@example.com';f.directory.bindings=[];assert.equal(f.groups()[0].selectable,false);
});
test('preview saves selected reviews, freezes two-address merged message, confirms automatically, NEVER sends',async()=>{
  const f=fixture(),batch=await prepareReminderBatch(f.groups(),{api:f.api,now:()=>now,requestId:'mock'});
  assert.equal(batch.revision,'v2');assert.deepEqual(batch.confirmed,['teacher']);assert.equal(batch.messages[0].students.length,2);assert.deepEqual(batch.messages[0].to,['one@example.com','two@example.com']);
  assert.equal(f.calls.filter(a=>a==='reminder-review').length,2);assert.ok(f.calls.every(a=>!a.startsWith('mail-')));
  const callCount=f.calls.length;assert.deepEqual(await confirmPreviewBatch(batch,f.api),batch);assert.equal(f.calls.length,callCount,'resume current confirmed draft without rewriting it');
});
test('preview fails closed when current candidates add a student or change recipient, names, binding or source',async()=>{
  const f=fixture();for(const row of f.rows)await f.api('reminder-review',{id:row.id,sourceVersion:reminderSourceVersion(row),confirmed:true});
  const group=f.groups()[0],original=(await f.candidates())[0];assert.equal(candidateMatches(group,original),true);
  for(const mutate of [m=>m.to.push('other@example.com'),m=>m.students[0].name='改名',m=>m.students.push({...m.students[0],studentId:'extra'}),m=>m.dependencies.bindings[0].revision='changed',m=>m.dependencies.reviews[0].sourceVersion='changed',m=>m.blocked={reason:'recent'}]){const changed=structuredClone(original);mutate(changed);assert.equal(candidateMatches(group,changed),false);}
  const changed=structuredClone(original);changed.to=['other@example.com'];
  await assert.rejects(prepareReminderBatch([group],{api:async a=>{assert.equal(a,'reminder-batches');return {candidates:[changed]};},now:()=>now,requestId:'mock'}),/變更/);
});
test('review save failure stops the workflow before any batch or mail operation',async()=>{
  const f=fixture();let calls=0;
  await assert.rejects(prepareReminderBatch(f.groups(),{api:async(a,p)=>{assert.equal(a,'reminder-review');if(++calls===2)throw Error('offline');return f.api(a,p);},now:()=>now,requestId:'mock'}),/offline/);
  assert.equal(calls,2);assert.equal(f.batches.length,0);
});
test('resume excludes successful deliveries and refuses uncertain outcomes or stale content',async()=>{
  const f=fixture(),batch=await prepareReminderBatch(f.groups(),{api:f.api,now:()=>now,requestId:'mock'});
  const first={...batch.messages[0],teacherId:'done',delivery:{status:'sent'}};
  const partial={...batch,messages:[first,...batch.messages],confirmed:['done','teacher']};
  assert.equal(await confirmPreviewBatch(partial,f.api),partial);
  for(const status of ['sending','unknown','failed'])await assert.rejects(confirmPreviewBatch({...partial,messages:[{...first,delivery:{status}},...batch.messages]},f.api),/核對/);
  await assert.rejects(confirmPreviewBatch({...batch,messages:[first]},f.api),/無可/);
  await assert.rejects(confirmPreviewBatch({...batch,messages:batch.messages.map(m=>({...m,current:false}))},f.api),/變更/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {batchCandidates,batchBlock} from '../server/reminder-batches.mjs';
import {createPortal} from '../server/portal.mjs';
import {teacherKey} from '../web/contact-rules.mjs';
import {reminderSourceVersion,REVIEW_VALID_MS} from '../web/reminder-rules.mjs';
const time=Date.parse('2026-11-06T04:00:00Z');
function fixture(){
 const c={id:crypto.randomUUID(),name:'示範老師',email:'one@example.com',secondary_email:'two@example.com',revision:crypto.randomUUID()};
 const rows=['S1','S2'].map((studentId,i)=>({id:'row'+i,studentId,name:'示範學生'+i,unit:'一般外科',included:true,course:i+1,batch:'測試',start:'2026-10-01',end:'2026-10-20',selectedTeacher:c.name,record:{pairing_status:'paired',actual_teacher:c.name,score:null,revision:'source-v1'}}));
 const reviews=rows.map(r=>({row_id:r.id,source_version:reminderSourceVersion(r),confirmed:true,reviewed_at:new Date(time).toISOString(),revision:crypto.randomUUID()}));
 const bindings=[{teacher_key:teacherKey(c.name,rows[0].unit),contact_id:c.id,revision:crypto.randomUUID()}];
 return {rows,reviews,contacts:[c],bindings};
}
const candidates=(f,t=time)=>batchCandidates(f.rows,f.reviews,f.contacts,f.bindings,t);
test('snapshot freezes two-recipient merged letter, is deterministic and changes with every relevant dependency',async()=>{
 const f=fixture(),before=structuredClone(f),m=(await candidates(f)).candidates[0];
 assert.deepEqual(m.to,['one@example.com','two@example.com']);assert.equal(m.students.length,2);assert.match(m.html,/示範學生0/);assert.match(m.html,/示範學生1/);assert.equal(m.from,'d90019@nycu.edu.tw');assert.deepEqual(f,before);
 assert.equal((await candidates({...f,rows:[...f.rows].reverse(),reviews:[...f.reviews].reverse()})).candidates[0].version,m.version);
 for(const change of [x=>x.contacts[0].secondary_email='three@example.com',x=>x.contacts[0].revision=crypto.randomUUID(),x=>x.bindings[0].revision=crypto.randomUUID(),x=>x.reviews[0].revision=crypto.randomUUID(),x=>x.rows[0].name='更正姓名']){const changed=structuredClone(f);change(changed);assert.notEqual((await candidates(changed)).candidates[0].version,m.version);}
 f.rows[0].record.score=0;assert.equal((await candidates(f)).candidates[0].students.length,1);assert.notEqual((await candidates(f)).candidates[0].version,m.version);assert.equal(m.students.length,2);
 assert.equal((await candidates(before,time+REVIEW_VALID_MS)).candidates.length,0);
});
test('overlapping pending batches block duplicates; weekly repeats require both elapsed week and new review',async()=>{
 const f=fixture(),m=(await candidates(f)).candidates[0],batch={id:crypto.randomUUID(),messages:[m]};
 assert.ok(batchBlock(m,[batch],[],time));assert.equal(batchBlock(m,[{...batch,cancelled_at:'now'}],[],time),null);
 const delivery={batch_id:batch.id,teacher_id:m.teacherId,status:'sent',sent_at:new Date(time).toISOString()};
 assert.ok(batchBlock(m,[batch],[delivery],time+REVIEW_VALID_MS-1));assert.ok(batchBlock(m,[batch],[delivery],time+REVIEW_VALID_MS));
 const fresh=structuredClone(m);fresh.dependencies.reviews.forEach(r=>r.reviewedAt=new Date(time+REVIEW_VALID_MS).toISOString());
 assert.equal(batchBlock(fresh,[batch],[delivery],time+REVIEW_VALID_MS),null);
 for(const status of ['sending','failed','unknown'])assert.ok(batchBlock(fresh,[batch],[{...delivery,status}],time+REVIEW_VALID_MS));
});
function setup(){
 const f=fixture(),batches=[],deliveries=[],calls=[],audit=[];let currentTime=time,denied=false;
 const repository={teacherContacts:async()=>f.contacts,teacherBindings:async()=>f.bindings,reminderReviews:async()=>f.reviews,reminderBatches:async()=>batches,reminderDeliveries:async()=>deliveries,reminderBatchHistory:async()=>audit,
 saveReminderBatch:async p=>{calls.push(p);let b;if(p.p_operation==='create'){b={id:crypto.randomUUID(),request_id:p.p_id,messages:structuredClone(p.p_messages),confirmed:[],revision:crypto.randomUUID(),created_by:p.p_actor,created_at:new Date(currentTime).toISOString()};batches.push(b);}else{b=batches.find(b=>b.id===p.p_id);b.revision=crypto.randomUUID();if(p.p_operation==='cancel')b.cancelled_at=new Date(currentTime).toISOString();else b.confirmed=p.p_confirmed;}audit.push({actor:p.p_actor,event:p.p_operation});return {id:b.id,revision:b.revision};}};
 const handler=createPortal({repository,codec:{read:async t=>t==='staff'?{cookie:'mock',employeeId:'REAL_STAFF'}:null},now:()=>currentTime,fetchSource:async()=>Response.json({rows:f.rows},{status:denied?403:200})});
 const send=async(body,token='staff')=>{const r=await handler(new Request('https://test.local',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
 return {f,batches,deliveries,calls,audit,send,setTime:v=>currentTime=v,deny:()=>denied=true};
}
test('staff-only create takes snapshots from server, is replay-safe, and saves confirmation without sending',async()=>{
 const s=setup();for(const action of ['reminder-batches','reminder-batch-create','reminder-batch-confirm','reminder-batch-history','reminder-batch-cancel'])assert.equal((await s.send({action},'')).status,401);
 const m=(await s.send({action:'reminder-batches'})).body.candidates[0];
 const payload={action:'reminder-batch-create',requestId:crypto.randomUUID(),selections:[{teacherId:m.teacherId,version:m.version}],actor:'FORGED',messages:[{to:['attacker@example.com']}]};
 assert.equal((await s.send({...payload,selections:[]})).status,400);assert.equal((await s.send({...payload,selections:[{teacherId:m.teacherId,version:'old'}]})).status,409);
 const result=await s.send(payload);assert.equal(result.status,200);assert.equal(result.body.mailEnabled,false);assert.equal(s.calls[0].p_actor,'REAL_STAFF');assert.deepEqual(s.batches[0].messages[0].to,m.to);
 assert.equal((await s.send(payload)).body.id,result.body.id);assert.equal(s.calls.length,1);
 assert.equal((await s.send({...payload,requestId:crypto.randomUUID()})).status,409);
 const b=s.batches[0],revision=b.revision;
 assert.equal((await s.send({action:'reminder-batch-confirm',id:b.id,revision,confirmed:[m.teacherId]})).status,200);
 assert.deepEqual(b.confirmed,[m.teacherId]);assert.equal(s.deliveries.length,0);
 assert.equal((await s.send({action:'reminder-batch-confirm',id:b.id,revision,confirmed:[]})).status,409);
 assert.equal((await s.send({action:'reminder-batch-history',id:b.id})).body.history.length,2);
 assert.equal((await s.send({action:'reminder-send',id:b.id})).status,400);
 s.deny();assert.equal((await s.send({action:'reminder-batches'})).status,401);
});
test('stale email, source score and review expiry refuse confirmation; cancellation preserves snapshots and permits replacement',async()=>{
 for(const mutate of [s=>s.f.contacts[0].email='new@example.com',s=>s.f.rows[0].record.score=0,s=>s.setTime(time+REVIEW_VALID_MS)]){
  const s=setup(),m=(await s.send({action:'reminder-batches'})).body.candidates[0];await s.send({action:'reminder-batch-create',requestId:crypto.randomUUID(),selections:[{teacherId:m.teacherId,version:m.version}]});const b=s.batches[0],snapshot=structuredClone(b.messages);mutate(s);
  assert.equal((await s.send({action:'reminder-batches'})).body.batches[0].messages[0].current,false);
  assert.equal((await s.send({action:'reminder-batch-confirm',id:b.id,revision:b.revision,confirmed:[m.teacherId]})).status,409);
  assert.equal((await s.send({action:'reminder-batch-cancel',id:b.id,revision:b.revision})).status,200);assert.deepEqual(b.messages,snapshot);
 }
});
test('provider delivery results cannot be created through batch endpoints or mistaken for confirmations',async()=>{
 const s=setup(),m=(await s.send({action:'reminder-batches'})).body.candidates[0];await s.send({action:'reminder-batch-create',requestId:crypto.randomUUID(),selections:[{teacherId:m.teacherId,version:m.version}]});const b=s.batches[0];
 s.deliveries.push({batch_id:b.id,teacher_id:m.teacherId,status:'unknown',provider_message_id:null});
 for(const action of ['reminder-batch-cancel','reminder-batch-confirm'])assert.equal((await s.send({action,id:b.id,revision:b.revision,confirmed:[m.teacherId]})).status,409);
 const d=(await s.send({action:'reminder-batches'})).body;assert.equal(d.batches[0].messages[0].delivery.status,'unknown');assert.equal(d.mailEnabled,false);
});

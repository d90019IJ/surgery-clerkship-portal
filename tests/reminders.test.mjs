import test from 'node:test';
import assert from 'node:assert/strict';
import {reminderDueAt,reminderEligible,reminderSourceVersion,reminderReview,reminderItems,REVIEW_VALID_MS} from '../web/reminder-rules.mjs';
import {createPortal} from '../server/portal.mjs';
const time=Date.parse('2026-11-05T04:00:00Z');
const row=()=>({id:'test-rotation',studentId:'TEST01',name:'示範學生',batch:'第一梯次',course:2,unit:'一般外科',start:'2026-10-12',end:'2026-10-23',selectedTeacher:'原選老師',included:true,selectionChanged:false,record:{pairing_status:'paired',actual_teacher:'院內老師',score:null,revision:'grade-v1'}});
test('reminders begin on day eight at Taipei midnight, with valid calendar dates',()=>{
  assert.equal(reminderDueAt('2026-10-23'),'2026-10-30T16:00:00.000Z');
  assert.equal(reminderEligible(row(),Date.parse('2026-10-30T15:59:59.999Z')),false);
  assert.equal(reminderEligible(row(),Date.parse('2026-10-30T16:00:00Z')),true);
  assert.equal(reminderDueAt('2026-12-28'),'2027-01-04T16:00:00.000Z');
  for(const end of ['2026-02-30','2026-13-01','2026/10/23','',null])assert.equal(reminderDueAt(end),null);
  assert.equal(reminderEligible({...row(),start:'2026-11-01'},time),false);
});
test('only confirmed actual pairings with truly absent scores qualify; zero and malformed scores do not',()=>{
  const r=row();assert.equal(reminderEligible(r,time),true);
  for(const score of [0,90,'',-1,'90'])assert.equal(reminderEligible({...r,record:{...r.record,score}},time),false);
  for(const status of ['unchecked','unpaired'])assert.equal(reminderEligible({...r,record:{...r.record,pairing_status:status}},time),false);
  for(const patch of [{included:false},{selectionChanged:true},{unit:''},{record:null},{end:'2026-11-05'}])assert.equal(reminderEligible({...r,...patch},time),false);
  assert.equal(reminderEligible({...r,record:{...r.record,actual_teacher:'  '}},time),false);
});
test('confirmation expires after exactly seven days; any pairing version change needs new review',()=>{
  const r=row(),record={row_id:r.id,source_version:reminderSourceVersion(r),confirmed:true,reviewed_at:new Date(time).toISOString()};
  assert.equal(reminderReview(r,record,time+REVIEW_VALID_MS-1).active,true);
  assert.equal(reminderReview(r,record,time+REVIEW_VALID_MS).reason,'expired');
  for(const changed of [{...r,end:'2026-10-22'},{...r,record:{...r.record,actual_teacher:'改派老師'}},{...r,record:{...r.record,revision:'v2'}}])assert.equal(reminderReview(changed,record,time).reason,'changed');
  assert.equal(reminderReview(r,{...record,confirmed:false},time).reason,'revoked');
  assert.equal(reminderReview(r,{...record,reviewed_at:'bad'},time).active,false);
  assert.equal(reminderReview(r,{...record,reviewed_at:new Date(time+1000).toISOString()},time).active,false);
  assert.equal(reminderReview({...r,record:{...r.record,score:0}},record,time).active,false);
});
test('list ignores orphan confirmations and keeps actual teacher rather than the original teacher',()=>{
  const r=row(),before=structuredClone(r),items=reminderItems([r,{...r,id:'graded',record:{...r.record,score:0}}],[{row_id:'orphan',confirmed:true}],time);
  assert.equal(items.length,1);assert.equal(items[0].row.record.actual_teacher,'院內老師');assert.equal(items[0].record,null);assert.deepEqual(r,before);
});
async function setup(){
  let currentTime=time,sourceDenied=false,conflict=false;const r=row(),records=[],history=[],calls=[];
  const repository={reminderReviews:async()=>records,reminderHistory:async()=>history,saveReminderReview:async input=>{calls.push(input);if(conflict)return {conflict:true};const saved={row_id:input.p_row_id,source_version:input.p_source_version,confirmed:input.p_confirmed,reviewed_at:new Date(currentTime).toISOString(),reviewed_by:input.p_actor,revision:'review-'+calls.length};records.splice(0,records.length,saved);history.push({after_value:saved});return {record:saved};}};
  const handler=createPortal({codec:{read:async token=>token==='staff'?{cookie:'staff-session',employeeId:'STAFF'}:null},repository,now:()=>currentTime,fetchSource:async()=>sourceDenied?Response.json({}, {status:403}):Response.json({rows:[r]})});
  const send=async(body,token='staff')=>{const response=await handler(new Request('https://test.local',{method:'POST',headers:{origin:'https://d90019ij.github.io','content-type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};};
  return {send,r,records,calls,history,setTime:v=>currentTime=v,deny:()=>sourceDenied=true,conflict:()=>conflict=true};
}
test('staff-only review endpoints validate membership, latest source and server-side actor without writing grades',async()=>{
  const s=await setup(),before=structuredClone(s.r),payload={action:'reminder-review',id:s.r.id,sourceVersion:reminderSourceVersion(s.r),revision:'',confirmed:true,actor:'forged'};
  for(const action of ['reminder-list','reminder-review','reminder-history'])assert.equal((await s.send({...payload,action},'')).status,401);
  assert.equal((await s.send({...payload,id:'unknown'})).status,404);
  assert.equal((await s.send({...payload,confirmed:'true'})).status,400);
  assert.equal((await s.send({...payload,sourceVersion:'old'})).status,409);
  let result=await s.send(payload);assert.equal(result.status,200);assert.equal(result.body.mailEnabled,false);assert.equal(result.body.review.active,true);assert.equal(s.calls[0].p_actor,'STAFF');assert.deepEqual(s.r,before);
  result=await s.send({action:'reminder-list'});assert.equal(result.body.items[0].review.active,true);
  assert.equal((await s.send({action:'reminder-history',id:s.r.id})).body.history.length,1);
  assert.equal((await s.send({action:'reminder-history',id:'unknown'})).status,404);
  assert.equal((await s.send({action:'reminder-send'})).status,400);
  s.deny();assert.equal((await s.send(payload)).status,401);
});
test('saved zero, changed pairing, concurrency conflicts and weekly renewal are handled safely',async()=>{
  const s=await setup(),payload={action:'reminder-review',id:s.r.id,sourceVersion:reminderSourceVersion(s.r),revision:'',confirmed:true};
  s.r.record.score=0;assert.equal((await s.send(payload)).status,409);assert.equal(s.calls.length,0);
  s.r.record.score=null;s.r.record.actual_teacher='新老師';assert.equal((await s.send(payload)).status,409);
  payload.sourceVersion=reminderSourceVersion(s.r);assert.equal((await s.send(payload)).status,200);
  s.setTime(time+REVIEW_VALID_MS);assert.equal((await s.send({action:'reminder-list'})).body.items[0].review.active,false);
  payload.revision=s.records[0].revision;assert.equal((await s.send(payload)).body.review.active,true);
  assert.equal((await s.send({...payload,revision:s.records[0].revision,confirmed:false})).body.review.reason,'revoked');
  s.conflict();assert.equal((await s.send(payload)).status,409);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmReminderItems} from '../web/reminder-bulk.mjs';
import {reminderSourceVersion,REVIEW_VALID_MS} from '../web/reminder-rules.mjs';
const now=Date.parse('2026-11-06T04:00:00Z');
function item(id){
 const row={id,studentId:'TEST'+id,name:'示範學生',unit:'一般外科',included:true,course:1,batch:'測試',start:'2026-10-01',end:'2026-10-20',selectedTeacher:'示範老師',record:{pairing_status:'paired',actual_teacher:'示範老師',score:null,revision:'v1'}};
 return {row,sourceVersion:reminderSourceVersion(row),record:null};
}
const record=(i,at=now)=>({row_id:i.row.id,source_version:i.sourceVersion,confirmed:true,revision:'saved-v1',reviewed_at:new Date(at).toISOString()});
test('bulk confirmation only saves supplied visible pending rows; active confirmations and zero grades remain untouched',async()=>{
 const pending=item('pending'),active=item('active'),graded=item('zero'),hidden=item('hidden');active.record=record(active);graded.row.record.score=0;
 const before=structuredClone([pending,active,graded,hidden]),calls=[];
 const result=await confirmReminderItems([pending,active,graded,pending],{now:()=>now,api:async(action,payload)=>{calls.push({action,payload});return {record:record(pending)};}});
 assert.deepEqual(calls,[{action:'reminder-review',payload:{id:'pending',sourceVersion:pending.sourceVersion,revision:'',confirmed:true}}]);
 assert.equal(result.saved,1);assert.equal(result.remaining,0);assert.equal(result.failure,null);assert.deepEqual([pending,active,graded,hidden],before);
});
test('expired or changed confirmations use their current revision and source version when explicitly bulk renewed',async()=>{
 const expired=item('expired'),changed=item('changed'),revoked=item('revoked');expired.record=record(expired,now-REVIEW_VALID_MS);changed.record={...record(changed),source_version:'old-source'};revoked.record={...record(revoked),confirmed:false};
 const calls=[];const result=await confirmReminderItems([expired,changed,revoked],{now:()=>now,api:async(action,payload)=>{calls.push(payload);return {};}});
 assert.equal(result.saved,3);assert.ok(calls.every(p=>p.revision==='saved-v1'&&p.confirmed));assert.equal(calls[1].sourceVersion,changed.sourceVersion);
});
test('a failed or uncertain write stops later writes, preserves earlier successes and reports remaining work without automatic retry',async()=>{
 const visible=[item('first'),item('second'),item('third')],calls=[],saved=[],progress=[];
 const result=await confirmReminderItems(visible,{now:()=>now,api:async(action,payload)=>{calls.push(payload.id);if(payload.id==='second')throw new Error('配對資料已更新');return {record:record(visible[0])};},onSaved:(i,response)=>saved.push([i.row.id,response.record]),onProgress:r=>progress.push([r.saved,r.total])});
 assert.deepEqual(calls,['first','second']);assert.equal(saved.length,1);assert.equal(result.saved,1);assert.equal(result.total,3);assert.equal(result.remaining,2);assert.equal(result.failure.item.row.id,'second');assert.equal(result.failure.message,'配對資料已更新');assert.deepEqual(progress,[[0,3],[1,3]]);
});
test('logout or view invalidation aborts further requests and prevents stale UI updates; empty selection does not write',async()=>{
 let current=true;const calls=[],saved=[];
 const result=await confirmReminderItems([item('first'),item('second')],{now:()=>now,isCurrent:()=>current,api:async(action,payload)=>{calls.push(payload.id);current=false;return {};},onSaved:i=>saved.push(i)});
 assert.deepEqual(calls,['first']);assert.equal(result.aborted,true);assert.deepEqual(saved,[]);
 const empty=await confirmReminderItems([],{api:async()=>{throw Error('Unexpected write');}});assert.equal(empty.saved,0);assert.equal(empty.total,0);
});

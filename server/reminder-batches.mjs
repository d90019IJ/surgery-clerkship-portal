import {groupedReminders,teacherKey} from '../web/contact-rules.mjs';
import {reminderLetterHTML,REMINDER_SUBJECT} from '../web/reminder-letter.mjs';
import {sha256} from './quiz-application.mjs';

export const SCHOOL_SENDER='d90019@nycu.edu.tw';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function batchCandidates(rows,reviews,contacts,bindings,now){
  const grouped=groupedReminders(rows,reviews,contacts,bindings,now);
  const candidates=await Promise.all(grouped.groups.filter(g=>g.emailValid).map(async g=>{
    g.items.sort((a,b)=>a.row.id.localeCompare(b.row.id));
    g.students.sort((a,b)=>a.studentId.localeCompare(b.studentId));
    for(const s of g.students)s.placements.sort((a,b)=>a.id.localeCompare(b.id));
    const snapshot={teacherId:g.contact.id,teacherName:g.contact.name,from:SCHOOL_SENDER,to:g.recipients,subject:REMINDER_SUBJECT,
      html:reminderLetterHTML(g),students:g.students,expiresAt:new Date(Math.min(...g.items.map(i=>Date.parse(i.review.expiresAt)))).toISOString(),
      dependencies:{contactRevision:g.contact.revision,bindings:[...new Set(g.items.map(i=>teacherKey(i.row.record.actual_teacher,i.row.unit)))].sort().map(key=>({key,revision:bindings.find(b=>b.teacher_key===key).revision})),
        reviews:g.items.map(i=>({rowId:i.row.id,revision:i.record.revision,sourceVersion:i.sourceVersion,reviewedAt:i.record.reviewed_at}))}};
    return {...snapshot,version:await sha256(JSON.stringify(snapshot))};
  }));
  return {candidates,missingEmail:grouped.groups.filter(g=>!g.emailValid).length,unlinked:grouped.unlinked.length,pending:grouped.pendingCount};
}
const rowIds=m=>m.dependencies.reviews.map(r=>r.rowId);
export function batchBlock(message,batches,deliveries,now,excludeId=''){
  const ids=new Set(rowIds(message));
  for(const batch of batches){
    if(batch.id===excludeId||batch.cancelled_at)continue;
    for(const saved of batch.messages){
      if(!rowIds(saved).some(id=>ids.has(id)))continue;
      const sent=deliveries.find(d=>d.batch_id===batch.id&&d.teacher_id===saved.teacherId);
      if(!sent||sent.status!=='sent')return {batchId:batch.id,reason:'已有未結案批次，請先查看或取消該批。'};
      if(now-Date.parse(sent.sent_at)<7*86400000)return {batchId:batch.id,reason:'距離上次寄送未滿一週。'};
      if(message.dependencies.reviews.some(r=>ids.has(r.rowId)&&Date.parse(r.reviewedAt)<=Date.parse(sent.sent_at)))return {batchId:batch.id,reason:'續寄前請重新確認仍未評分。'};
    }
  }
  return null;
}
export async function handleBatch({body,rows,repository,actor,now}){
  const fail=(error,status=409)=>({status,body:{error}}),ok=value=>({status:200,body:{...value,mailEnabled:false}});
  const [contacts,bindings,reviews,batches,deliveries]=await Promise.all([repository.teacherContacts(),repository.teacherBindings(),repository.reminderReviews(),repository.reminderBatches(),repository.reminderDeliveries()]);
  const current=await batchCandidates(rows,reviews,contacts,bindings,now);
  const valid=m=>current.candidates.some(c=>c.teacherId===m.teacherId&&c.version===m.version)&&now<Date.parse(m.expiresAt);
  if(body.action==='reminder-batches')return ok({...current,candidates:current.candidates.map(m=>({...m,blocked:batchBlock(m,batches,deliveries,now)})),
    batches:batches.map(b=>({...b,messages:b.messages.map(m=>({...m,current:valid(m),delivery:deliveries.find(d=>d.batch_id===b.id&&d.teacher_id===m.teacherId)??null}))})),deliveries});
  if(body.action==='reminder-batch-create'){
    if(!uuid(body.requestId)||!Array.isArray(body.selections)||!body.selections.length||body.selections.length>100||new Set(body.selections.map(s=>s?.teacherId)).size!==body.selections.length)return fail('請選取老師後建立批次。',400);
    const prior=batches.find(b=>b.request_id===body.requestId);if(prior)return ok({id:prior.id,replayed:true});
    const messages=[];
    for(const selection of body.selections){const m=current.candidates.find(c=>c.teacherId===selection?.teacherId&&c.version===selection?.version);if(!m)return fail('名單、信箱或核對紀錄已變更，請重新載入並核對。');const block=batchBlock(m,batches,deliveries,now);if(block)return fail(block.reason);messages.push(m);}
    const result=await repository.saveReminderBatch({p_operation:'create',p_id:body.requestId,p_revision:null,p_messages:messages,p_confirmed:[],p_actor:actor});
    return result.error?fail(result.error):ok(result);
  }
  const batch=batches.find(b=>b.id===body.id);if(!batch)return fail('找不到此批次。',404);
  if(body.action==='reminder-batch-history')return ok({history:await repository.reminderBatchHistory(batch.id),mailHistory:repository.mailHistory?await repository.mailHistory(batch.id):[]});
  if(!uuid(body.revision)||body.revision!==batch.revision)return fail('此批次已更新，請重新載入後核對。');
  if(batch.cancelled_at)return fail('此批次已取消，請建立新批次。');
  if(deliveries.some(d=>d.batch_id===batch.id))return fail('此批次已有寄送處理紀錄，不能變更確認內容。');
  let confirmed=[];
  if(body.action==='reminder-batch-confirm'){
    if(!Array.isArray(body.confirmed)||body.confirmed.length>batch.messages.length||new Set(body.confirmed).size!==body.confirmed.length)return fail('核對資料不完整。',400);
    confirmed=body.confirmed;
    if(confirmed.some(id=>!batch.messages.some(m=>m.teacherId===id&&valid(m))))return fail('勾選的信件資料已變更或核對已過期。請取消此批，重新核對後建立新批次。');
  }else if(body.action!=='reminder-batch-cancel')return fail('不支援的操作。',400);
  const result=await repository.saveReminderBatch({p_operation:body.action==='reminder-batch-cancel'?'cancel':'confirm',p_id:batch.id,p_revision:body.revision,p_messages:[],p_confirmed:confirmed,p_actor:actor});
  return result.error?fail(result.error):ok(result);
}

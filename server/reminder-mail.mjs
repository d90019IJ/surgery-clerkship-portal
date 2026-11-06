import {batchCandidates,SCHOOL_SENDER} from './reminder-batches.mjs';
import {GOOGLE_SCOPES,messageRaw} from './gmail.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function handleMail({body,rows,repository,actor,now,clientId,provider}){
  const fail=(error,status=409)=>({status,body:{error}}),ok=value=>({status:200,body:value});
  if(body.action==='mail-config')return ok({configured:!!clientId,clientId,scopes:GOOGLE_SCOPES,sender:SCHOOL_SENDER});
  if(!clientId||!provider)return fail('學校信箱連結尚未完成設定，目前不能寄信。',503);
  let identity;try{identity=await provider.identity(body.accessToken);}catch(e){return fail(e.message,403);}
  if(body.action==='mail-connect')return ok({email:identity.email,expiresAt:identity.expiresAt});
  if(!['mail-prepare','mail-send'].includes(body.action))return fail('不支援的寄送操作。',400);
  if(!uuid(body.id)||!uuid(body.revision))return fail('請重新載入本批確認。',400);
  if(body.action==='mail-send'&&(body.confirmSend!==true||!uuid(body.intentId)||!uuid(body.teacherId)))return fail('請先核對寄送摘要，再按確認寄出。',400);
  const [batches,deliveries,contacts,bindings,reviews]=await Promise.all([repository.reminderBatches(),repository.reminderDeliveries(),repository.teacherContacts(),repository.teacherBindings(),repository.reminderReviews()]);
  const batch=batches.find(b=>b.id===body.id);
  if(!batch||batch.cancelled_at||batch.revision!==body.revision)return fail('批次已更新或取消，請重新核對。');
  const current=await batchCandidates(rows,reviews,contacts,bindings,now);
  const pending=batch.messages.filter(m=>batch.confirmed.includes(m.teacherId)&&(!deliveries.some(d=>d.batch_id===batch.id&&d.teacher_id===m.teacherId)||deliveries.some(d=>d.batch_id===batch.id&&d.teacher_id===m.teacherId&&d.status==='failed')));
  const selected=body.action==='mail-prepare'?pending:batch.messages.filter(m=>m.teacherId===body.teacherId&&batch.confirmed.includes(m.teacherId));
  if(!selected.length)return fail('沒有已保存確認且可以寄送的信件。請查看寄送紀錄。');
  if(selected.some(m=>!current.candidates.some(c=>c.teacherId===m.teacherId&&c.version===m.version)||now>=Date.parse(m.expiresAt)))return fail('名單、信箱或評分已異動，或核對已過期；已停止寄送，請重新核對。');
  if(body.action==='mail-prepare'){
    const result=await repository.mailRpc('prepare_clerk_mail',{p_batch:batch.id,p_revision:batch.revision,p_actor:actor,p_sub:identity.sub,p_teachers:selected.map(m=>m.teacherId)});
    return result.error?fail(result.error):ok({...result,sender:identity.email,messages:selected.map(({teacherId,teacherName,to,subject,students})=>({teacherId,teacherName,to,subject,studentCount:students.length}))});
  }
  // Claims are serialized in the database before any provider request. Client requests never supply recipients or content.
  const claimed=await repository.mailRpc('claim_clerk_mail',{p_intent:body.intentId,p_batch:batch.id,p_revision:batch.revision,p_teacher:body.teacherId,p_actor:actor,p_sub:identity.sub});
  if(claimed.error)return fail(claimed.error);
  if(claimed.alreadySent)return ok({status:'sent',alreadySent:true});
  let result,raw;
  try{raw=messageRaw(claimed.message,claimed.messageId,now);}catch{result={status:'failed',error:'信件格式檢查未通過，尚未向 Google 寄送。'};}
  if(!result)try{result=await provider.send(body.accessToken,raw);}catch{result={status:'unknown',error:'寄送結果待查證，請先檢查寄件備份，勿重寄。'};}
  try{
    const saved=await repository.mailRpc('finish_clerk_mail',{p_attempt:claimed.attemptId,p_status:result.status,p_provider:result.providerId??null,p_error:result.error??null});
    if(saved.error)return fail('寄送紀錄尚未確認。請先檢查寄件備份，勿重寄。',503);
  }catch{return fail('寄送紀錄尚未確認。請先檢查寄件備份，勿重寄。',503);}
  return ok({status:result.status,error:result.error??null});
}

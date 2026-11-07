import {teacherKey,cleanTeacher,teacherRecipients} from './contact-rules.mjs';
import {reminderReview} from './reminder-rules.mjs';

const WEEK=7*86400000;
export function reminderGroups(items,directory,batchData,now){
  const contacts=new Map(directory.contacts.map(c=>[c.id,c]));
  const bindings=new Map(directory.bindings.map(b=>[b.teacher_key,b]));
  const groups=new Map();
  for(const item of items){
    const row=item.row,key=teacherKey(row.record.actual_teacher,row.unit),binding=bindings.get(key);
    const contact=contacts.get(binding?.contact_id);
    const linked=contact&&cleanTeacher(contact.name)===cleanTeacher(row.record.actual_teacher);
    const id=linked?contact.id:key;
    if(!groups.has(id))groups.set(id,{id,name:row.record.actual_teacher,contact:linked?contact:null,to:linked?teacherRecipients(contact):[],items:[],bindings:[],blocks:[]});
    const group=groups.get(id);group.items.push(item);
    if(binding&&!group.bindings.some(b=>b.teacher_key===key))group.bindings.push(binding);
  }
  for(const group of groups.values()){
    const ids=new Set(group.items.map(i=>i.row.id));
    for(const batch of batchData.batches){
      if(batch.cancelled_at)continue;
      for(const message of batch.messages){
        if(!message.dependencies.reviews.some(r=>ids.has(r.rowId)))continue;
        const delivery=message.delivery;
        if(!delivery)group.blocks.push({kind:'pending',batchId:batch.id,reason:'已有尚未寄出的提醒，可在下方繼續預覽。'});
        else if(delivery.status!=='sent')group.blocks.push({kind:'delivery',batchId:batch.id,reason:delivery.status==='failed'?'上次寄送失敗，請查看處理紀錄。':'上次寄送結果待查證，暫不重寄。'});
        else if(!Number.isFinite(Date.parse(delivery.sent_at))||now-Date.parse(delivery.sent_at)<WEEK)group.blocks.push({kind:'recent',batchId:batch.id,reason:'已寄出，距離上次寄送未滿一週。'});
      }
    }
    group.selectable=!!group.to.length&&!group.blocks.length;
    group.reason=group.blocks[0]?.reason||(!group.contact?'尚未對應老師通訊錄':!group.to.length?'請先補齊有效的老師信箱':'');
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
}

// Compare everything the administrator saw, not just the teacher ID. A concurrently
// added student or changed email must never silently expand the approved selection.
export function candidateMatches(group,candidate){
  if(!candidate||candidate.blocked||candidate.teacherId!==group.id||candidate.teacherName!==group.contact?.name)return false;
  if(JSON.stringify(candidate.to)!==JSON.stringify(group.to)||candidate.dependencies.contactRevision!==group.contact.revision)return false;
  const expected=group.items.map(i=>[i.row.id,i.sourceVersion]).sort();
  const actual=candidate.dependencies.reviews.map(r=>[r.rowId,r.sourceVersion]).sort();
  const bindings=group.bindings.map(b=>({key:b.teacher_key,revision:b.revision})).sort((a,b)=>a.key.localeCompare(b.key));
  const currentBindings=[...candidate.dependencies.bindings].sort((a,b)=>a.key.localeCompare(b.key));
  const students=group.items.map(({row:r})=>[r.id,r.studentId,r.name,r.unit,r.course,r.start,r.end,r.batch]).sort();
  const currentStudents=candidate.students.flatMap(s=>s.placements.map(p=>[p.id,s.studentId,s.name,p.unit,p.course,p.start,p.end,p.batch])).sort();
  return JSON.stringify(expected)===JSON.stringify(actual)&&JSON.stringify(bindings)===JSON.stringify(currentBindings)&&JSON.stringify(students)===JSON.stringify(currentStudents);
}

export async function prepareReminderBatch(groups,{api,now,requestId,onProgress=()=>{}}){
  if(!groups.length||groups.some(g=>!g.selectable))throw new Error('請重新載入並選取可提醒的老師。');
  let saved=0;const total=groups.reduce((n,g)=>n+g.items.length,0);
  for(const group of groups)for(const item of group.items){
    // Explicit selection is required on every visit. Preserve still-current review
    // revisions so returning to an unsent preview does not invalidate its snapshot.
    if(!reminderReview(item.row,item.record,now()).active){
      const result=await api('reminder-review',{id:item.row.id,sourceVersion:item.sourceVersion,revision:item.record?.revision??'',confirmed:true});
      item.record=result.record;
    }
    onProgress(++saved,total);
  }
  const latest=await api('reminder-batches');
  const candidates=groups.map(g=>latest.candidates.find(m=>m.teacherId===g.id));
  if(groups.some((g,i)=>!candidateMatches(g,candidates[i])))throw new Error('名單、信箱或寄送狀態已有變更。請更新後重新核對；尚未寄信。');
  const created=await api('reminder-batch-create',{requestId,selections:candidates.map(m=>({teacherId:m.teacherId,version:m.version}))});
  const refreshed=await api('reminder-batches');
  return confirmPreviewBatch(refreshed.batches.find(b=>b.id===created.id),api);
}

export async function confirmPreviewBatch(batch,api){
  if(!batch||batch.cancelled_at)throw new Error('此提醒已取消或不存在，請更新名單。');
  const remaining=batch.messages.filter(m=>!m.delivery);
  if(!remaining.length||remaining.some(m=>!m.current))throw new Error('內容已變更或無可繼續寄送的信件，請更新名單。');
  if(batch.messages.some(m=>m.delivery)){
    if(remaining.some(m=>!batch.confirmed.includes(m.teacherId)))throw new Error('部分信件尚未確認，請查看寄送紀錄。');
    if(batch.messages.some(m=>m.delivery&&m.delivery.status!=='sent'))throw new Error('上次寄送結果需要核對，請先查看寄送紀錄。');
    return batch;
  }
  const ids=remaining.map(m=>m.teacherId);
  if(ids.length===batch.confirmed.length&&ids.every(id=>batch.confirmed.includes(id)))return batch;
  const result=await api('reminder-batch-confirm',{id:batch.id,revision:batch.revision,confirmed:ids});
  return {...batch,revision:result.revision,confirmed:ids};
}

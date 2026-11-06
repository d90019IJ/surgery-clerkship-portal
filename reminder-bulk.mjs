import {reminderEligible,reminderReview} from './reminder-rules.mjs';

// Only the supplied, visible rows are considered. Keep valid confirmations unchanged.
// Use the existing endpoint so every write rechecks current pairing and grade data.
export async function confirmReminderItems(items,{api,now=Date.now,isCurrent=()=>true,onSaved=()=>{},onProgress=()=>{}}){
  const seen=new Set(),time=now();
  const pending=items.filter(item=>{
    const id=item.row.id;
    if(seen.has(id))return false;
    seen.add(id);
    return reminderEligible(item.row,time)&&!reminderReview(item.row,item.record,time).active;
  });
  const result={saved:0,total:pending.length,remaining:pending.length,failure:null,aborted:false};
  onProgress(result);
  for(const item of pending){
    if(!isCurrent())return {...result,aborted:true};
    let response;
    try{response=await api('reminder-review',{id:item.row.id,sourceVersion:item.sourceVersion,revision:item.record?.revision??'',confirmed:true});}
    catch(error){return {...result,failure:{item,message:error.message||'尚未確認保存結果，請更新名單後核對。'}};}
    if(!isCurrent())return {...result,aborted:true};
    onSaved(item,response);
    result.saved++;result.remaining--;
    onProgress(result);
  }
  return result;
}

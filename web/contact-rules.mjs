import {reminderItems} from './reminder-rules.mjs';
export const cleanTeacher=value=>typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/gu,' '):'';
const placeholder=name=>!name||['—','-','未指定','單位安排','未指定／單位安排','未指定/單位安排'].includes(name);
export const teacherKey=(name,unit)=>JSON.stringify([cleanTeacher(name),cleanTeacher(unit)]);
export function validTeacherEmail(email){
  if(typeof email!=='string'||email.length>254||/[\s,;<>\r\n]/u.test(email))return false;
  const parts=email.split('@');if(parts.length!==2)return false;
  const [local,domain]=parts;if(!local||local.length>64||! /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)||local.startsWith('.')||local.endsWith('.')||local.includes('..'))return false;
  const labels=domain.split('.');return labels.length>=2&&labels.every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(s))&&/^[a-z]{2,63}$/i.test(labels.at(-1));
}
export function teacherDirectory(rows,contacts,bindings){
  const entries=new Map(),byContact=new Map(contacts.map(c=>[c.id,c])),byKey=new Map(bindings.map(b=>[b.teacher_key,b]));
  for(const r of rows){
    if(!r.included||!r.unit)continue;
    for(const [value,origin] of [[r.selectedTeacher,'原選'],[r.record?.pairing_status==='paired'?r.record.actual_teacher:'','院內配對']]){
      const name=cleanTeacher(value),unit=cleanTeacher(r.unit);if(placeholder(name))continue;const key=teacherKey(name,unit);
      if(!entries.has(key))entries.set(key,{key,name,unit,sources:[],current:true});
      const entry=entries.get(key);if(!entry.sources.includes(origin))entry.sources.push(origin);
    }
  }
  for(const b of bindings)if(!entries.has(b.teacher_key))entries.set(b.teacher_key,{key:b.teacher_key,name:b.teacher_name,unit:b.unit,sources:[],current:false});
  return [...entries.values()].map(e=>{const binding=byKey.get(e.key)??null;return {...e,binding,contact:byContact.get(binding?.contact_id)??null};}).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant')||a.unit.localeCompare(b.unit,'zh-Hant'));
}
export function groupedReminders(rows,reviews,contacts,bindings,now=Date.now()){
  const all=reminderItems(rows,reviews,now),active=all.filter(i=>i.review.active),byContact=new Map(contacts.map(c=>[c.id,c])),byKey=new Map(bindings.map(b=>[b.teacher_key,b])),groups=new Map(),unlinked=[];
  const seen=new Set();
  for(const item of active){
    const r=item.row;if(seen.has(r.id))continue;seen.add(r.id);
    const key=teacherKey(r.record.actual_teacher,r.unit),binding=byKey.get(key),contact=byContact.get(binding?.contact_id);
    if(!contact||cleanTeacher(contact.name)!==cleanTeacher(r.record.actual_teacher)){unlinked.push(item);continue;}
    if(!groups.has(contact.id))groups.set(contact.id,{contact,items:[],students:new Map()});
    const group=groups.get(contact.id);group.items.push(item);
    if(!group.students.has(r.studentId))group.students.set(r.studentId,{studentId:r.studentId,name:r.name,placements:[]});
    group.students.get(r.studentId).placements.push({id:r.id,unit:r.unit,course:r.course,start:r.start,end:r.end,batch:r.batch});
  }
  return {groups:[...groups.values()].map(g=>({...g,students:[...g.students.values()],emailValid:validTeacherEmail(g.contact.email)})).sort((a,b)=>a.contact.name.localeCompare(b.contact.name,'zh-Hant')),unlinked,confirmedCount:seen.size,pendingCount:all.length-active.length,asOf:new Date(now).toISOString(),mailEnabled:false};
}

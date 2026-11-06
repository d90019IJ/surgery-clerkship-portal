import {createPortal} from './portal.mjs';
import {sessionCodec} from './session.mjs';
import {supabaseRepository} from './quiz-supabase-repository.mjs';
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function all(path:string){const result=[];for(let offset=0;offset<100000;offset+=1000){const r=await fetch(url+'/rest/v1/'+path+'&limit=1000&offset='+offset,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Data unavailable');const rows=await r.json();result.push(...rows);if(rows.length<1000)return result;}throw new Error('Too many rows');}
const repository={
  quiz:supabaseRepository(url,key),
  catalog:()=>all('core_quiz_exams?select=id,title,open,opens_at,closes_at&order=opens_at.desc.nullslast,id.asc'),
  submissions:()=>all('core_quiz_submissions?select=exam_id,student_id,name,score,submitted_at,survey_complete&order=exam_id.asc,student_id.asc'),
  rosters:()=>all('core_quiz_roster?select=exam_id,student_id&order=exam_id.asc,student_id.asc'),
  osce:()=>all('clerk_osce_scores?select=*&order=id.asc'),
  teacherContacts:()=>all('clerk_teacher_contacts?select=*&order=id.asc'),
  teacherBindings:()=>all('clerk_teacher_bindings?select=*&order=teacher_key.asc'),
  teacherContactHistory:(id:string)=>all('clerk_teacher_contact_history?select=*&contact_id=eq.'+encodeURIComponent(id)+'&order=created_at.desc,id.asc'),
  saveTeacherContact:async(data:Record<string,unknown>)=>{const r=await fetch(url+'/rest/v1/rpc/save_clerk_teacher_contact',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Contact save unavailable');return await r.json();},
  reminderReviews:()=>all('clerk_reminder_reviews?select=*&order=row_id.asc'),
  reminderHistory:(id:string)=>all('clerk_reminder_review_history?select=*&row_id=eq.'+encodeURIComponent(id)+'&order=created_at.desc,id.asc'),
  saveReminderReview:async(data:Record<string,unknown>)=>{const r=await fetch(url+'/rest/v1/rpc/save_clerk_reminder_review',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Review save unavailable');return await r.json();},
  osceHistory:(id:string)=>all('clerk_osce_history?select=*&record_id=eq.'+encodeURIComponent(id)+'&order=created_at.desc,id.asc'),
  saveOsce:async(data:Record<string,unknown>)=>{const rpc='p_passport_completion' in data?'save_clerk_assessment':'save_clerk_osce';const r=await fetch(url+'/rest/v1/rpc/'+rpc,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Save unavailable');return await r.json();}
};
Deno.serve(createPortal({codec:await sessionCodec(key),repository}));

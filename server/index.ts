import {createPortal} from './portal.mjs';
import {sessionCodec} from './session.mjs';
import {supabaseRepository} from './quiz-supabase-repository.mjs';
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function all(path:string){const result=[];for(let offset=0;offset<100000;offset+=1000){const r=await fetch(url+'/rest/v1/'+path+'&limit=1000&offset='+offset,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Data unavailable');const rows=await r.json();result.push(...rows);if(rows.length<1000)return result;}throw new Error('Too many rows');}
const repository={
  quiz:supabaseRepository(url,key),
  catalog:()=>all('core_quiz_exams?select=id,title,open,opens_at,closes_at&order=opens_at.desc.nullslast,id.asc'),
  submissions:()=>all('core_quiz_submissions?select=exam_id,student_id,name,score,submitted_at,survey_complete&order=exam_id.asc,student_id.asc'),
  rosters:()=>all('core_quiz_roster?select=exam_id,student_id&order=exam_id.asc,student_id.asc')
};
Deno.serve(createPortal({codec:await sessionCodec(key),repository}));

import {createHandler as quizHandler,sha256} from './quiz-application.mjs';
import {studentCohorts,validScore} from '../web/score-rules.mjs';
import {reminderEligible,reminderSourceVersion,reminderItems,reminderReview} from '../web/reminder-rules.mjs';
export const SOURCE='https://surgery-clerkship-selection.d90019.chatgpt.site';
const ADMIN_ACTIONS=new Set(['admin-list','admin-toggle','admin-schedule','admin-survey','admin-roster','admin-roster-add','admin-open-now','admin-preview','admin-bank']);
export function createPortal({codec,repository,fetchSource=fetch,allowedOrigins=['https://d90019ij.github.io'],now=Date.now}){
  return async request=>{
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
    const reply=(body,status=200)=>Response.json(body,{status,headers});
    try{
      const origin=request.headers.get('origin');
      if(origin&&!allowedOrigins.includes(origin))return reply({error:'此網頁未獲准使用整合服務。'},403);
      if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type, authorization','Access-Control-Allow-Methods':'POST, OPTIONS'});
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(request.method!=='POST')return reply({error:'請由整合平台操作。'},405);
      if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'資料格式不正確。'},415);
      const raw=await request.text();if(raw.length>32768)return reply({error:'送出資料過長。'},413);
      let body;try{body=JSON.parse(raw);}catch{return reply({error:'資料格式不正確。'},400);}
      if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'資料格式不正確。'},400);
      if(body.action==='catalog')return reply({exams:await repository.catalog()});
      if(body.action==='login'){
        if(typeof body.employeeId!=='string'||typeof body.password!=='string'||body.employeeId.length>30||body.password.length>128)return reply({error:'請填寫助教員編與密碼。'},400);
        const result=await fetchSource(SOURCE+'/api/auth/staff-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employeeId:body.employeeId,password:body.password}),signal:AbortSignal.timeout(20000),redirect:'error'});
        const data=await result.json().catch(()=>null);
        if(!data)return reply({error:'選科系統暫時無法登入，請稍後再試。'},503);
        if(!result.ok)return reply({error:data.error||'登入失敗。'},result.status);
        if(data.mustChange)return reply({error:'請先至原選科系統完成首次密碼設定，再登入整合平台。'},409);
        const match=result.headers.get('set-cookie')?.match(/(?:^|[,;]\s*)staff_session=([a-f0-9]{64})(?:;|$)/);
        if(!match||typeof data.employeeId!=='string')return reply({error:'登入資訊不完整，請回原選科系統確認帳號。'},503);
        const ticket=await codec.issue({cookie:'staff_session='+match[1],employeeId:data.employeeId,name:data.name});
        return reply({...ticket,name:data.name,employeeId:data.employeeId});
      }
      const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
      const session=await codec.read(token);if(!session)return reply({error:'登入已失效，請重新登入。'},401);
      // Revalidate the original staff session for every operation. No source data is cached.
      const source=await fetchSource(SOURCE+'/api/grade-records',{headers:{cookie:session.cookie},signal:AbortSignal.timeout(20000),redirect:'error'});
      if(source.status===403||source.status===401)return reply({error:'原選科系統登入已失效，請重新登入。'},401);
      if(!source.ok)return reply({error:'暫時無法取得完整選科資料，請稍後再試。'},503);
      const grades=await source.json();if(!Array.isArray(grades.rows))return reply({error:'選科資料不完整，已停止操作。'},503);
      if(body.action==='reminder-list'){
        const records=await repository.reminderReviews(),time=now();
        return reply({items:reminderItems(grades.rows,records,time),asOf:new Date(time).toISOString(),mailEnabled:false});
      }
      if(body.action==='reminder-review'||body.action==='reminder-history'){
        const row=grades.rows.find(r=>r.id===body.id);
        if(!row)return reply({error:'找不到這段實習安排，請重新載入名單。'},404);
        if(body.action==='reminder-history')return reply({history:await repository.reminderHistory(row.id)});
        if(typeof body.confirmed!=='boolean'||typeof body.revision!=='string'||body.revision.length>40||typeof body.sourceVersion!=='string'||body.sourceVersion.length>8000)return reply({error:'核對資料不完整，請重新載入名單。'},400);
        const time=now();
        if(!reminderEligible(row,time))return reply({error:'這筆資料已不符合待提醒條件，可能已補分、尚未到期或配對有異動。請重新載入名單。'},409);
        if(body.sourceVersion!==reminderSourceVersion(row))return reply({error:'配對或實習資料已更新，請重新載入後再次核對。'},409);
        const result=await repository.saveReminderReview({p_row_id:row.id,p_source_version:reminderSourceVersion(row),p_confirmed:body.confirmed,p_revision:body.revision,p_actor:session.employeeId});
        if(result.conflict)return reply({error:'核對紀錄已被其他視窗更新，請重新載入後再確認。'},409);
        const savedAt=now();return reply({...result,review:reminderReview(row,result.record,savedAt),asOf:new Date(savedAt).toISOString(),mailEnabled:false});
      }
      if(body.action==='dashboard'){
        const [exams,submissions,rosters,osce]=await Promise.all([repository.catalog(),repository.submissions(),repository.rosters(),repository.osce()]);
        const known=new Set(studentCohorts(grades.rows).map(c=>c.id));
        return reply({rows:grades.rows,exams,submissions,rosters,osce:osce.filter(r=>known.has(r.id)),sourceUpdatedAt:new Date().toISOString()});
      }
      if(body.action==='osce-save'||body.action==='assessment-save'||body.action==='osce-history'){
        const cohort=studentCohorts(grades.rows).find(c=>c.id===body.id);
        if(!cohort)return reply({error:'找不到這位學生的實習梯次，請重新載入。'},404);
        if(body.action==='osce-history')return reply({history:await repository.osceHistory(cohort.id)});
        if(![body.suture,body.dressing].every(v=>v===null||validScore(v)))return reply({error:'縫合與換藥請填 0～100 分，未評分請留白。'},400);
        const withPassport=body.action==='assessment-save';
        if(withPassport&&body.passportCompletion!==null&&!validScore(body.passportCompletion))return reply({error:'護照完成率請填 0～100%，尚未確認請留白。'},400);
        if(typeof body.note!=='string'||body.note.length>500||typeof body.revision!=='string'||body.revision.length>40)return reply({error:'備註或版本資料不正確，請重新載入。'},400);
        const result=await repository.saveOsce({p_id:cohort.id,p_student_id:cohort.row.studentId,p_batch:cohort.row.batch,p_start:cohort.start,p_end:cohort.end,p_suture:body.suture,p_dressing:body.dressing,p_note:body.note,p_revision:body.revision,p_actor:session.employeeId,...(withPassport?{p_passport_completion:body.passportCompletion}:{})});
        if(result.conflict)return reply({error:'此成績已被其他視窗更新。請先保留本次輸入，關閉後重新載入，再核對最新分數。'},409);
        return reply(result);
      }
      if(body.action==='grade-save'){
        if(!body.record||!grades.rows.some(r=>r.id===body.record.id))return reply({error:'找不到這段實習安排。'},404);
        const result=await fetchSource(SOURCE+'/api/grade-records',{method:'POST',headers:{'content-type':'application/json',cookie:session.cookie,origin:SOURCE},body:JSON.stringify(body.record),signal:AbortSignal.timeout(20000),redirect:'error'});
        return reply(await result.json().catch(()=>({error:'尚未確認保存結果，請重新載入後核對。'})),result.status);
      }
      if(body.action==='grade-history'){
        if(typeof body.id!=='string'||!grades.rows.some(r=>r.id===body.id))return reply({error:'找不到這段實習安排。'},404);
        const result=await fetchSource(SOURCE+'/api/grade-records?history='+encodeURIComponent(body.id),{headers:{cookie:session.cookie},signal:AbortSignal.timeout(20000),redirect:'error'});
        return reply(await result.json(),result.status);
      }
      if(body.action==='quiz'){
        if(!body.payload||!ADMIN_ACTIONS.has(body.payload.action))return reply({error:'不支援的測驗管理操作。'},400);
        // A short-lived in-process credential delegates only after the staff session check above.
        const internalCode=crypto.randomUUID()+crypto.randomUUID();
        const wrapped={...repository.quiz,settings:async()=>({admin_hash:await sha256(internalCode),allowed_origins:[]})};
        const result=await quizHandler(wrapped)(new Request('https://internal.invalid/quiz',{method:'POST',headers:{'content-type':'application/json','x-teacher-code':internalCode},body:JSON.stringify(body.payload)}));
        return reply(await result.json(),result.status);
      }
      return reply({error:'不支援的操作。'},400);
    }catch{return reply({error:'連線中斷，尚未確認操作結果。請保留輸入並重新查詢。'},503);}
  };
}

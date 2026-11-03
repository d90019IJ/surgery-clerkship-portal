import {createHandler as quizHandler,sha256} from './quiz-application.mjs';
export const SOURCE='https://surgery-clerkship-selection.d90019.chatgpt.site';
const ADMIN_ACTIONS=new Set(['admin-list','admin-toggle','admin-schedule','admin-survey','admin-roster','admin-roster-add','admin-open-now','admin-preview','admin-bank']);
export function createPortal({codec,repository,fetchSource=fetch,allowedOrigins=['https://d90019ij.github.io']}){
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
      if(body.action==='dashboard'){
        const [exams,submissions,rosters]=await Promise.all([repository.catalog(),repository.submissions(),repository.rosters()]);
        return reply({rows:grades.rows,exams,submissions,rosters,sourceUpdatedAt:new Date().toISOString()});
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

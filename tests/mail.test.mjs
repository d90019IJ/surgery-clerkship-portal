import test from 'node:test';
import assert from 'node:assert/strict';
import {gmailProvider,GMAIL_SCOPE,messageRaw} from '../server/gmail.mjs';
import {handleMail} from '../server/reminder-mail.mjs';
import {createPortal} from '../server/portal.mjs';
import {batchCandidates,SCHOOL_SENDER} from '../server/reminder-batches.mjs';
import {teacherKey} from '../web/contact-rules.mjs';
import {reminderSourceVersion} from '../web/reminder-rules.mjs';
const time=Date.parse('2026-11-06T04:00:00Z'),clientId='test.apps.googleusercontent.com',accessToken='test-token-only';
test('Google identity verifies audience, send scope, expiry, verified school email and subject without leaking token in URLs',async()=>{
  const info={aud:clientId,scope:GMAIL_SCOPE,expires_in:3600,sub:'school-sub'},user={sub:'school-sub',email:SCHOOL_SENDER,email_verified:true};
  const setup=(i=info,u=user)=>gmailProvider({clientId,now:()=>time,fetchGoogle:async(url,opts)=>{assert.ok(!url.includes(accessToken));assert.equal(opts.headers.Authorization,'Bearer '+accessToken);assert.equal(opts.redirect,'error');if(url.includes('tokeninfo')){assert.equal(opts.method,'POST');assert.equal(opts.headers['Content-Type'],'application/x-www-form-urlencoded');}return Response.json(url.includes('tokeninfo')?i:u);}});
  assert.equal((await setup().identity(accessToken)).email,SCHOOL_SENDER);
  for(const patch of [{aud:'another-client'},{scope:'openid'},{expires_in:20},{sub:'other-sub'}])await assert.rejects(setup({...info,...patch}).identity(accessToken));
  for(const patch of [{email:'someone@example.com'},{email_verified:false},{sub:''}])await assert.rejects(setup(info,{...user,...patch}).identity(accessToken));
});
test('Google identity failures distinguish missing consent and provider errors without exposing credentials',async()=>{
  const setup=fetchGoogle=>gmailProvider({clientId,fetchGoogle});
  await assert.rejects(setup(async()=>Response.json({aud:clientId,scope:'openid',expires_in:3600})).identity(accessToken),/尚未允許寄信權限/);
  await assert.rejects(setup(async()=>new Response(accessToken,{status:400})).identity(accessToken),e=>e.message.includes('（400）')&&!e.message.includes(accessToken));
  await assert.rejects(setup(async()=>{throw new Error(accessToken);}).identity(accessToken),e=>e.message.includes('無法連線')&&!e.message.includes(accessToken));
});
test('Gmail send never retries rejection, timeout, ambiguous response or 5xx; only provider ID means sent',async()=>{
  for(const [response,status] of [[()=>Response.json({id:'gmail-id'}),'sent'],[()=>new Response('',{status:403}),'failed'],[()=>new Response('',{status:429}),'failed'],[()=>new Response('',{status:500}),'unknown'],[()=>Response.json({}),'unknown'],[()=>{throw new Error('token must never appear in error');},'unknown']]){
    let calls=0;const p=gmailProvider({clientId,fetchGoogle:async()=>{calls++;return response();}});const result=await p.send(accessToken,'raw');assert.equal(result.status,status);assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes('token must'));
  }
});
test('MIME preserves Chinese, frozen body and both recipients in ONE message, rejects header injection',()=>{
  const m={from:SCHOOL_SENDER,to:['one@example.com','two@example.com'],subject:'【外科實習評分提醒】敬請協助完成 TAS 學生實習評分',html:'<p>示範老師與學生</p>'};
  const raw=messageRaw(m,'<clerk-1234@d90019ij.github.io>',time),mime=Buffer.from(raw,'base64url').toString();
  assert.match(mime,/To: one@example.com, two@example.com\r\n/);assert.equal(Buffer.from(mime.split('\r\n\r\n')[1],'base64').toString(),m.html);
  const encoded=mime.match(/=\?UTF-8\?B\?([^?]+)\?=/g).map(v=>Buffer.from(v.slice(10,-2),'base64').toString()).join('');assert.equal(encoded,m.subject);
  for(const change of [{from:'wrong@example.com'},{to:['one@example.com\r\nBcc: bad@example.com']},{subject:'hello\r\nBcc: bad@example.com'}])assert.throws(()=>messageRaw({...m,...change},'<clerk-1234@d90019ij.github.io>',time));
});
async function setup(){
 const c={id:crypto.randomUUID(),name:'測試老師',email:'one@example.com',secondary_email:'two@example.com',revision:crypto.randomUUID()};
 const rows=[{id:'test-row',studentId:'TEST-1',name:'測試學生',unit:'一般外科',included:true,course:1,batch:'測試',start:'2026-10-01',end:'2026-10-20',selectedTeacher:c.name,record:{pairing_status:'paired',actual_teacher:c.name,score:null,revision:'v1'}}];
 const reviews=rows.map(r=>({row_id:r.id,source_version:reminderSourceVersion(r),confirmed:true,reviewed_at:new Date(time).toISOString(),revision:crypto.randomUUID()}));
 const bindings=[{teacher_key:teacherKey(c.name,rows[0].unit),contact_id:c.id,revision:crypto.randomUUID()}],contacts=[c];
 const m=(await batchCandidates(rows,reviews,contacts,bindings,time)).candidates[0];
 const batch={id:crypto.randomUUID(),revision:crypto.randomUUID(),confirmed:[c.id],messages:[m]},calls=[],deliveries=[];let outcome={status:'sent',providerId:'provider-id'},claimError='',finishError=false;
 const repository={reminderBatches:async()=>[batch],reminderDeliveries:async()=>deliveries,teacherContacts:async()=>contacts,teacherBindings:async()=>bindings,reminderReviews:async()=>reviews,
 mailRpc:async(name,p)=>{calls.push({name,p});if(name==='prepare_clerk_mail')return {intentId:crypto.randomUUID(),expiresAt:new Date(time+600000).toISOString()};if(name==='claim_clerk_mail')return claimError?{error:claimError}:{attemptId:crypto.randomUUID(),message:m,messageId:'<clerk-1234@d90019ij.github.io>'};if(finishError)throw new Error();return {status:p.p_status};}};
 const provider={identity:async()=>({email:SCHOOL_SENDER,sub:'school-sub',expiresAt:time+3600000}),send:async(token,raw)=>{calls.push({name:'provider',raw});return outcome;}};
 const payload={id:batch.id,revision:batch.revision,accessToken,teacherId:c.id,intentId:crypto.randomUUID(),confirmSend:true};
 const args={rows,repository,actor:'STAFF',now:time,clientId,provider};
 return {args,payload,batch,rows,c,reviews,calls,deliveries,run:(action,extra={})=>handleMail({...args,body:{...payload,action,...extra}}),setClaim:v=>claimError=v,setOutcome:v=>outcome=v,failFinish:()=>finishError=true};
}
test('connect and prepare NEVER send; prepare uses authenticated actor and frozen server recipients',async()=>{
 const s=await setup();assert.equal((await s.run('mail-connect')).status,200);assert.equal(s.calls.length,0);
 const r=await s.run('mail-prepare',{to:['forged@example.com'],actor:'FORGED'});assert.equal(r.status,200);assert.deepEqual(r.body.messages[0].to,['one@example.com','two@example.com']);assert.deepEqual(s.calls.map(c=>c.name),['prepare_clerk_mail']);assert.equal(s.calls[0].p.p_actor,'STAFF');
});
test('send requires explicit final confirmation and rejects changed scores, email, review or batch before claiming',async()=>{
 for(const mutate of [s=>s.payload.confirmSend=false,s=>s.rows[0].record.score=0,s=>s.c.email='new@example.com',s=>s.reviews[0].confirmed=false,s=>s.batch.confirmed=[],s=>s.batch.cancelled_at='now',s=>s.payload.revision=crypto.randomUUID()]){
  const s=await setup();mutate(s);assert.notEqual((await s.run('mail-send')).status,200);assert.equal(s.calls.length,0);
 }
});
test('send claims atomically before provider and records actual result; database refusal never sends',async()=>{
 const s=await setup();const result=await s.run('mail-send',{html:'forged',to:['forged@example.com']});assert.equal(result.body.status,'sent');assert.deepEqual(s.calls.map(c=>c.name),['claim_clerk_mail','provider','finish_clerk_mail']);assert.equal(s.calls[0].p.p_batch,s.batch.id);assert.equal(s.calls[2].p.p_provider,'provider-id');assert.ok(!Buffer.from(s.calls[1].raw,'base64url').toString().includes('forged'));
 const blocked=await setup();blocked.setClaim('Already processing');assert.equal((await blocked.run('mail-send')).status,409);assert.equal(blocked.calls.length,1);
});
test('ambiguous delivery and persistence failure are never retried or represented as sent',async()=>{
 const s=await setup();s.setOutcome({status:'unknown',error:'Check sent folder'});assert.equal((await s.run('mail-send')).body.status,'unknown');assert.equal(s.calls[2].p.p_status,'unknown');
 const failure=await setup();failure.failFinish();const result=await failure.run('mail-send');assert.equal(result.status,503);assert.match(result.body.error,/勿重寄/);assert.equal(failure.calls.filter(c=>c.name==='provider').length,1);
});
test('mail endpoints require staff session, allowed origin and current source session; no configured client fails closed',async()=>{
 const s=await setup();const handler=createPortal({codec:{read:async()=>null},repository:s.args.repository});
 for(const action of ['mail-config','mail-connect','mail-prepare','mail-send']){const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})}));assert.equal(r.status,401);}
 assert.equal((await handleMail({...s.args,clientId:'',body:{action:'mail-config'}})).body.configured,false);
 assert.equal((await handleMail({...s.args,clientId:'',body:{...s.payload,action:'mail-send'}})).status,503);assert.equal(s.calls.length,0);
});

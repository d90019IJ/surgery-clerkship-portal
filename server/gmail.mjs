import {SCHOOL_SENDER} from './reminder-batches.mjs';
import {validTeacherEmail} from '../web/contact-rules.mjs';
export const GMAIL_SCOPE='https://www.googleapis.com/auth/gmail.send';
export const GOOGLE_SCOPES=GMAIL_SCOPE+' openid https://www.googleapis.com/auth/userinfo.email';

export function gmailProvider({clientId,fetchGoogle=fetch,now=Date.now}){
  const options=token=>({headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(12000)});
  return {
    async identity(token){
      if(typeof token!=='string'||token.length<10||token.length>8192||/\s/.test(token))throw new Error('請先連結學校信箱。');
      let info,user;
      try{
        const r=await fetchGoogle('https://oauth2.googleapis.com/tokeninfo',{...options(token),method:'POST'});
        if(!r.ok)throw new Error();info=await r.json();
        if(info.aud!==clientId||!String(info.scope??'').split(' ').includes(GMAIL_SCOPE)||!(Number(info.expires_in)>60))throw new Error();
        const u=await fetchGoogle('https://openidconnect.googleapis.com/v1/userinfo',options(token));
        if(!u.ok)throw new Error();user=await u.json();
      }catch{throw new Error('信箱授權已失效或尚未允許寄信，請重新連結學校信箱。');}
      if(user.email!==SCHOOL_SENDER||user.email_verified!==true||!user.sub||info.sub&&info.sub!==user.sub)throw new Error('請使用 '+SCHOOL_SENDER+' 連結，其他帳號不能寄送。');
      return {email:user.email,sub:user.sub,expiresAt:now()+Number(info.expires_in)*1000};
    },
    async send(token,raw){
      // Deliberately no retry: a timeout may occur after Gmail has accepted the message.
      try{
        const r=await fetchGoogle('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
          ...options(token),method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({raw})});
        if(!r.ok)return {status:[400,401,403,404,413,429].includes(r.status)?'failed':'unknown',error:'Google 回應 '+r.status+'；'+(r.status<500?'請核對授權與寄送紀錄後再操作。':'寄送結果待查證，請先檢查寄件備份，勿重寄。')};
        const data=await r.json();
        if(typeof data.id!=='string'||!data.id)return {status:'unknown',error:'Google 未回傳郵件識別碼，請先檢查寄件備份，勿重寄。'};
        return {status:'sent',providerId:data.id};
      }catch{return {status:'unknown',error:'連線中斷，可能已寄出。請先檢查寄件備份，勿重寄。'};}
    }
  };
}
const base64=text=>{const bytes=new TextEncoder().encode(text);let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
export function messageRaw(message,messageId,time){
  if(message.from!==SCHOOL_SENDER||!Array.isArray(message.to)||!message.to.length||message.to.length>2||!message.to.every(validTeacherEmail)||typeof message.html!=='string'||typeof message.subject!=='string'||/[\r\n]/.test(message.subject)||!/^<clerk-[0-9a-f-]+@d90019ij\.github\.io>$/.test(messageId))throw new Error('信件資料不完整，已停止寄送。');
  const subject=Array.from(message.subject).reduce((a,c)=>{if(!a.length||new TextEncoder().encode(a.at(-1)+c).length>42)a.push(c);else a[a.length-1]+=c;return a;},[]).map(s=>'=?UTF-8?B?'+base64(s)+'?=').join('\r\n ');
  const mime=['From: '+SCHOOL_SENDER,'To: '+message.to.join(', '),'Subject: '+subject,'Date: '+new Date(time).toUTCString(),'Message-ID: '+messageId,'MIME-Version: 1.0','Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',''+base64(message.html).match(/.{1,76}/g)?.join('\r\n'),''].join('\r\n');
  return base64(mime).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}

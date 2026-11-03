const encoder=new TextEncoder(),decoder=new TextDecoder();
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
export async function sessionCodec(secret,now=()=>Date.now()){
  if(!secret)throw new Error('Missing session key');
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode('surgery-portal-session-v1:'+secret));
  const key=await crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
  return {
    async issue(identity){const iv=crypto.getRandomValues(new Uint8Array(12));const expiresAt=now()+2*60*60*1000;const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify({...identity,expiresAt})));return {token:encode(iv)+'.'+encode(new Uint8Array(cipher)),expiresAt};},
    async read(token){try{if(typeof token!=='string'||token.length>3000)throw 0;const parts=token.split('.');if(parts.length!==2)throw 0;const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(parts[0])},key,decode(parts[1]));const value=JSON.parse(decoder.decode(raw));if(!Number.isFinite(value.expiresAt)||value.expiresAt<=now()||typeof value.cookie!=='string'||!/^staff_session=[a-f0-9]{64}$/.test(value.cookie)||typeof value.employeeId!=='string')throw 0;return value;}catch{return null;}}
  };
}

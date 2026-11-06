// Access tokens live only in this closure, never in persistent browser storage.
export function createMailUI({api,esc,$,taipei,onChanged}){
  let config=null,accessToken='',expiresAt=0,email='',busy=false,epoch=0,notice='',sdkReady=false,client=null,intent=null,context=null;
  const connected=()=>!!accessToken&&Date.now()<expiresAt-60000;
  async function load(){
    if(config)return;
    const generation=epoch,result=await api('mail-config');if(generation!==epoch)return;config=result;
    if(!config.configured)return;
    try{
      if(!window.google?.accounts?.oauth2)await new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
        const timeout=setTimeout(()=>reject(new Error()),15000);script.onload=()=>{clearTimeout(timeout);resolve();};script.onerror=()=>{clearTimeout(timeout);reject(new Error());};document.head.append(script);
      });
      if(generation===epoch)sdkReady=!!window.google?.accounts?.oauth2;
    }catch{notice='Google 連線元件尚未載入，請重新整理頁面後再試。';}
  }
  function mount(batch,dirty){context={batch,dirty};intent=null;draw();}
  function invalidate(){intent=null;drawSend();}
  function draw(){
    if(!$('mail-account'))return;
    $('mail-account').innerHTML=`<section class="batch-panel"><h2>學校信箱連結</h2><p>寄件帳號：<b>${esc(config?.sender||'d90019@nycu.edu.tw')}</b></p>${!config?.configured?'<p class="amber">尚待完成 Google 信箱授權設定。目前無法寄信；已保存的核對資料會保留。</p>':`<p>${connected()?'已連結 '+esc(email)+' · 本次授權有效至 '+esc(taipei(expiresAt)):'尚未連結，或本次授權已到期。'}</p><button id="mail-connect" class="secondary" ${!sdkReady?'disabled':''}>${connected()?'重新連結學校信箱':'連結學校信箱'}</button>${connected()?' <button id="mail-disconnect" class="text-button">中斷本次連線</button>':''}`}<p class="hint">連結信箱、保存核對、查看寄送摘要都不會寄信。只有按最後的「確認寄出」才會寄送。重新整理或登出後需重新連結。</p><p id="mail-status" role="status">${esc(notice)}</p></section>`;
    if($('mail-connect'))$('mail-connect').onclick=connect;
    if($('mail-disconnect'))$('mail-disconnect').onclick=()=>{if(busy)return;accessToken='';email='';expiresAt=0;intent=null;notice='已中斷本次連線，不會寄信。';draw();};
    drawSend();
  }
  function drawSend(){
    const host=$('mail-send-panel'),b=context?.batch;if(!host)return;
    if(!b||b.cancelled_at){host.innerHTML='';return;}
    const count=b.messages.filter(m=>b.confirmed.includes(m.teacherId)&&(!m.delivery||m.delivery.status==='failed')).length;
    const dirty=context.dirty(),ready=connected()&&count>0&&!dirty;
    host.innerHTML=`<section class="batch-panel"><h2>確認寄出</h2><p>${dirty?'請先保存上方勾選，再核對寄送摘要。':`本批已保存確認、尚可寄送：${count} 封。已寄出及結果待查證的信件不會重寄。`}</p>${intent?`<div class="mail-final"><h3>最後核對本次寄送</h3><p>寄件人：${esc(intent.sender)}<br>此摘要有效至 ${esc(taipei(intent.expiresAt))}</p><ul>${intent.messages.map(m=>`<li><b>${esc(m.teacherName)}</b> · ${m.studentCount} 位學生<br>收件人：${m.to.map(esc).join('、')}<br>主旨：${esc(m.subject)}</li>`).join('')}</ul><p>內容為上方已核對的完整信件。按下後會立即逐封寄送，請留在本頁。</p><button id="mail-send-final" class="primary">確認寄出（${intent.messages.length} 封）</button> <button id="mail-send-cancel" class="secondary">先不寄送</button></div>`:`<button id="mail-prepare" class="primary" ${!ready?'disabled':''}>核對寄送摘要（不寄信）</button>${!connected()?'<p class="hint">請先完成上方學校信箱連結。</p>':''}`}<p id="mail-progress" role="status"></p></section>`;
    if($('mail-prepare'))$('mail-prepare').onclick=()=>void prepare();
    if($('mail-send-final'))$('mail-send-final').onclick=()=>void send();
    if($('mail-send-cancel'))$('mail-send-cancel').onclick=()=>{intent=null;drawSend();};
  }
  function lock(value){busy=value;document.querySelectorAll('#content button,#content input').forEach(e=>{if(value){e.dataset.mailDisabled=String(e.disabled);e.disabled=true;}else if('mailDisabled' in e.dataset){e.disabled=e.dataset.mailDisabled==='true';delete e.dataset.mailDisabled;}});}
  function message(text){notice=text;if($('mail-status'))$('mail-status').textContent=text;}
  function connect(){
    if(busy||!sdkReady||!config?.configured)return;
    const generation=epoch;intent=null;lock(true);message('請在 Google 視窗登入學校帳號並確認授權；這一步不會寄信。');
    const failed=()=>{if(generation!==epoch)return;lock(false);message('尚未完成信箱連結，可再次按連結。');};
    try{
      client=window.google.accounts.oauth2.initTokenClient({client_id:config.clientId,scope:config.scopes,include_granted_scopes:false,hint:config.sender,
        error_callback:failed,callback:async response=>{
          if(generation!==epoch)return;
          if(response.error||!response.access_token){failed();return;}
          try{const identity=await api('mail-connect',{accessToken:response.access_token});if(generation!==epoch)return;accessToken=response.access_token;expiresAt=identity.expiresAt;email=identity.email;notice='已連結學校信箱；這次連結操作沒有寄信。';}
          catch(e){if(generation!==epoch)return;accessToken='';expiresAt=0;email='';notice=e.message;}
          finally{if(generation===epoch){lock(false);draw();}}
        }});
      client.requestAccessToken({prompt:'select_account'});
    }catch{failed();}
  }
  async function prepare(){
    if(busy||!connected()||context.dirty())return;
    const generation=epoch,b=context.batch;lock(true);
    try{const result=await api('mail-prepare',{id:b.id,revision:b.revision,accessToken});if(generation!==epoch)return;intent=result;message('摘要已備妥，尚未寄信。請核對後再按「確認寄出」。');}
    catch(e){if(generation===epoch){intent=null;message(e.message);}}
    finally{if(generation===epoch){lock(false);drawSend();}}
  }
  async function send(){
    if(busy||!intent||!connected()||context.dirty())return;
    if(Date.now()>=Date.parse(intent.expiresAt)){intent=null;message('寄送摘要已過期，請重新核對。');drawSend();return;}
    const generation=epoch,b=context.batch,approved=intent;intent=null;lock(true);let sent=0;
    try{
      for(const m of approved.messages){
        if(generation!==epoch)break;
        if(!connected())throw new Error('信箱授權已到期，已停止後續寄送。請重新連結並核對剩餘信件。');
        if($('mail-progress'))$('mail-progress').textContent=`正在處理 ${sent+1}／${approved.messages.length} 封：${m.teacherName}老師`;
        const result=await api('mail-send',{id:b.id,revision:b.revision,intentId:approved.intentId,teacherId:m.teacherId,confirmSend:true,accessToken});
        if(generation!==epoch)return;
        if(result.status!=='sent')throw new Error(result.error||'寄送結果待查證，已停止後續寄送。');
        sent++;
      }
      message(`本次 ${sent} 封已由 Google 接受寄送，可至寄送紀錄查看。`);
    }catch(e){if(generation===epoch)message(`本次已確認寄出 ${sent} 封。${e.message} 請查看最新寄送紀錄；系統不會自動重試。`);}
    finally{if(generation===epoch){lock(false);await onChanged();}}
  }
  window.addEventListener('beforeunload',e=>{if(busy)e.preventDefault();});
  return {load,mount,invalidate,isBusy:()=>busy,reset:()=>{epoch++;lock(false);config=null;accessToken='';expiresAt=0;email='';intent=null;context=null;client=null;notice='';sdkReady=false;}};
}

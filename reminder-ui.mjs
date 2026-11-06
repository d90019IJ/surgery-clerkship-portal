import {confirmReminderItems} from './reminder-bulk.mjs';
import {reminderReview} from './reminder-rules.mjs';

export function createReminderUI({state,api,esc,$,taipei,openStudent}){
  let items=[],asOf='',clockAt='',query='',filter='all',epoch=0,busy=false,notice='',failed=false;
  const current=g=>g===epoch&&state.tab==='reminders'&&!!state.token;
  function reset(){epoch++;items=[];asOf='';clockAt='';query='';filter='all';busy=false;notice='';}
  async function render(){
    const generation=++epoch;items=[];notice='';$('filters').innerHTML='';$('content').innerHTML='<p class="empty" role="status">正在取得最新待提醒名單…</p>';
    try{const result=await api('reminder-list');if(!current(generation))return;items=result.items;asOf=result.asOf;clockAt=result.asOf;receivedAt=performance.now();draw();}
    catch(e){if(current(generation))$('content').innerHTML=`<p class="error" role="alert">${esc(e.message)}</p><button type="button" class="secondary" id="reminder-retry">重新載入名單</button>`;if(current(generation))$('reminder-retry').onclick=render;}
  }
  function draw(){
    if(state.tab!=='reminders'||!state.token)return;
    $('filters').innerHTML=`<div class="filters"><label>搜尋老師或學生<input id="reminder-search" value="${esc(query)}" placeholder="老師姓名、學生姓名、學號或科別"></label><label>核對進度<select id="reminder-filter"><option value="all">全部待提醒項目</option><option value="pending">只看待核對</option><option value="confirmed">只看已確認</option></select></label></div>`;
    $('reminder-filter').value=filter;
    $('reminder-search').oninput=e=>{query=e.target.value.trim();drawList();};
    $('reminder-filter').onchange=e=>{filter=e.target.value;drawList();};drawList();
  }
  function drawList(){
    // Refresh expiry relative to server time, advanced only by elapsed time in this page.
    const time=serverNow();items.forEach(item=>{item.review=reminderReview(item.row,item.record,time);});
    const base=items.filter(({row:r})=>!query||`${r.record.actual_teacher} ${r.name} ${r.studentId} ${r.unit} ${r.batch}`.includes(query));
    const visible=base.filter(i=>filter==='all'||(filter==='confirmed'?i.review.active:!i.review.active));
    const active=base.filter(i=>i.review.active).length,pendingVisible=visible.filter(i=>!i.review.active).length;
    $('content').innerHTML=`<div class="notice reminder-notice"><b>目前只建立名單與保存核對，不會寄信。</b><br>實習結束後第 8 天起，已配對且平台分數留白的項目列入名單。請先至院內系統查證，再勾選「確認仍未評分」。<br>每次確認有效七天；到期或配對資料變更需重新核對。未核對、未配對、選科有異動與已有分數（含 0 分）的項目不會列入。</div><div class="table-tools"><p>目前範圍 ${base.length} 段實習 · 待核對 ${base.length-active} 段 · 已確認 ${active} 段</p><button type="button" id="reminder-refresh" class="secondary">更新待提醒名單</button></div><div class="table-tools"><button type="button" id="reminder-confirm-all" class="primary"${pendingVisible?'':' disabled'}>全選確認仍未評分（${pendingVisible} 段）</button><p class="hint">請先核對院內資料。只確認目前搜尋與篩選中待核對的項目，按下後立即逐筆保存；已確認項目不重複更新，不會寄信。</p></div><p class="hint">資料更新：${esc(taipei(asOf))}。取消勾選會撤回確認，保留歷程。</p><p id="reminder-message" class="${failed?'error':'success'}" role="status"${notice?'':' hidden'}>${esc(notice)}</p><div class="table-wrap"><table class="reminder-table"><thead><tr><th>院內實際老師</th><th>學生／科別</th><th>實習期間／可提醒日</th><th>核對狀態</th><th>操作</th></tr></thead><tbody>${visible.map(item=>{
      const r=item.row,review=item.review,index=items.indexOf(item),status={pending:'待核對',changed:'配對或資料已變更，請重新核對',revoked:'已撤回確認',expired:'已超過七天，請重新核對',confirmed:'已確認 · 未寄信'}[review.reason];
      return `<tr><td><b>${esc(r.record.actual_teacher)}</b><small>以院內配對為準</small></td><td><b>${esc(r.name)}</b><small>${esc(r.studentId)} · ${esc(r.batch)} · ${esc(r.group)}</small><small>${esc(r.unit)} · Course ${esc(r.course)}</small></td><td>${esc(r.start)} ～ ${esc(r.end)}<small>可提醒日：${esc(new Date(Date.parse(item.dueAt)+8*3600000).toISOString().slice(0,10))}</small></td><td><label class="reminder-check"><input type="checkbox" data-review="${index}"${review.active?' checked':''} aria-label="確認仍未評分：${esc(r.name)} Course ${esc(r.course)} ${esc(r.record.actual_teacher)}">確認仍未評分</label><span class="${review.active?'':'amber'}">${status}</span>${item.record?`<small>上次操作：${esc(taipei(item.record.reviewed_at))}<br>核對者：${esc(item.record.reviewed_by)}</small>`:''}${review.active?`<small>下次需核對：${esc(taipei(review.expiresAt))}</small>`:''}<details data-history="${index}"><summary>核對紀錄</summary><div data-history-content="${index}"></div></details></td><td><button type="button" data-open="${index}" class="secondary">核對／補登分數</button></td></tr>`;
    }).join('')}</tbody></table>${visible.length?'':`<p class="empty">${items.length?'沒有符合此篩選的項目。':'目前沒有符合條件的待提醒項目。'}</p>`}</div>`;
    $('reminder-refresh').onclick=render;
    $('reminder-confirm-all').onclick=()=>void saveAll(visible);
    document.querySelectorAll('[data-review]').forEach(box=>box.onchange=()=>save(items[Number(box.dataset.review)],box.checked));
    document.querySelectorAll('[data-open]').forEach(button=>button.onclick=()=>openStudent(items[Number(button.dataset.open)].row));
    document.querySelectorAll('[data-history]').forEach(detail=>detail.ontoggle=()=>{if(detail.open&&!detail.dataset.loaded){detail.dataset.loaded='true';void history(items[Number(detail.dataset.history)],detail);}});
  }
  let receivedAt=performance.now();
  function serverNow(){return Date.parse(clockAt)+(performance.now()-receivedAt);}
  function lock(value){busy=value;document.querySelectorAll('#filters input,#filters select,#content button,#content input,[data-tab],#reload,#logout').forEach(el=>{if(value){el.dataset.reminderWasDisabled=String(el.disabled);el.disabled=true;}else if('reminderWasDisabled' in el.dataset){el.disabled=el.dataset.reminderWasDisabled==='true';delete el.dataset.reminderWasDisabled;}});}
  async function save(item,confirmed){
    if(busy)return;const generation=epoch;lock(true);notice='';failed=false;
    const message=$('reminder-message');message.hidden=false;message.className='hint';message.textContent='正在保存核對紀錄…';
    try{const result=await api('reminder-review',{id:item.row.id,sourceVersion:item.sourceVersion,revision:item.record?.revision??'',confirmed});if(!current(generation))return;item.record=result.record;item.review=result.review;clockAt=result.asOf;receivedAt=performance.now();notice=confirmed?'已保存「確認仍未評分」。目前不會寄出信件。':'已撤回確認，原核對歷程保留。';}
    catch(e){if(current(generation)){notice=e.message;failed=true;}}
    finally{if(generation===epoch){lock(false);if(current(generation))drawList();}}
  }
  async function saveAll(visible){
    if(busy)return;const generation=epoch;lock(true);notice='';failed=false;
    const message=$('reminder-message');message.hidden=false;message.className='hint';
    try{
      const result=await confirmReminderItems(visible,{
        api,now:serverNow,isCurrent:()=>current(generation),
        onSaved:(item,response)=>{item.record=response.record;item.review=response.review;clockAt=response.asOf;receivedAt=performance.now();},
        onProgress:result=>{if(current(generation))message.textContent='正在保存核對：'+result.saved+'／'+result.total+' 段。請留在此頁，這個操作不會寄信。';}
      });
      if(!current(generation))return;
      if(result.failure){
        const {row}=result.failure.item;failed=true;
        notice='已成功確認 '+result.saved+'／'+result.total+' 段；已停止後續保存。'+row.name+'（'+row.studentId+'，Course '+row.course+'，'+row.record.actual_teacher+'）：'+result.failure.message+' 這筆請更新名單核對保存結果；另有 '+(result.remaining-1)+' 段尚未處理。成功項目已保留，請重新核對後再操作。沒有寄信。';
      }else notice=result.total?'已保存目前篩選內的 '+result.saved+' 段「確認仍未評分」。已確認項目維持原核對時間，沒有寄信。':'目前篩選內沒有需要重新確認的項目，沒有修改資料或寄信。';
    }catch(e){if(current(generation)){notice='批次核對已停止：'+e.message+' 請更新名單後核對保存結果；已成功保存的項目會保留。';failed=true;}}
    finally{if(generation===epoch){lock(false);if(current(generation))drawList();}}
  }
  async function history(item,detail){
    const generation=epoch,target=detail.querySelector('[data-history-content]');target.textContent='正在載入…';
    try{const result=await api('reminder-history',{id:item.row.id});if(!current(generation)||!target.isConnected)return;target.innerHTML=result.history.map(h=>`<div class="history-item"><b>${h.after_value.confirmed?'確認仍未評分':'撤回確認'}</b><small>${esc(taipei(h.created_at))} · ${esc(h.actor)}</small></div>`).join('')||'<p class="hint">尚無核對紀錄。</p>';}
    catch(e){if(current(generation)&&target.isConnected){target.textContent=e.message;delete detail.dataset.loaded;}}
  }
  setInterval(()=>{if(state.tab==='reminders'&&state.token&&asOf&&!busy&&items.some(i=>i.review.active&&!reminderReview(i.row,i.record,serverNow()).active))drawList();},30000);
  window.addEventListener('beforeunload',event=>{if(busy)event.preventDefault();});
  return {render,reset:()=>{lock(false);reset();},isBusy:()=>busy};
}

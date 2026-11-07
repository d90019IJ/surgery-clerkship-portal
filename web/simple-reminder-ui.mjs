import {reminderGroups,prepareReminderBatch,confirmPreviewBatch} from './reminder-workflow.mjs';

export function createReminderUI({state,api,esc,$,taipei,mailUI,openStudent,openHistory}){
  let groups=[],batchData=null,selected=new Set(),query='',busy=false,epoch=0,notice='',clockAt=0,receivedAt=0,requestId='';
  const current=g=>g===epoch&&state.tab==='reminders'&&!!state.token;
  const now=()=>clockAt+(performance.now()-receivedAt);
  const visible=()=>groups.filter(g=>!query||[g.name,...g.to,...g.items.flatMap(i=>[i.row.name,i.row.studentId,i.row.unit])].join(' ').includes(query));
  function lock(value){busy=value;document.querySelectorAll('#filters input,#content button,#content input,[data-tab],#reload,#logout').forEach(el=>{if(value){el.dataset.reminderWasDisabled=String(el.disabled);el.disabled=true;}else if('reminderWasDisabled' in el.dataset){el.disabled=el.dataset.reminderWasDisabled==='true';delete el.dataset.reminderWasDisabled;}});}
  async function render(){
    if(busy)return;
    const generation=++epoch;selected.clear();requestId='';lock(true);$('filters').innerHTML='';$('content').textContent='正在核對最新名單與寄送紀錄…';
    try{
      const [list,directory,batches]=await Promise.all([api('reminder-list'),api('teacher-directory'),api('reminder-batches')]);
      if(!current(generation))return;
      clockAt=Date.parse(list.asOf);receivedAt=performance.now();batchData=batches;groups=reminderGroups(list.items,directory,batches,now());draw();
    }catch(e){if(current(generation)){$('content').innerHTML=`<p class="error" role="alert">${esc(e.message)}</p><button id="reminder-retry" class="secondary">重新載入</button>`;$('reminder-retry').onclick=()=>void render();}}
    finally{if(generation===epoch)lock(false);}
  }
  function rows(items){return `<div class="table-wrap"><table><thead><tr><th>學生</th><th>科別</th><th>實習期間</th><th></th></tr></thead><tbody>${items.map(({row:r})=>`<tr><td><b>${esc(r.name)}</b><small>${esc(r.studentId)}</small></td><td>${esc(r.unit)}<small>Course ${esc(r.course)}</small></td><td>${esc(r.start)} ～ ${esc(r.end)}</td><td><button class="text-button" data-open-student="${esc(r.id)}">補登分數</button></td></tr>`).join('')}</tbody></table></div>`;}
  function pending(){
    const batches=batchData.batches.filter(b=>!b.cancelled_at&&b.messages.some(m=>!m.delivery||m.delivery.status!=='sent'));
    if(!batches.length)return '';
    return `<section class="batch-panel"><h2>尚未完成的提醒</h2><p>上次停在預覽的內容保留在這裡，可直接繼續。已寄出的信件不會重寄。</p>${batches.map(b=>{
      const remaining=b.messages.filter(m=>!m.delivery),canResume=remaining.length&&remaining.every(m=>m.current)&&!b.messages.some(m=>m.delivery&&m.delivery.status!=='sent');
      return `<article class="batch-message"><h3>${esc(taipei(b.created_at))} · 尚未寄出 ${remaining.length} 封</h3><p>${b.messages.map(m=>`${esc(m.teacherName)}：${m.delivery?esc({sent:'已寄出',sending:'處理中',unknown:'結果待查證',failed:'寄送失敗'}[m.delivery.status]||'待查證'):m.current?'待寄送':'需重新核對'}`).join('、')}</p>${canResume?`<button class="primary" data-resume="${esc(b.id)}">繼續預覽並寄送</button>`:'<p class="amber">資料已變更、核對已過期或寄送結果待查證，請先查看紀錄。</p>'} <button class="secondary" data-view-history="${esc(b.id)}">查看內容與紀錄</button>${!b.messages.some(m=>m.delivery)?` <button class="text-button" data-cancel="${esc(b.id)}">取消這份待寄提醒</button>`:''}</article>`;
    }).join('')}</section>`;
  }
  function draw(){
    if(!current(epoch))return;
    $('filters').innerHTML=`<div class="filters"><label>搜尋老師或學生<input id="reminder-search" placeholder="姓名、學號、科別或 Email" value="${esc(query)}"></label></div>`;
    $('reminder-search').oninput=e=>{query=e.target.value.trim();drawList();};drawList();
  }
  function drawList(){
    const all=visible(),recent=all.filter(g=>g.blocks.some(b=>b.kind==='recent')),list=all.filter(g=>!recent.includes(g));
    const recentCount=batchData.batches.reduce((n,b)=>n+b.messages.filter(m=>m.delivery?.status==='sent'&&now()-Date.parse(m.delivery.sent_at)<7*86400000).length,0);
    $('content').innerHTML=`<div class="batch-notice"><b>先核對院內評分，再勾選；最後確認才寄信。</b><p>實習結束後第 8 天起列入。每週續寄前需重新核對，已寄出未滿一週的項目不列入全選。</p></div><div class="table-tools"><p>${recentCount?`最近一週已寄出 ${recentCount} 封，已排除重複寄送。`:'目前沒有最近一週已寄出的信件。'}</p><button id="reminder-refresh" class="secondary">更新名單</button><button id="reminder-history" class="text-button">查看寄送紀錄</button></div><p id="reminder-message" role="status">${esc(notice)}</p><section class="batch-panel"><p class="eyebrow">步驟 1／2</p><h2>確認仍未評分的老師與學生</h2><div class="batch-actions"><button id="reminder-confirm-all" class="secondary">全選確認仍未評分</button><button id="reminder-select-none" class="secondary">取消目前篩選的全選</button><span id="reminder-count" role="status"></span></div><p class="hint">全選只勾選目前搜尋範圍內可寄送的老師；同一位老師的學生合併成一封。勾選不會寄信。</p>${list.map(g=>`<article class="batch-message reminder-teacher"><div class="reminder-teacher-head"><h3>${esc(g.name)}老師</h3><label class="batch-check"><input type="checkbox" data-select-teacher="${esc(g.id)}" aria-label="確認仍未評分：${esc(g.name)}老師" ${!g.selectable?'disabled':''}>確認仍未評分</label></div><p>收件人：${g.to.length?g.to.map(esc).join('、'):'尚待補齊'}${g.reason?`<br><span class="amber">${esc(g.reason)}</span>`:''}</p>${rows(g.items)}</article>`).join('')||'<p class="empty">目前範圍沒有新的待寄提醒。</p>'}</section>${pending()}${recent.length?`<details class="batch-panel"><summary>已排除：已寄出未滿一週（${recent.length} 位老師）</summary>${recent.map(g=>`<p><b>${esc(g.name)}</b> · ${esc(g.reason)}</p>`).join('')}</details>`:''}<div class="reminder-footer"><span id="reminder-total"></span><button id="reminder-preview" class="primary">預覽並寄送</button></div>`;
    $('reminder-refresh').onclick=()=>void render();$('reminder-history').onclick=()=>openHistory();
    $('reminder-confirm-all').onclick=()=>{for(const g of visible())if(g.selectable)selected.add(g.id);requestId='';sync();};
    $('reminder-select-none').onclick=()=>{for(const g of visible())selected.delete(g.id);requestId='';sync();};
    document.querySelectorAll('[data-select-teacher]').forEach(el=>el.onchange=()=>{el.checked?selected.add(el.dataset.selectTeacher):selected.delete(el.dataset.selectTeacher);requestId='';sync();});
    document.querySelectorAll('[data-open-student]').forEach(el=>el.onclick=()=>openStudent(groups.flatMap(g=>g.items).find(i=>i.row.id===el.dataset.openStudent).row));
    document.querySelectorAll('[data-view-history]').forEach(el=>el.onclick=()=>openHistory(el.dataset.viewHistory));
    document.querySelectorAll('[data-resume]').forEach(el=>el.onclick=()=>void preview(batchData.batches.find(b=>b.id===el.dataset.resume)));
    document.querySelectorAll('[data-cancel]').forEach(el=>el.onclick=()=>void cancel(batchData.batches.find(b=>b.id===el.dataset.cancel)));
    $('reminder-preview').onclick=()=>void preview();sync();
  }
  function sync(){
    document.querySelectorAll('[data-select-teacher]').forEach(el=>el.checked=selected.has(el.dataset.selectTeacher));
    const available=visible().filter(g=>g.selectable),count=available.filter(g=>selected.has(g.id)).length;
    $('reminder-count').textContent=`目前篩選已選 ${count}／${available.length} 位老師`;
    $('reminder-confirm-all').disabled=count===available.length;$('reminder-select-none').disabled=!count;
    $('reminder-total').textContent=`共選 ${selected.size} 位老師，將合併成 ${selected.size} 封信${selected.size>count?'（包含其他搜尋範圍的勾選）':''}`;
    $('reminder-preview').disabled=!selected.size;
  }
  async function preview(existing){
    if(busy||mailUI.isBusy())return;const generation=epoch;lock(true);notice='';
    try{
      await mailUI.load();if(!current(generation))return;
      let batch;
      if(existing){const fresh=await api('reminder-batches');if(!current(generation))return;batch=await confirmPreviewBatch(fresh.batches.find(b=>b.id===existing.id),api);}
      else {requestId ||= crypto.randomUUID();batch=await prepareReminderBatch(groups.filter(g=>selected.has(g.id)),{api,now,requestId,onProgress:(n,total)=>{if($('reminder-message'))$('reminder-message').textContent=`正在保存核對 ${n}／${total} 段，尚未寄信…`;}});}
      if(!current(generation))return;
      selected.clear();$('filters').innerHTML='';$('content').innerHTML='<p id="reminder-message" role="status">已備妥信件，尚未寄出。</p><div id="mail-account"></div><div id="mail-send-panel"></div>';
      await mailUI.preview(batch,()=>{notice='已保留尚未寄出的提醒，可直接繼續預覽。';void render();});
      if(current(generation))$('content').scrollIntoView({block:'start'});
    }catch(e){if(current(generation)){notice=e.message+' 已保存的核對會保留，請更新名單後繼續。';if($('reminder-message'))$('reminder-message').textContent=notice;}}
    finally{if(generation===epoch)lock(false);}
  }
  async function cancel(batch){
    if(busy||!confirm('取消這份尚未寄出的提醒？學生資料、核對及歷史紀錄都會保留。'))return;
    const generation=epoch;lock(true);
    try{await api('reminder-batch-cancel',{id:batch.id,revision:batch.revision});notice='已取消待寄提醒，沒有寄信；紀錄保留。';}
    catch(e){notice=e.message;}
    finally{if(generation===epoch){lock(false);void render();}}
  }
  window.addEventListener('beforeunload',e=>{if(busy||selected.size)e.preventDefault();});
  return {render,isBusy:()=>busy,reset:()=>{epoch++;lock(false);groups=[];batchData=null;selected.clear();query='';notice='';requestId='';},refreshAfterMail:message=>{notice=message||'請至「寄送紀錄」查看逐封結果。';return render();}};
}

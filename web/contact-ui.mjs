import {validTeacherEmail} from './contact-rules.mjs';

export function createContactUI({state,api,esc,$,taipei}){
  let entries=[],contacts=[],drafts=new Map(),mode='directory',query='',missing=false,busy=false,epoch=0,notice='',failed=false;
  const current=g=>g===epoch&&state.tab==='contacts'&&!!state.token;
  const original=e=>({contactId:e.contact?.id??null,email:e.contact?.email??'',hospitalCode:e.contact?.hospital_code??'',revision:e.contact?.revision??'',bindingRevision:e.binding?.revision??''});
  const draft=e=>drafts.get(e.key)??original(e);
  const dirty=e=>{const d=draft(e),o=original(e);return ['contactId','email','hospitalCode'].some(k=>d[k]!==o[k]);};
  const hasDirty=()=>entries.some(dirty);
  function lock(value){busy=value;document.querySelectorAll('#filters input,#filters select,#content button,#content input,#content select,[data-tab],#reload,#logout').forEach(el=>{if(value){el.dataset.contactDisabled=String(el.disabled);el.disabled=true;}else if('contactDisabled' in el.dataset){el.disabled=el.dataset.contactDisabled==='true';delete el.dataset.contactDisabled;}});}
  function reset(){lock(false);epoch++;entries=[];contacts=[];drafts.clear();mode='directory';query='';missing=false;notice='';}
  async function render(){
    const generation=++epoch;$('filters').innerHTML='';$('content').innerHTML='<p class="empty" role="status">正在讀取老師通訊錄…</p>';
    try{const d=await api('teacher-directory');if(!current(generation))return;entries=d.entries;contacts=d.contacts;draw();}catch(e){if(current(generation))$('content').innerHTML=`<p class="error" role="alert">${esc(e.message)}</p>`;}
  }
  function draw(){
    $('filters').innerHTML=`<div class="table-tools"><button id="contact-directory" class="${mode==='directory'?'primary':'secondary'}">老師 Email 通訊錄</button><button id="contact-preview" class="${mode==='preview'?'primary':'secondary'}">合併提醒預覽</button></div><p class="hint">目前只保存信箱與預覽名單，不會寄信。預覽依已儲存的通訊錄與有效核對紀錄產生。</p>${mode==='directory'?`<div class="filters"><label>搜尋老師／科別／信箱<input id="contact-search" value="${esc(query)}"></label><label class="reminder-check"><input id="contact-missing" type="checkbox"${missing?' checked':''}>只看尚缺 Email</label></div>`:''}`;
    $('contact-directory').onclick=()=>{mode='directory';epoch++;draw();};$('contact-preview').onclick=()=>{mode='preview';epoch++;draw();};
    if(mode==='preview'){void preview();return;}
    $('contact-search').oninput=e=>{query=e.target.value.trim();list();};$('contact-missing').onchange=e=>{missing=e.target.checked;list();};list();
  }
  function list(){
    const visible=entries.filter(e=>(!query||`${e.name} ${e.unit} ${draft(e).email} ${draft(e).hospitalCode}`.toLowerCase().includes(query.toLowerCase()))&&(!missing||!validTeacherEmail(draft(e).email)));
    $('content').innerHTML=`<p>每位老師填一次信箱，按「儲存」。同名老師跨科別時，可選擇共用已存的通訊錄；若是不同人，請另建一筆，並填識別註記。</p><p id="contact-message" class="${failed?'error':'success'}" role="status">${esc(notice)}</p><div class="contact-list">${visible.map(e=>{
      const i=entries.indexOf(e),d=draft(e),same=contacts.filter(c=>c.name===e.name),shared=entries.filter(x=>x.binding?.contact_id&&x.binding.contact_id===d.contactId);
      return `<form class="contact-card" data-contact="${i}"><div class="contact-heading"><div><h2>${esc(e.name)}</h2><p>${esc(e.unit)} · ${e.current?esc(e.sources.join('／')):'已存通訊錄'}</p></div><span data-save-status>${dirty(e)?'尚未儲存':e.contact?'已儲存':'尚未建立'}</span></div>${same.length?`<label>通訊錄歸屬<select data-field="contactId" aria-label="${esc(e.name)} ${esc(e.unit)} 通訊錄歸屬"><option value="">另建一筆通訊錄</option>${same.map(c=>`<option value="${esc(c.id)}"${c.id===d.contactId?' selected':''}>${esc(c.name)} · ${esc(c.hospital_code||'無識別註記')} · ${esc(c.email||'尚缺 Email')}</option>`).join('')}</select></label>`:''}<div class="contact-fields"><label>Email<input data-field="email" type="email" maxlength="254" autocomplete="off" value="${esc(d.email)}" placeholder="teacher@example.edu.tw"></label><label>院內編號／識別註記（選填）<input data-field="hospitalCode" maxlength="40" value="${esc(d.hospitalCode)}" placeholder="例如院內燈號"></label></div>${shared.length>1?`<p class="hint">共用此信箱的科別：${esc(shared.map(x=>x.unit).join('、'))}。修改並儲存會一併更新。</p>`:''}<div class="table-tools"><span>${e.contact&&!e.contact.email?'尚缺 Email；可先保存老師資料。':''}</span><button class="primary" type="submit">儲存</button><button type="button" class="text-button" data-discard>還原此筆輸入</button></div>${e.contact?`<details data-contact-history="${esc(e.contact.id)}"><summary>修改紀錄</summary><div></div></details>`:''}</form>`;
    }).join('')}</div>${visible.length?'':'<p class="empty">沒有符合此篩選的老師。</p>'}`;
    document.querySelectorAll('[data-contact]').forEach(form=>{
      const entry=entries[Number(form.dataset.contact)];
      form.querySelectorAll('input[data-field]').forEach(input=>input.oninput=()=>{drafts.set(entry.key,{...draft(entry),[input.dataset.field]:input.value});form.querySelector('[data-save-status]').textContent=dirty(entry)?'尚未儲存':'已儲存';});
      const select=form.querySelector('select');if(select)select.onchange=()=>{const c=contacts.find(c=>c.id===select.value);drafts.set(entry.key,{...original(entry),contactId:c?.id??null,email:c?.email??'',hospitalCode:c?.hospital_code??'',revision:c?.revision??''});list();};
      form.onsubmit=event=>{event.preventDefault();void save(entry);};form.querySelector('[data-discard]').onclick=()=>{drafts.delete(entry.key);notice='';failed=false;list();};
      const detail=form.querySelector('details');if(detail)detail.ontoggle=()=>{if(detail.open&&!detail.dataset.loaded)void history(detail);};
    });
  }
  async function save(entry){
    if(busy)return;const d=draft(entry);if(d.email.trim()&&!validTeacherEmail(d.email.trim())){notice='請填寫單一有效 Email。';failed=true;list();return;}
    const generation=epoch;lock(true);notice='';$('contact-message').textContent='正在儲存…';
    try{const result=await api('teacher-contact-save',{key:entry.key,...d});if(!current(generation))return;
      // Keep other unsaved drafts and their expected versions, so shared-contact conflicts cannot overwrite edits.
      for(const e of entries)if(!dirty(e))drafts.delete(e.key);
      contacts=contacts.filter(c=>c.id!==result.contact.id).concat(result.contact);
      entry.binding=result.binding;for(const e of entries)if(e.binding?.contact_id===result.contact.id)e.contact=result.contact;
      drafts.delete(entry.key);notice='通訊錄已儲存。不會寄出信件。';failed=false;
    }catch(e){if(current(generation)){notice=e.message;failed=true;}}
    finally{if(generation===epoch){lock(false);if(current(generation))list();}}
  }
  async function history(detail){
    const generation=epoch,target=detail.querySelector('div');detail.dataset.loaded='true';target.textContent='正在載入…';
    try{const d=await api('teacher-contact-history',{id:detail.dataset.contactHistory});if(!current(generation)||!target.isConnected)return;target.innerHTML=d.history.map(h=>`<div class="history-item"><b>${esc(h.before_contact?.email||'未填信箱')} → ${esc(h.after_contact.email||'未填信箱')}</b><small>${esc(h.after_binding.unit)} · ${esc(taipei(h.created_at))} · ${esc(h.actor)}</small></div>`).join('')||'<p>尚無紀錄。</p>';}catch(e){if(current(generation)&&target.isConnected){target.textContent=e.message;delete detail.dataset.loaded;}}
  }
  async function preview(){
    const generation=++epoch;$('content').innerHTML='<p role="status">正在整理已確認名單…</p>';
    try{const d=await api('reminder-groups');if(!current(generation)||mode!=='preview')return;
      $('content').innerHTML=`<div class="table-tools"><p>已確認 ${d.confirmedCount} 段實習 · 尚待核對 ${d.pendingCount} 段</p><button id="contact-refresh-preview" class="secondary">更新合併預覽</button></div><p class="hint">資料截至 ${esc(taipei(d.asOf))}。只納入七天內有效的「確認仍未評分」。${hasDirty()?'通訊錄仍有未儲存輸入，以下使用已儲存資料。':''}</p><div class="contact-list">${d.groups.map(g=>`<article class="contact-card"><h2>${esc(g.contact.name)}${g.contact.hospital_code?' · '+esc(g.contact.hospital_code):''}</h2><p>${g.emailValid?esc(g.contact.email):'<span class="amber">尚缺有效 Email，請補填通訊錄</span>'}</p><p><b>${g.students.length} 位學生 · ${g.items.length} 段實習 → 合併為一封提醒</b></p><div class="table-wrap"><table><thead><tr><th>學生</th><th>待評分實習</th></tr></thead><tbody>${g.students.map(s=>`<tr><td>${esc(s.name)}<small>${esc(s.studentId)}</small></td><td>${s.placements.map(p=>`<div>${esc(p.unit)} · Course ${esc(p.course)}<small>${esc(p.batch)} · ${esc(p.start)} ～ ${esc(p.end)}</small></div>`).join('')}</td></tr>`).join('')}</tbody></table></div><p class="hint">信件範本待補，目前未寄信。</p></article>`).join('')}</div>${d.unlinked.length?`<div class="contact-card"><h2>尚未連結通訊錄（${d.unlinked.length} 段）</h2><p>請回通訊錄填入老師 Email 並儲存。</p><ul>${d.unlinked.map(({row:r})=>`<li>${esc(r.record.actual_teacher)} · ${esc(r.unit)}：${esc(r.name)}（${esc(r.studentId)}）Course ${esc(r.course)}</li>`).join('')}</ul></div>`:''}${d.confirmedCount?'':'<p class="empty">目前沒有仍在有效期內的已確認項目，請先至待提醒名單核對。</p>'}`;
      $('contact-refresh-preview').onclick=preview;
    }catch(e){if(current(generation))$('content').innerHTML=`<p class="error" role="alert">${esc(e.message)}</p>`;}
  }
  window.addEventListener('beforeunload',event=>{if(hasDirty()){event.preventDefault();event.returnValue='';}});
  return {render,reset,hasDirty,isBusy:()=>busy,discardDrafts:()=>drafts.clear()};
}

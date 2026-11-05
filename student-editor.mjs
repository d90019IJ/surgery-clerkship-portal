import {lectureSummary,lectureText,lectureProgress} from './lecture-rules.mjs';
import {overviewStatus} from './overview-rules.mjs';
import {studentCohorts,gradeTotals} from './score-rules.mjs';

const labels={unchecked:'尚未核對',unpaired:'確認未配對',paired:'已配對'};
const number=value=>value===''?null:Number(value);
const display=value=>value===null?'待收齊':value.toFixed(2);
export const pairingReasons=['單位安排','原安排老師不在'];
export const reasonFromNote=note=>pairingReasons.includes(note)?note:note?'其他':'';
export function rowValues(row){return {pairingStatus:row.record?.pairing_status??'unchecked',actualTeacher:row.record?.actual_teacher??'',score:row.record?.score??null,note:row.record?.note??''};}
export function assessmentValues(record){return {suture:record?.suture??null,dressing:record?.dressing??null,passportCompletion:record?.passport_completion??null,note:record?.note??''};}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const changedRow=draft=>draft.reconfirm||!equal(draft.values,draft.original);
export const changedAssessment=draft=>!equal(draft.values,draft.original);

export function createStudentEditor({state,api,esc,$,taipei,download,studentDetail}){
  const drafts=new Map();
  let active='',mode='student',busy=false,epoch=0,notice='',noticeError=false;
  let query='',batch='',month='',status='',quick='all';
  const relevant=c=>c.rows.filter(r=>r.included||!r.unit);
  const all=()=>studentCohorts(state.rows).filter(c=>relevant(c).length);
  function dirty(d){return [...d.rows.values()].some(changedRow)||changedAssessment(d.assessment);}
  function hasDirty(){return [...drafts.values()].some(dirty);}
  function reset(){if(busy)lock(false);drafts.clear();active='';busy=false;epoch++;notice='';query='';batch='';month='';status='';quick='all';mode='student';}
  function getDraft(c){
    let d=drafts.get(c.id);
    if(d&&!dirty(d))drafts.delete(c.id);
    if(!drafts.has(c.id)){
      const record=state.osce.find(r=>r.id===c.id);
      const values=assessmentValues(record);
      d={rows:new Map(relevant(c).map(row=>{const v=rowValues(row);return [row.id,{row,values:{...v},original:{...v},reason:reasonFromNote(v.note),otherNote:reasonFromNote(v.note)==='其他'?v.note:'',revision:row.record?.revision??'',reconfirm:false}];})),assessment:{values:{...values},original:{...values},revision:record?.revision??''}};
      drafts.set(c.id,d);
    }
    return drafts.get(c.id);
  }
  function matches(c){return (!query||`${c.row.name} ${c.row.studentId} ${c.row.group} ${c.row.hospitalCode}`.includes(query))&&(!batch||c.row.batch===batch)&&(!month||c.rows.some(r=>r.start.slice(0,7)<=month&&r.end.slice(0,7)>=month))&&(!status||relevant(c).some(r=>status==='missing-score'?r.record?.pairing_status==='paired'&&r.record.score==null:status==='changed'?r.selectionChanged:(r.record?.pairing_status??'unchecked')===status));}
  function statusFor(c){return overviewStatus(c.rows,state.osce.find(a=>a.id===c.id),lectureSummary(c.row.studentId,state));}
  function baseList(){return all().filter(matches);}
  function list(){return baseList().filter(c=>quick==='all'||(quick==='unchecked'?statusFor(c).unchecked>0:statusFor(c).missingScores));}
  function renderQuick(){const base=baseList();const counts={all:base.length,unchecked:base.filter(c=>statusFor(c).unchecked>0).length,missing:base.filter(c=>statusFor(c).missingScores).length};$('editor-quick').innerHTML=Object.entries({all:'全部',unchecked:'只看尚未核對',missing:'只看缺分數'}).map(([key,label])=>`<button type="button" data-quick="${key}" class="${quick===key?'primary':'secondary'}" aria-pressed="${quick===key}">${label}<span class="quick-count">${counts[key]}</span></button>`).join('');document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>{quick=b.dataset.quick;renderContent();});}
  function setNotice(text,error=false){notice=text;noticeError=error;const node=$('student-save-message');if(node){node.textContent=text;node.className=error?'error':'success';node.hidden=!text;}}
  function focusStudent(){document.querySelector('.student-navigation')?.scrollIntoView({block:'start'});$('editor-student')?.focus({preventScroll:true});}
  function render(){
    if(state.tab!=='grades')return;
    const batches=[...new Set(all().map(c=>c.row.batch))];
    $('filters').innerHTML=`<div class="editor-toolbar"><div class="editor-modes" role="group" aria-label="檢視方式"><button type="button" id="single-view" class="${mode==='student'?'primary':'secondary'}" aria-pressed="${mode==='student'}">逐位核對</button><button type="button" id="class-view" class="${mode==='overview'?'primary':'secondary'}" aria-pressed="${mode==='overview'}">全班總覽</button></div><div class="filters"><label>搜尋學生<input id="editor-search" value="${esc(query)}" placeholder="姓名、學號、組別或院內簡碼"></label><label>梯次<select id="editor-batch"><option value="">全部梯次</option>${batches.map(b=>`<option${batch===b?' selected':''}>${esc(b)}</option>`).join('')}</select></label><label>實習月份<input type="month" id="editor-month" value="${esc(month)}"></label><label>核對狀態<select id="editor-status"><option value="">全部狀態</option>${Object.entries({...labels,'missing-score':'已配對／待評分',changed:'選科已變更'}).map(([k,v])=>`<option value="${k}"${status===k?' selected':''}>${v}</option>`).join('')}</select></label><button type="button" id="editor-clear" class="text-button">清除篩選</button></div><div id="editor-quick" class="quick-filters" role="group" aria-label="快速篩選"></div></div>`;
    $('single-view').onclick=()=>{mode='student';render();};$('class-view').onclick=()=>{mode='overview';render();};
    $('editor-search').oninput=e=>{query=e.target.value.trim();renderContent();};
    $('editor-batch').onchange=e=>{batch=e.target.value;renderContent();};
    $('editor-month').onchange=e=>{month=e.target.value;renderContent();};
    $('editor-status').onchange=e=>{status=e.target.value;renderContent();};
    $('editor-clear').onclick=()=>{query='';batch='';month='';status='';quick='all';render();};
    renderContent();
  }
  function renderContent(){
    renderQuick();const students=list();
    if(!students.some(c=>c.id===active))active=students[0]?.id??'';
    if(mode==='overview')return overview(students);
    const c=students.find(c=>c.id===active);
    if(!c){$('content').innerHTML='<p class="empty">此範圍沒有學生，請調整篩選條件。未儲存內容仍保留在本頁。</p>';return;}
    const d=getDraft(c),index=students.indexOf(c),a=d.assessment.values;
    $('content').innerHTML=`<div class="student-navigation"><label>選擇學生<select id="editor-student">${students.map(s=>`<option value="${esc(s.id)}"${s.id===active?' selected':''}>${esc(s.row.name)} · ${esc(s.row.studentId)} · ${esc(s.row.group)}${drafts.has(s.id)&&dirty(drafts.get(s.id))?'（未儲存）':''}</option>`).join('')}</select></label><span>${index+1}／${students.length} 位</span><button type="button" id="previous-student" class="secondary"${index===0?' disabled':''}>上一位</button><button type="button" id="next-student" class="secondary"${index===students.length-1?' disabled':''}>下一位</button></div>
      <section class="student-sheet"><div class="student-sheet-head"><div><span class="eyebrow">學生核對表</span><h2>${esc(c.row.name)}</h2><p>${esc(c.row.studentId)} · ${esc(c.row.batch)} · ${esc(c.row.group)}${c.row.hospitalCode?' · 院內簡碼 '+esc(c.row.hospitalCode):''}</p></div><div id="editor-progress"></div></div><p class="hint">直接在下表核對；「與原選相同」會帶入老師並標示已配對。未評分請留白。${month||status?'篩選用來找學生，下表仍列出該生完整外科安排。':''}</p>
      <form id="student-editor-form"><fieldset id="student-editor-fields"><div class="table-wrap"><table class="inline-grade-table"><thead><tr><th>科別／期間</th><th>原選老師</th><th>配對狀態</th><th>院內實際老師</th><th>評分（0–100）</th></tr></thead><tbody>${[...d.rows.values()].map((r,i)=>rowHTML(r,i)).join('')}</tbody></table></div>
      <div class="inline-assessment"><div><h3>OSCE 與護照</h3><p class="hint">縫合、換藥各滿分 100 分；整本護照完成率低於 90% 扣 10 分。</p></div><div class="assessment-inputs"><label>縫合（0–100）<input id="inline-suture" type="number" min="0" max="100" step="any" value="${a.suture??''}"></label><label>換藥（0–100）<input id="inline-dressing" type="number" min="0" max="100" step="any" value="${a.dressing??''}"></label><label>護照完成率（%）<input id="inline-passport" type="number" min="0" max="100" step="any" value="${a.passportCompletion??''}"></label></div><details><summary>OSCE／護照備註與修改紀錄</summary><label>OSCE／護照備註<textarea id="inline-assessment-note" maxlength="500">${esc(a.note)}</textarea></label><button type="button" id="assessment-history" class="text-button">查看修改紀錄</button><div id="inline-assessment-history"></div></details></div>
      <div id="inline-totals" class="inline-totals" aria-live="polite"></div><div id="inline-lecture" class="lecture-summary"></div></fieldset><div class="student-save-bar"><span id="editor-dirty-label"></span><button type="button" id="discard-student" class="text-button">還原未儲存修改</button><button type="submit" class="secondary" id="save-student">儲存此學生</button><button type="submit" class="primary" id="save-next">${index===students.length-1?'儲存並完成':'儲存並下一位'}</button></div><p id="student-save-message" role="status"${notice?'':' hidden'} class="${noticeError?'error':'success'}">${esc(notice)}</p></form></section>`;
    $('editor-student').onchange=e=>{active=e.target.value;notice='';renderContent();focusStudent();};
    $('previous-student').onclick=()=>{active=students[index-1].id;notice='';renderContent();focusStudent();};
    $('next-student').onclick=()=>{active=students[index+1].id;notice='';renderContent();focusStudent();};
    [...d.rows.values()].forEach((r,i)=>wireRow(c,d,r,i));
    for(const [id,key] of [['inline-suture','suture'],['inline-dressing','dressing'],['inline-passport','passportCompletion']])$(id).oninput=e=>{d.assessment.values[key]=number(e.target.value);refresh(c,d);};
    $('inline-assessment-note').oninput=e=>{d.assessment.values.note=e.target.value;refresh(c,d);};
    $('assessment-history').onclick=()=>showHistory('osce-history',c.id,$('inline-assessment-history'));
    $('discard-student').onclick=()=>{if(!dirty(d)||confirm('確定還原這位學生尚未儲存的修改？已儲存紀錄會保留。')){drafts.delete(c.id);notice='';renderContent();}};
    $('student-editor-form').onsubmit=e=>{e.preventDefault();void save(c,d,e.submitter?.id==='save-next',students[index+1]?.id);};
    refresh(c,d,false);
    const lecture=lectureSummary(c.row.studentId,state);$('inline-lecture').innerHTML=`<div><h3>核心講堂總成績：<span data-lecture-total>${lectureText(lecture)}</span></h3><p>${lectureProgress(lecture)}${lecture.total===null&&lecture.currentAverage!==null?' · 目前平均 '+lecture.currentAverage.toFixed(2):''}</p><p class="hint">應考筆試分數直接平均；已截止未交卷計 0 分，未截止先列待測驗。與實習總成績分開計算。</p></div><button type="button" id="inline-lecture-detail" class="secondary">查看講堂明細</button>`;$('inline-lecture-detail').onclick=()=>studentDetail(c.row.studentId);
  }
  function rowHTML(r,i){const v=r.values;return `<tr data-editor-row="${i}"><td><b>${esc(r.row.unit||'尚未選科')}</b><small>Course ${esc(r.row.course)}</small><small>${esc(r.row.start)} ～ ${esc(r.row.end)}</small>${r.row.selectionChanged?`<small class="amber">選科已變更，請重新核對</small><label class="reconfirm"><input type="checkbox" id="reconfirm-${i}"${r.reconfirm?' checked':''}>已重新核對</label>`:''}</td><td>${esc(r.row.selectedTeacher||'未指定／單位安排')}<br><button type="button" class="text-button same-teacher" data-same="${i}"${!r.row.selectedTeacher||!r.row.unit?' disabled':''}>與原選相同</button></td><td><select aria-label="Course ${esc(r.row.course)} 配對狀態" id="inline-pairing-${i}"${!r.row.unit?' disabled':''}>${Object.entries(labels).map(([k,l])=>`<option value="${k}"${v.pairingStatus===k?' selected':''}>${l}</option>`).join('')}</select><small id="row-save-state-${i}"></small></td><td><input aria-label="Course ${esc(r.row.course)} 院內老師" id="inline-teacher-${i}" value="${esc(v.actualTeacher)}" maxlength="80" placeholder="依院內配對輸入"><details id="row-note-details-${i}"><summary>異動說明／紀錄</summary><fieldset class="pairing-reasons"><legend>配對原因</legend><div class="reason-options">${[...pairingReasons,'其他'].map(reason=>`<label><input type="radio" name="pair-reason-${i}" value="${reason}"${r.reason===reason?' checked':''}>${reason}</label>`).join('')}</div><label id="other-reason-${i}" class="other-reason"${r.reason==='其他'?'':' hidden'}>其他原因（必填）<textarea aria-label="Course ${esc(r.row.course)} 核對說明" id="inline-note-${i}" maxlength="500" placeholder="請填寫其他原因">${esc(r.otherNote)}</textarea></label><button type="button" class="text-button clear-reason" id="clear-reason-${i}">清除選擇</button></fieldset><button type="button" class="text-button" id="row-history-${i}">查看修改紀錄</button><div id="row-history-content-${i}"></div></details></td><td><input aria-label="Course ${esc(r.row.course)} 評分" type="number" min="0" max="100" step="any" id="inline-score-${i}" value="${v.score??''}" placeholder="未評分"><small id="teacher-change-${i}" class="amber"></small></td></tr>`;}
  function wireRow(c,d,r,i){
    const teacher=$('inline-teacher-'+i),pairing=$('inline-pairing-'+i),score=$('inline-score-'+i),note=$('inline-note-'+i);
    const choices=[...document.querySelectorAll(`[name="pair-reason-${i}"]`)];
    const sync=()=>{const paired=r.values.pairingStatus==='paired',needsReason=paired&&r.values.actualTeacher.trim()!==r.row.selectedTeacher;teacher.disabled=!paired;teacher.required=paired;score.disabled=!paired;choices.forEach(choice=>{choice.required=needsReason;});const other=r.reason==='其他';$('other-reason-'+i).hidden=!other;note.disabled=!other;note.required=other;note.setCustomValidity(other&&!note.value.trim()?'請填寫其他原因。':'');const changed=r.original.score!==null&&r.values.actualTeacher!==r.original.actualTeacher;$('teacher-change-'+i).textContent=changed?'老師已更換，請填新老師的評分；原分數保留於紀錄。':'';if(needsReason&&(!r.values.note.trim()||r.values.actualTeacher!==r.original.actualTeacher))$('row-note-details-'+i).open=true;};
    const updateTeacher=value=>{if(value!==r.values.actualTeacher&&r.values.score!==null){r.values.score=null;score.value='';}r.values.actualTeacher=value;teacher.value=value;sync();refresh(c,d);};
    teacher.oninput=e=>updateTeacher(e.target.value);
    pairing.onchange=()=>{r.values.pairingStatus=pairing.value;if(pairing.value!=='paired'){r.values.actualTeacher='';r.values.score=null;teacher.value='';score.value='';}sync();refresh(c,d);};
    document.querySelector(`[data-same="${i}"]`).onclick=()=>{r.values.pairingStatus='paired';pairing.value='paired';updateTeacher(r.row.selectedTeacher);if($('reconfirm-'+i)){$('reconfirm-'+i).checked=true;r.reconfirm=true;}refresh(c,d);};
    score.oninput=e=>{r.values.score=number(e.target.value);refresh(c,d);};note.oninput=e=>{r.otherNote=e.target.value;r.values.note=e.target.value;sync();refresh(c,d);};
    choices.forEach(choice=>choice.onchange=()=>{r.reason=choice.value;r.values.note=r.reason==='其他'?r.otherNote:r.reason;note.value=r.otherNote;sync();refresh(c,d);});
    $('clear-reason-'+i).onclick=()=>{r.reason='';r.values.note='';choices.forEach(choice=>{choice.checked=false;});sync();refresh(c,d);};
    if($('reconfirm-'+i))$('reconfirm-'+i).onchange=e=>{r.reconfirm=e.target.checked;refresh(c,d);};
    $('row-history-'+i).onclick=()=>showHistory('grade-history',r.row.id,$('row-history-content-'+i));sync();
  }
  function refresh(c,d,clearMessage=true){
    if(clearMessage)setNotice('');
    const rows=c.rows.map(row=>{const r=d.rows.get(row.id);return r?{...row,selectionChanged:row.selectionChanged&&!r.reconfirm,record:{pairing_status:r.values.pairingStatus,score:r.values.score}}:row;});
    const a=d.assessment.values,t=gradeTotals(rows,{suture:a.suture,dressing:a.dressing,passport_completion:a.passportCompletion});
    const checked=[...d.rows.values()].filter(r=>r.values.pairingStatus!=='unchecked'&&(!r.row.selectionChanged||r.reconfirm)).length;
    $('editor-progress').textContent=`已核對 ${checked}／${d.rows.size} 科 · 已評分 ${t.received}／${t.expected} 科`;
    $('editor-dirty-label').textContent=dirty(d)?'有未儲存修改':'已儲存資料';
    $('editor-dirty-label').className=dirty(d)?'amber':'';
    [...d.rows.values()].forEach((r,i)=>{$('row-save-state-'+i).textContent=changedRow(r)?'未儲存':'';});
    $('inline-totals').innerHTML=`<span>醫師平均 <b>${display(t.average)}</b></span><span>OSCE 平均 <b>${display(t.osceAverage)}</b></span><span>護照扣分 <b>${t.passportDeduction===null?'待確認':t.passportDeduction+' 分'}</b></span><span class="final-total">實習總成績 <b>${display(t.finalScore)}</b></span><small>${dirty(d)?'以上依目前輸入試算，儲存後生效。':'醫師平均 × 80% ＋ OSCE 平均 × 20% − 護照扣分。'}</small>`;
  }
  function lock(value){busy=value;document.querySelectorAll('#filters button,#filters input,#filters select,.student-navigation button,.student-navigation select,[data-tab],#reload,#discard-student,#save-student,#save-next').forEach(el=>{if(value){el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else{el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}});if($('student-editor-fields'))$('student-editor-fields').disabled=value;}
  async function save(c,d,next,nextId){
    if(busy)return;
    if([...d.rows.values()].some(r=>changedRow(r)&&r.row.selectionChanged&&!r.reconfirm)){setNotice('選科曾變更，請先勾選該科「已重新核對」。',true);return;}
    lock(true);const generation=epoch;let saved=0,target='';setNotice('正在儲存，請稍候…');
    try{
      for(const r of d.rows.values()){
        if(!changedRow(r))continue;target=`Course ${r.row.course} ${r.row.unit}`;
        const desired={...r.values};
        const persist=async values=>{const result=await api('grade-save',{record:{id:r.row.id,revision:r.revision,sourceUnit:r.row.unit,sourceTeacher:r.row.selectedTeacher,...values}});if(generation!==epoch||!state.token)throw new Error('登入狀態已變更。');r.row.record=result.record;r.row.selectionChanged=false;r.revision=result.record.revision;r.original=rowValues(r.row);r.reconfirm=false;};
        // The source requires clearing the old teacher's score before recording a new one.
        if(r.original.score!==null&&desired.actualTeacher!==r.original.actualTeacher&&desired.score!==null)await persist({...desired,score:null});
        await persist(desired);r.values={...r.original};saved++;
      }
      if(changedAssessment(d.assessment)){
        target='OSCE／護照';const a=d.assessment;
        const result=await api('assessment-save',{id:c.id,revision:a.revision,...a.values});
        if(generation!==epoch||!state.token)throw new Error('登入狀態已變更。');
        state.osce=state.osce.filter(r=>r.id!==c.id).concat(result.record);a.revision=result.record.revision;a.original=assessmentValues(result.record);a.values={...a.original};saved++;
      }
      if(generation!==epoch)return;
      drafts.delete(c.id);lock(false);
      notice=`${c.row.name}：${saved?'修改已全部儲存。':'沒有未儲存修改，原有資料已保留。'}`;noticeError=false;
      if(next){if(nextId)active=nextId;else{mode='overview';notice+=' 已完成目前名單。';}}
      render();if(next){if(nextId)focusStudent();else $('filters').scrollIntoView({block:'start'});}
    }catch(error){if(generation===epoch){lock(false);refresh(c,d,false);setNotice(`${target} 未完成儲存：${error.message}${saved?' 已成功儲存的項目會保留。':''} 尚未儲存的輸入仍在表內，未切換學生。`,true);}}
  }
  async function showHistory(action,id,target){target.textContent='正在載入…';const generation=epoch;try{const result=await api(action,{id});if(generation!==epoch||!target.isConnected)return;target.innerHTML=result.history.map(h=>{const v=action==='grade-history'?JSON.parse(h.detail):{before:h.before_value,after:h.after_value};return `<div class="history-item"><b>${esc(taipei(h.created_at))}</b><small>${esc(h.actor)}</small><p>${action==='grade-history'?`${esc(v.before?.actual_teacher||'未配對')}／${esc(v.before?.score??'無分數')} → ${esc(v.after.actual_teacher||'未配對')}／${esc(v.after.score??'無分數')}`:`縫合 ${esc(v.before?.suture??'未填')} → ${esc(v.after.suture??'未填')}<br>換藥 ${esc(v.before?.dressing??'未填')} → ${esc(v.after.dressing??'未填')}<br>護照 ${esc(v.before?.passport_completion??'未填')} → ${esc(v.after.passport_completion??'未填')} %`}</p><small>${esc(v.after.note)}</small></div>`;}).join('')||'尚無修改紀錄。';}catch(e){if(generation===epoch&&target.isConnected)target.textContent=e.message;}}
  function overview(students){
    $('content').innerHTML=`${notice?`<p class="${noticeError?'error':'success'}" role="status">${esc(notice)}</p>`:''}<div class="table-tools"><p>全班總覽 · ${students.length} 位學生（顯示已儲存資料）</p><button type="button" id="editor-export" class="secondary">匯出配對與評分</button></div><p class="hint">尚未核對包含選科變更待重新核對。缺分數包含醫師、縫合、換藥及講堂分數異常；護照未填另列提醒。未來實習缺分不代表逾期，講堂已截止未交卷依規則計 0 分。</p><div class="table-wrap"><table><thead><tr><th>學生</th><th>配對進度</th><th>評分進度</th><th>待處理</th><th>實習總成績</th><th>核心講堂總成績</th><th>操作</th></tr></thead><tbody>${students.map(c=>{const r=relevant(c),t=gradeTotals(c.rows,state.osce.find(a=>a.id===c.id)),pending=statusFor(c),lecture=lectureSummary(c.row.studentId,state);const checked=r.length-pending.unchecked;const reasons=[...(pending.unchecked?[`尚未核對 ${pending.unchecked} 科`]:[]),...(pending.unpaired?[`確認未配對 ${pending.unpaired} 科`]:[]),...pending.missing.map(x=>'缺 '+x),...(pending.passportMissing?['護照完成率未填']:[])];return `<tr><td><b>${esc(c.row.name)}</b><small>${esc(c.row.studentId)} · ${esc(c.row.group)}</small><small>${esc(c.row.batch)}</small></td><td>${checked}／${r.length} 科</td><td>${t.received}／${t.expected} 科</td><td>${reasons.length?reasons.map(esc).join('<br>'):'實習資料已齊'}${drafts.has(c.id)&&dirty(drafts.get(c.id))?'<br><span class="amber">有未儲存修改</span>':''}</td><td>${display(t.finalScore)}</td><td data-lecture-total><b>${lectureText(lecture)}</b><small>${lectureProgress(lecture)}</small>${lecture.total===null&&lecture.currentAverage!==null?`<small>目前平均 ${lecture.currentAverage.toFixed(2)}</small>`:''}</td><td><button type="button" class="secondary" data-open-student="${esc(c.id)}">開啟核對表</button><button type="button" class="text-button" data-lecture-student="${esc(c.row.studentId)}">講堂明細</button></td></tr>`;}).join('')}</tbody></table>${students.length?'':'<p class="empty">沒有符合此篩選的學生。</p>'}</div>`;
    document.querySelectorAll('[data-open-student]').forEach(b=>b.onclick=()=>{active=b.dataset.openStudent;mode='student';notice='';render();});
    document.querySelectorAll('[data-lecture-student]').forEach(b=>b.onclick=()=>studentDetail(b.dataset.lectureStudent));
    $('editor-export').onclick=()=>download('外科配對評分.csv',[['學號','姓名','梯次','組別','Course','起日','迄日','科別','原選老師','院內老師','配對狀態','分數','備註'],...students.flatMap(c=>relevant(c).map(r=>[r.studentId,r.name,r.batch,r.group,r.course,r.start,r.end,r.unit,r.selectedTeacher,r.record?.actual_teacher,labels[r.record?.pairing_status??'unchecked'],r.record?.score,r.record?.note]))]);
  }
  window.addEventListener('beforeunload',e=>{if(hasDirty()||busy)e.preventDefault();});
  return {render,reset,hasDirty,isBusy:()=>busy,discardDrafts:()=>drafts.clear(),selectRow:id=>{const c=all().find(c=>c.rows.some(r=>r.id===id));if(c){active=c.id;mode='student';query='';batch='';month='';status='';quick='all';notice='';}}};
}

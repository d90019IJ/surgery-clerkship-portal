export const REMINDER_SUBJECT='【外科實習評分提醒】敬請協助完成 TAS 學生實習評分';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>String(value??'').replaceAll('-','/');

// Presentation only: the caller supplies the server's freshly confirmed teacher group.
export function reminderLetterHTML(group){
  const rows=group.students.flatMap(student=>student.placements.map(p=>({studentId:student.studentId,name:student.name,unit:p.unit,start:p.start,end:p.end})));
  return `<div class="reminder-letter"><p><b>主旨：${REMINDER_SUBJECT}</b></p><p>${escape(group.contact.name)}老師 您好：</p><p>不好意思打擾了，目前正進行外科實習成績與教學紀錄彙整，經核對 TAS（教學評估系統），以下學生的實習評分尚待填寫，再麻煩老師撥空協助完成。</p><p><b>待評分學生名單如下：</b></p><div class="table-wrap"><table><thead><tr><th>學號</th><th>姓名</th><th>實習科別</th><th>實習期間</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escape(r.studentId)}</td><td>${escape(r.name)}</td><td>${escape(r.unit)}</td><td>${escape(date(r.start))}～${escape(date(r.end))}</td></tr>`).join('')}</tbody></table></div><p><b>系統連結與操作：</b></p><ul><li><a href="https://tas.vghtpe.gov.tw/" target="_blank" rel="noopener noreferrer">TAS 教學評估系統</a></li><li>登入後請依學生的<b>實習月份</b>查詢；若名單跨不同月份，請分別切換月份查看。</li></ul><p>若老師已完成評分，或名單中的配對資料有誤，敬請回信告知，以便我們核對更新。</p><p>感謝老師對學生教學與行政工作的協助！</p><p>感恩。</p><p>林憶柔<br>醫學系外科學科</p></div>`;
}

export const reminderTemplateHTML=()=>reminderLetterHTML({contact:{name:'【老師姓名】'},students:[{studentId:'【學號】',name:'【學生姓名】',placements:[{unit:'【科別】',start:'【開始日期】',end:'【結束日期】'}]}]});

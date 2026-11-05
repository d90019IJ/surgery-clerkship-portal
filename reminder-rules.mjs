const DAY=86400000;
export const REVIEW_VALID_MS=7*DAY;
function dateMillis(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return NaN;
  const parsed=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value?parsed:NaN;
}
export function reminderDueAt(end){
  const value=dateMillis(end);
  // End day is inclusive: seven full days after it, then day eight at Taipei midnight.
  return Number.isFinite(value)?new Date(value+8*DAY-8*3600000).toISOString():null;
}
export function reminderEligible(row,now=Date.now()){
  const due=reminderDueAt(row.end),start=dateMillis(row.start),end=dateMillis(row.end);
  return !!(row.included&&row.unit&&!row.selectionChanged&&Number.isFinite(start)&&start<=end&&due&&now>=Date.parse(due)&&row.record?.pairing_status==='paired'&&typeof row.record.actual_teacher==='string'&&row.record.actual_teacher.trim()&&row.record.score==null);
}
export function reminderSourceVersion(row){
  return JSON.stringify([row.id,row.studentId,row.batch,row.course,row.unit,row.start,row.end,row.selectedTeacher,row.record?.actual_teacher,row.record?.revision??'',row.record?.pairing_status,row.record?.score??null]);
}
export function reminderReview(row,record,now=Date.now()){
  const checked=Date.parse(record?.reviewed_at),expires=checked+REVIEW_VALID_MS;
  const matches=!!record&&record.source_version===reminderSourceVersion(row);
  const active=reminderEligible(row,now)&&matches&&record.confirmed===true&&Number.isFinite(checked)&&checked<=now&&now<expires;
  const reason=!record?'pending':!matches?'changed':!record.confirmed?'revoked':active?'confirmed':'expired';
  return {active,reason,expiresAt:Number.isFinite(expires)&&record?.confirmed?new Date(expires).toISOString():null};
}
export function reminderItems(rows,records,now=Date.now()){
  const saved=new Map(records.map(r=>[r.row_id,r]));
  return rows.filter(r=>reminderEligible(r,now)).map(row=>({row,record:saved.get(row.id)??null,sourceVersion:reminderSourceVersion(row),dueAt:reminderDueAt(row.end),review:reminderReview(row,saved.get(row.id),now)})).sort((a,b)=>a.row.record.actual_teacher.localeCompare(b.row.record.actual_teacher,'zh-Hant')||a.row.end.localeCompare(b.row.end)||String(a.row.studentId).localeCompare(String(b.row.studentId)));
}

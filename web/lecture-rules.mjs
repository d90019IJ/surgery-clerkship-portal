import {validScore} from './score-rules.mjs';

// Use the data snapshot's server timestamp so a stale page cannot turn a recent
// submission, not yet loaded here, into a missed exam merely because time passed.
export function lectureAsOf(data){const time=Date.parse(data.sourceUpdatedAt);return Number.isFinite(time)?time:Date.now();}
export function lectureSummary(studentId,data,asOf=lectureAsOf(data)){
  const expectedIds=new Set((data.rosters??[]).filter(r=>r.student_id===studentId).map(r=>r.exam_id));
  const exams=new Map((data.exams??[]).map(e=>[e.id,e]));
  const submissions=new Map();
  for(const s of data.submissions??[]){if(s.student_id!==studentId)continue;const old=submissions.get(s.exam_id);if(!old||(s.submitted_at??'')>(old.submitted_at??''))submissions.set(s.exam_id,s);}
  const entries=[...new Set([...expectedIds,...submissions.keys()])].map(id=>{
    const exam=exams.get(id),submission=submissions.get(id),required=expectedIds.has(id);
    const closesAt=Date.parse(exam?.closes_at),closed=Number.isFinite(closesAt)&&asOf>=closesAt;
    // A malformed stored grade is an exception for review, never an absent exam.
    const status=submission?(validScore(submission.score)?'submitted':'invalid'):closed?'missed':!Number.isFinite(closesAt)?'unscheduled':'pending';
    return {id,exam,submission,required,status,score:status==='submitted'?submission.score:status==='missed'?0:null};
  });
  const required=entries.filter(e=>e.required),counted=required.filter(e=>e.score!==null);
  const pending=required.filter(e=>e.score===null),missed=required.filter(e=>e.status==='missed');
  const currentAverage=counted.length?counted.reduce((sum,e)=>sum+e.score,0)/counted.length:null;
  return {entries,expected:required.length,received:required.filter(e=>e.status==='submitted').length,counted:counted.length,
    pending:pending.length,missed:missed.length,invalid:required.filter(e=>e.status==='invalid').length,
    currentAverage,total:required.length&&!pending.length?currentAverage:null,asOf};
}
export function lectureText(summary){return summary.total!==null?summary.total.toFixed(2):summary.expected?'待結算':'未設定應考名單';}
export function lectureProgress(summary){return summary.expected?`已計 ${summary.counted}／${summary.expected} 場${summary.missed?` · 未交卷計 0 分 ${summary.missed} 場`:''}`:'請確認應考名單';}

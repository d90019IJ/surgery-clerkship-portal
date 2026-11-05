import {validScore} from './score-rules.mjs';

export function overviewStatus(rows,assessment={},lecture=null){
  const relevant=rows.filter(r=>r.included||!r.unit);
  const unchecked=relevant.filter(r=>r.selectionChanged||!r.record||r.record.pairing_status==='unchecked');
  const missingDoctors=relevant.filter(r=>r.included&&(!validScore(r.record?.score)||r.record?.pairing_status!=='paired'||r.selectionChanged));
  const missing=[];
  if(missingDoctors.length)missing.push(`醫師評分 ${missingDoctors.length} 科`);
  if(!validScore(assessment.suture))missing.push('縫合');
  if(!validScore(assessment.dressing))missing.push('換藥');
  // Closed unsubmitted exams already count as zero. Future exams are pending,
  // not overdue missing grades; invalid existing scores still need review.
  if(lecture?.invalid)missing.push(`講堂分數異常 ${lecture.invalid} 場`);
  return {unchecked:unchecked.length,missingScores:missing.length>0,missing,
    passportMissing:!validScore(assessment.passport_completion),
    unpaired:relevant.filter(r=>r.record?.pairing_status==='unpaired').length,
    changed:relevant.filter(r=>r.selectionChanged).length};
}

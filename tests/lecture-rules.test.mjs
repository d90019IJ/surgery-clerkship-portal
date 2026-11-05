import test from 'node:test';import assert from 'node:assert/strict';
import {lectureSummary,lectureAsOf} from '../web/lecture-rules.mjs';
import {overviewStatus} from '../web/overview-rules.mjs';
const snapshot='2026-11-05T12:00:00Z';
function data(){return {sourceUpdatedAt:snapshot,exams:[{id:'a',closes_at:'2026-11-04T11:30:00Z'},{id:'b',closes_at:'2026-11-05T11:30:00Z'},{id:'future',closes_at:'2026-12-01T11:30:00Z'}],rosters:[{student_id:'S',exam_id:'a'},{student_id:'S',exam_id:'b'}],submissions:[{student_id:'S',exam_id:'a',score:90,survey_complete:false}]};}
test('required missed exam counts as zero in the denominator; survey does not change written score',()=>{const s=lectureSummary('S',data());assert.equal(s.total,45);assert.equal(s.expected,2);assert.equal(s.counted,2);assert.equal(s.missed,1);assert.equal(s.received,1);});
test('future exams remain pending with a provisional average, not a final zero',()=>{const d=data();d.rosters.push({student_id:'S',exam_id:'future'});const s=lectureSummary('S',d);assert.equal(s.total,null);assert.equal(s.currentAverage,45);assert.equal(s.pending,1);assert.equal(s.expected,3);});
test('deadline boundary is inclusive and uses the source snapshot, not wall-clock time',()=>{const d=data();assert.equal(lectureAsOf(d),Date.parse(snapshot));const at=Date.parse(d.exams[1].closes_at);assert.equal(lectureSummary('S',d,at-1).total,null);assert.equal(lectureSummary('S',d,at).total,45);});
test('pause is not a deadline and unscheduled or unavailable exam metadata stays pending',()=>{const d=data();d.exams[1]={id:'b',open:false,closes_at:null};assert.equal(lectureSummary('S',d).total,null);d.exams.pop();d.exams.pop();assert.equal(lectureSummary('S',d).pending,1);});
test('zero grades and all missed exams produce a legitimate zero total',()=>{const d=data();d.submissions[0].score=0;assert.equal(lectureSummary('S',d).total,0);d.submissions=[];const s=lectureSummary('S',d);assert.equal(s.total,0);assert.equal(s.missed,2);});
test('only required exams count; orphan submissions remain visible and no roster is not a zero',()=>{const d=data();d.submissions.push({student_id:'S',exam_id:'future',score:100});let s=lectureSummary('S',d);assert.equal(s.total,45);assert.equal(s.entries.length,3);d.rosters=[];s=lectureSummary('S',d);assert.equal(s.total,null);assert.equal(s.expected,0);assert.equal(s.entries.length,2);});
test('duplicate roster entries do not double weight; another student has no influence',()=>{const d=data();d.rosters.push({...d.rosters[0]},{student_id:'OTHER',exam_id:'future'});d.submissions.push({student_id:'OTHER',exam_id:'b',score:100});assert.equal(lectureSummary('S',d).total,45);});
test('malformed stored grades require review and do not silently turn into absent zero',()=>{const d=data();d.submissions[0].score=null;const s=lectureSummary('S',d);assert.equal(s.total,null);assert.equal(s.invalid,1);assert.equal(s.missed,1);});
const completeRows=[{included:true,unit:'外科',record:{pairing_status:'paired',score:0}}];
const completeAssessment={suture:0,dressing:100,passport_completion:90};
test('quick filters distinguish unchecked, unpaired, missing and zero without mutating data',()=>{
  assert.equal(overviewStatus(completeRows,completeAssessment).missingScores,false);
  assert.equal(overviewStatus([{...completeRows[0],record:null}],completeAssessment).unchecked,1);
  const unpaired=overviewStatus([{...completeRows[0],record:{pairing_status:'unpaired',score:null}}],completeAssessment);assert.equal(unpaired.unchecked,0);assert.equal(unpaired.missingScores,true);
  assert.equal(overviewStatus([{...completeRows[0],selectionChanged:true}],completeAssessment).unchecked,1);
  const passport=overviewStatus(completeRows,{suture:0,dressing:100});assert.equal(passport.missingScores,false);assert.equal(passport.passportMissing,true);
  assert.deepEqual(overviewStatus(completeRows,{}).missing,['縫合','換藥']);
  assert.equal(overviewStatus([...completeRows,{included:false,unit:'影像',record:null}],completeAssessment).unchecked,0);
});
test('future lecture or already-counted missed zero is not a missing score; invalid grade is',()=>{
  assert.equal(overviewStatus(completeRows,completeAssessment,{pending:1,missed:1,invalid:0}).missingScores,false);
  assert.equal(overviewStatus(completeRows,completeAssessment,{invalid:1}).missingScores,true);
});
